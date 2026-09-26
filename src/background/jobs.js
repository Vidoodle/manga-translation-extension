/* Request lifecycle service. Browser UI and provider transport are injected. */
(() => {
  "use strict";

  const id = () => crypto.randomUUID().replaceAll("-", "");

  async function digest(value) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  class RequestError extends Error {
    constructor(message, code, jobId) {
      super(message);
      this.code = code;
      this.jobId = jobId;
    }
  }

  /** Jobs are running -> completed | failed | interrupted. Unknown outcomes never retry themselves. */
  class RequestService {
    constructor({ store, provider, settings, onChange = () => {} }) {
      this.store = store;
      this.provider = provider;
      this.settings = settings;
      this.onChange = onChange;
      this.active = new Set();
      this.transient = new Map();
    }

    async key(kind, model, input) {
      return digest(
        JSON.stringify([
          kind,
          model,
          "ja",
          "en",
          kind === "translation" ? this.provider.TRANSLATION_VERSION : this.provider.STUDY_VERSION,
          "schema-v1",
          this.provider.PROFILE,
          kind === "translation"
            ? [input.imageDataUrl, input.context]
            : [input.runId, input.regionId, input.source],
        ]),
      );
    }

    async get(jobId) {
      return this.transient.get(jobId) || (await this.store.get("jobs", jobId));
    }

    async source(runId) {
      for (const job of this.transient.values())
        if (job.result?.run_id === runId && job.kind === "translation") return job;
      return this.store.run(runId);
    }

    async reopen(runId) {
      const job = await this.source(runId);
      if (!job?.result || job.status !== "completed")
        throw new Error("This saved translation is no longer in the cache.");
      const result = { ...job.result, studies: await this.store.studies(runId) };
      for (const study of this.transient.values())
        if (study.kind === "study" && study.status === "completed" && study.input.runId === runId)
          result.studies[study.input.regionId] = study.result;
      return { result, imageDataUrl: job.input.imageDataUrl };
    }

    async translation({ model, imageDataUrl, context = "", retryJobId }) {
      return this.submit(
        {
          kind: "translation",
          model,
          input: { imageDataUrl, context },
        },
        retryJobId,
      );
    }

    async retry(jobId) {
      const job = await this.get(jobId);
      if (!job || !["failed", "interrupted"].includes(job.status))
        throw new Error("Only a failed or interrupted request can be explicitly retried.");
      return this.submit(
        {
          kind: job.kind,
          model: job.model,
          input: job.input,
        },
        jobId,
      );
    }

    async prepareRequest(model, retryJobId) {
      const apiKey = await this.settings.key();
      const setup = await this.settings.setup({ key_configured: Boolean(apiKey), model });
      if (setup) throw new RequestError(setup.message, setup.code);
      const stats = await this.store.stats();
      if (!retryJobId && (stats.unresolved >= 50 || stats.bytes > 220 * 1024 * 1024)) {
        throw new RequestError(
          "Local request storage is full. Resolve interrupted requests or clear older cached entries before submitting more.",
          "storage",
        );
      }
      await this.settings.ensureModel(model);
      return apiKey;
    }

    candidate(specification, key) {
      return {
        ...specification,
        id: id(),
        resultId: id(),
        key,
        status: "running",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        accessedAt: Date.now(),
      };
    }

    async startClaimedJob(job, apiKey) {
      this.active.add(job.id);
      this.transient.set(job.id, job);
      this.onChange();
      // This task belongs to the background, independently of the requesting card.
      void this.execute(job, apiKey);
    }

    async submit(specification, retryJobId) {
      const pending = retryJobId && this.transient.get(retryJobId);
      if (pending && ["failed", "interrupted"].includes(pending.status)) {
        const { status, error, code, retryable } = pending;
        if (!(await this.saveOutcome(pending, { status, error, code, retryable }))) {
          throw new RequestError(
            "The previous request outcome still could not be saved. No retry was sent.",
            "storage",
            retryJobId,
          );
        }
      }

      const key = await this.key(specification.kind, specification.model, specification.input);
      const existing = await this.store.lookup(key);
      const needsRequest =
        !existing ||
        (existing.id === retryJobId && ["failed", "interrupted"].includes(existing.status));

      // Cached or live work is available without credentials or an internet connection.
      let apiKey = needsRequest
        ? await this.prepareRequest(specification.model, retryJobId)
        : undefined;
      const candidate = this.candidate(specification, key);
      let claimed = await this.store.claim(candidate, retryJobId, Boolean(apiKey));
      if (claimed.missing) {
        // A cache entry may disappear after lookup. Check setup before recording
        // a replacement submission; no paid request has been attempted yet.
        apiKey = await this.prepareRequest(specification.model, retryJobId);
        claimed = await this.store.claim(candidate, retryJobId);
      }
      const job = this.transient.get(claimed.job.id) || claimed.job;

      if (!claimed.created && ["interrupted", "failed"].includes(job.status)) {
        throw new RequestError(
          this.failureMessage(job),
          job.status === "interrupted" ? "interrupted" : "failed",
          job.id,
        );
      }

      if (claimed.created) await this.startClaimedJob(job, apiKey);
      return { jobId: job.id, cached: job.status === "completed", status: job.status };
    }

    failureMessage(job) {
      let message = job.error || "This request did not complete. Retrying may charge again.";
      const status = /^http-([45]\d{2})$/.exec(job.code)?.[1];
      if (status && !message.includes("HTTP " + status)) message += " (HTTP " + status + ")";
      return job.storageWarning ? message + " " + job.storageWarning : message;
    }

    async saveOutcome(job, changes) {
      try {
        const saved = await this.store.finish(job.id, changes);
        Object.assign(job, saved);
        delete job.storageWarning;
        this.transient.delete(job.id);
        return true;
      } catch {
        Object.assign(job, changes);
        job.storageWarning =
          job.status === "completed"
            ? "This answer is visible but could not be saved. Do not repeat the paid request to fix storage."
            : "The failure could not be saved locally.";
        if (job.status === "completed") job.result.storage_warning = job.storageWarning;
        this.transient.set(job.id, job);
        return false;
      }
    }

    async execute(job, apiKey) {
      try {
        const result = await this.provider.complete(job, apiKey, {
          onProgress: (progress) => {
            job.progress = progress;
            this.onChange();
          },
        });
        await this.saveOutcome(job, {
          status: "completed",
          result,
          error: null,
          code: null,
          retryable: false,
        });
      } catch (error) {
        await this.saveOutcome(job, {
          status: error.uncertain ? "interrupted" : "failed",
          error: error.message || "The request failed. No automatic retry was made.",
          code: error.code || "provider",
          retryable: true,
        });
      } finally {
        this.active.delete(job.id);
        this.onChange();
        // Cache maintenance can never rerun a request or change its visible outcome.
        void this.store.prune().catch(() => {});
      }
    }

    async poll(jobId) {
      const job = await this.get(jobId);
      if (!job) throw new Error("The request is no longer available.");
      return {
        job_id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        kind: job.kind,
        model: job.model,
        result: job.result,
        error: job.error ? this.failureMessage(job) : job.error,
        code: job.code,
        progress: job.progress,
        retryable: Boolean(job.retryable),
        storageWarning: job.storageWarning,
        regionId: job.input?.regionId,
        runId: job.input?.runId,
      };
    }

    async history(idOrRun) {
      const job = (await this.get(idOrRun)) || (await this.source(idOrRun));
      if (!job) throw new Error("This saved translation is no longer available.");
      if (job.kind === "translation" && job.status === "completed")
        return { ...(await this.reopen(job.result.run_id)), job: await this.poll(job.id) };
      if (job.kind === "study") {
        const studyJob = await this.poll(job.id);
        return { ...(await this.reopen(job.input.runId)), job: studyJob, studyJob };
      }
      return {
        imageDataUrl: job.input.imageDataUrl,
        job: await this.poll(job.id),
      };
    }
  }

  const api = { RequestService, RequestError, digest, id };
  globalThis.MangaJobs = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
