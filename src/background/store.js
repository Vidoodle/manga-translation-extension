/* Durable request intent, answers and local page references. No credentials. */
(() => {
  "use strict";

  const unresolved = (job) => job.status === "running" || job.status === "interrupted";
  const estimate = (value) => JSON.stringify(value).length * 2;

  function retainRecent(records, retained, budget, bytes, countLimit, clear) {
    if (clear) return bytes;
    let count = 0;

    const recent = [...records].sort(
      (a, b) =>
        (b.accessedAt || b.updatedAt || b.createdAt) - (a.accessedAt || a.updatedAt || a.createdAt),
    );

    for (const record of recent) {
      if (retained.has(record.id)) continue;
      const size = estimate(record);
      if (count < countLimit && bytes + size < budget) {
        retained.add(record.id);
        bytes += size;
        count++;
      }
    }

    return bytes;
  }

  function retentionPlan(jobs, pages, regions, clear) {
    const jobIds = new Set(jobs.filter(unresolved).map((job) => job.id));
    const requiredRuns = new Set(
      jobs
        .filter(unresolved)
        .map((job) => job.input.runId)
        .filter(Boolean),
    );
    for (const job of jobs) if (requiredRuns.has(job.runId)) jobIds.add(job.id);

    const protectedJobs = jobs.filter((job) => jobIds.has(job.id));
    const pageIds = new Set(
      protectedJobs
        .flatMap((job) => job.associations || [])
        .map((item) => item.pageId)
        .filter(Boolean),
    );
    // Unresolved records have their own admission limit. They must not consume
    // the ordinary cache budget and immediately evict a newly completed answer.
    let bytes = retainRecent(jobs, jobIds, 120 * 1024 * 1024, 0, 200, clear);

    // Study entries retain source identity and never outlive an evicted source run.
    const retainedRuns = new Set(
      jobs
        .filter((job) => jobIds.has(job.id))
        .map((job) => job.runId)
        .filter(Boolean),
    );
    for (const job of jobs) {
      if (job.kind === "study" && !unresolved(job) && !retainedRuns.has(job.input.runId))
        jobIds.delete(job.id);
    }

    const protectedRuns = new Set(protectedJobs.map((job) => job.runId).filter(Boolean));
    bytes += estimate(
      regions.filter(
        (region) =>
          retainedRuns.has(region.runId) &&
          !(protectedRuns.has(region.runId) && pageIds.has(region.pageId)),
      ),
    );
    retainRecent(pages, pageIds, 160 * 1024 * 1024, bytes, 150, clear);
    const regionIds = new Set(
      regions
        .filter((region) => retainedRuns.has(region.runId) && pageIds.has(region.pageId))
        .map((region) => region.id),
    );
    return { jobIds, pageIds, regionIds };
  }

  class StoreError extends Error {
    constructor(message, options) {
      super(message, options);
      this.code = "storage";
    }
  }

  class MangaStore {
    constructor(indexedDB = globalThis.indexedDB, name = "manga-reader-v3") {
      this.indexedDB = indexedDB;
      this.name = name;
      this.db = null;
    }

    async open() {
      if (this.db) return this;
      this.db = await new Promise((resolve, reject) => {
        const request = this.indexedDB.open(this.name, 2);
        request.onupgradeneeded = (event) => {
          const db = request.result;
          if (event.oldVersion === 0) {
            const jobs = db.createObjectStore("jobs", { keyPath: "id" });
            jobs.createIndex("runId", "runId", { unique: true });
            db.createObjectStore("claims", { keyPath: "key" });
            db.createObjectStore("pages", { keyPath: "id" });
            const regions = db.createObjectStore("regions", { keyPath: "id" });
            regions.createIndex("pageId", "pageId");
          } else {
            // One-time answer-format reset. Request intent and any source needed
            // for its deliberate retry survive; no credentials live in this DB.
            const tx = request.transaction;
            const jobs = tx.objectStore("jobs");
            const snapshot = jobs.getAll();
            snapshot.onsuccess = () => {
              const records = snapshot.result;
              const pending = records.filter((job) => job.status !== "completed");
              const requiredRuns = new Set(pending.map((job) => job.input?.runId).filter(Boolean));
              const retained = new Set(pending.map((job) => job.id));
              for (const job of records) {
                if (job.kind === "translation" && requiredRuns.has(job.runId || job.result?.run_id))
                  retained.add(job.id);
                if (!retained.has(job.id)) jobs.delete(job.id);
              }
              const claims = tx.objectStore("claims").openCursor();
              claims.onsuccess = () => {
                const cursor = claims.result;
                if (!cursor) return;
                if (!retained.has(cursor.value.jobId)) cursor.delete();
                cursor.continue();
              };
            };
            tx.objectStore("pages").clear();
            tx.objectStore("regions").clear();
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Local cache unavailable."));
        request.onblocked = () =>
          reject(new StoreError("Close older extension views so local storage can be upgraded."));
      }).catch((error) => {
        if (error instanceof StoreError) throw error;
        throw new StoreError(
          error?.name === "SecurityError"
            ? "Firefox blocked access to the extension's local cache. Restart Firefox and reopen the extension. Saved translations cannot be loaded and new translations cannot be sent until local storage is available."
            : "The extension's local cache could not be opened. Restart Firefox and reopen the extension. No new translation was sent.",
          { cause: error },
        );
      });
      this.db.onversionchange = () => {
        this.db.close();
        this.db = null;
      };
      await this.recover();
      return this;
    }

    transaction(names, mode, body) {
      return new Promise((resolve, reject) => {
        let tx;
        let result;
        try {
          tx = this.db.transaction(names, mode);
          tx.oncomplete = () => resolve(result);
          tx.onerror = tx.onabort = () =>
            reject(
              new StoreError(
                "Local storage failed. A submitted request may already have been charged; do not repeat it automatically.",
              ),
            );
          body(tx, (value) => {
            result = value;
          });
        } catch (error) {
          try {
            tx?.abort();
          } catch {}
          reject(
            error instanceof StoreError
              ? error
              : new StoreError("Local storage is unavailable. No new request was sent."),
          );
        }
      });
    }

    get(name, key) {
      return this.transaction([name], "readonly", (tx, done) => {
        const r = tx.objectStore(name).get(key);
        r.onsuccess = () => done(r.result);
      });
    }

    all(name) {
      return this.transaction([name], "readonly", (tx, done) => {
        const r = tx.objectStore(name).getAll();
        r.onsuccess = () => done(r.result);
      });
    }

    async lookup(key) {
      const claim = await this.get("claims", key);
      return claim ? this.get("jobs", claim.jobId) : undefined;
    }

    async recover() {
      return this.transaction(["jobs"], "readwrite", (tx) => {
        const store = tx.objectStore("jobs");
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const job = cursor.value;
          if (job.status === "running") {
            Object.assign(job, {
              status: "interrupted",
              code: "interrupted",
              retryable: true,
              error:
                "The extension stopped before the outcome was saved. This request may already have been charged. Retry only deliberately.",
              updatedAt: Date.now(),
            });
            cursor.update(job);
          }
          cursor.continue();
        };
      });
    }
    // A single read/write transaction serializes claims even across multiple tabs.
    async claim(candidate, retryJobId, allowCreate = true) {
      const claimed = await this.transaction(
        ["claims", "jobs", "regions"],
        "readwrite",
        (tx, done) => {
          const claims = tx.objectStore("claims");
          const jobs = tx.objectStore("jobs");
          const lookup = (original) => {
            const found = claims.get(candidate.key);
            found.onsuccess = () => {
              const put = () => {
                if (original?.supersededBy)
                  return done({
                    error:
                      "This attempt was already retried. Open its newer request from Saved translations.",
                  });
                return allowCreate
                  ? this.insertClaim(tx, candidate, original, done)
                  : done({ missing: true });
              };
              if (!found.result) return put();
              const request = jobs.get(found.result.jobId);
              request.onsuccess = () => {
                const existing = request.result;
                if (!existing) return put();
                if (
                  retryJobId === existing.id &&
                  ["failed", "interrupted"].includes(existing.status)
                ) {
                  return put();
                }
                // A prompt/schema upgrade changes the claim key. A deliberate
                // retry must still resolve the older intent, even when it joins
                // an already-running or cached request under the new key.
                if (original && original.id !== existing.id && !original.supersededBy)
                  this.supersede(jobs, original, existing.id);
                if (candidate.associations?.length) {
                  existing.associations ||= [];
                  for (const association of candidate.associations) {
                    if (
                      !existing.associations.some((item) => item.id === association.id) &&
                      existing.associations.length < 100
                    )
                      existing.associations.push(association);
                    if (existing.status === "completed") this.putRegion(tx, existing, association);
                  }
                }
                existing.accessedAt = Date.now();
                jobs.put(existing);
                done({ job: existing, created: false });
              };
            };
          };
          if (!retryJobId) lookup();
          else {
            const request = jobs.get(retryJobId);
            request.onsuccess = () => {
              const original = request.result;
              if (
                !original ||
                !["failed", "interrupted"].includes(original.status) ||
                original.kind !== candidate.kind ||
                original.model !== candidate.model ||
                JSON.stringify(original.input) !== JSON.stringify(candidate.input)
              )
                return done({
                  error: "The original request is no longer available for this retry.",
                });
              lookup(original);
            };
          }
        },
      );

      if (claimed.error) throw new StoreError(claimed.error);
      return claimed;
    }

    insertClaim(tx, candidate, retried, done) {
      const jobs = tx.objectStore("jobs");
      const snapshot = jobs.getAll();
      snapshot.onsuccess = () => {
        const existing = snapshot.result;
        const protectedCount = existing.filter(
          (job) => unresolved(job) && job.id !== retried?.id,
        ).length;
        if (protectedCount >= 50 || estimate(existing) + estimate(candidate) > 220 * 1024 * 1024) {
          done({
            error:
              "Local request storage is full. Clear older cached entries before making another request.",
          });
          return;
        }

        if (retried) this.supersede(jobs, retried, candidate.id);

        jobs.put(candidate);
        tx.objectStore("claims").put({ key: candidate.key, jobId: candidate.id });
        done({ job: candidate, created: true });
      };
    }

    supersede(jobs, original, successorId) {
      jobs.put({
        ...original,
        status: "failed",
        supersededBy: successorId,
        retryable: false,
        error: "This attempt was explicitly retried. It may still have incurred a charge.",
        updatedAt: Date.now(),
      });
    }

    putRegion(tx, job, association) {
      if (job.kind !== "translation" || !association.pageId || !job.result) return;
      tx.objectStore("regions").put({
        ...association,
        id: association.id + ":" + job.result.run_id,
        runId: job.result.run_id,
        model: job.model,
        context: job.input.context,
        createdAt: job.createdAt,
      });
    }

    finish(id, changes) {
      return this.transaction(["jobs", "regions"], "readwrite", (tx, done) => {
        const store = tx.objectStore("jobs");
        const request = store.get(id);
        request.onsuccess = () => {
          const job = request.result;
          if (!job) {
            tx.abort();
            return;
          }
          // Concurrent reconciliation must not overwrite a terminal result or
          // turn an already superseded attempt back into a retryable request.
          if (job.status !== "running") {
            done(job);
            return;
          }
          Object.assign(job, changes, { updatedAt: Date.now(), accessedAt: Date.now() });
          if (job.kind === "translation" && changes.result) job.runId = changes.result.run_id;
          store.put(job);
          if (job.status === "completed")
            for (const association of job.associations || []) this.putRegion(tx, job, association);
          done(job);
        };
      });
    }

    run(runId) {
      return this.transaction(["jobs"], "readonly", (tx, done) => {
        const r = tx.objectStore("jobs").index("runId").get(runId);
        r.onsuccess = () => done(r.result);
      });
    }

    async studies(runId) {
      const result = {};
      for (const job of await this.all("jobs"))
        if (job.kind === "study" && job.status === "completed" && job.input.runId === runId)
          result[job.input.regionId] = job.result;
      return result;
    }

    async page(id) {
      const [page, regions] = await Promise.all([
        this.get("pages", id),
        this.transaction(["regions"], "readonly", (tx, done) => {
          const request = tx.objectStore("regions").index("pageId").getAll(id);
          request.onsuccess = () => done(request.result);
        }),
      ]);
      const sources = new Map();
      for (const region of regions) {
        if (!sources.has(region.runId)) sources.set(region.runId, await this.run(region.runId));
        region.imageDataUrl = sources.get(region.runId)?.input.imageDataUrl;
      }
      return { page, regions: regions.filter((region) => region.imageDataUrl) };
    }

    savePage(page) {
      return this.transaction(["pages"], "readwrite", (tx, done) => {
        tx.objectStore("pages").put(page);
        done(page.id);
      });
    }

    async stats() {
      const [jobs, pages, regions] = await Promise.all(
        ["jobs", "pages", "regions"].map((name) => this.all(name)),
      );
      return {
        entries: jobs.filter((job) => job.status === "completed").length,
        pages: pages.length,
        regions: regions.length,
        bytes: estimate(jobs) + estimate(pages) + estimate(regions),
        unresolved: jobs.filter(unresolved).length,
      };
    }

    async history() {
      const jobs = await this.all("jobs");
      return jobs
        .filter((job) => job.kind === "translation" || job.status !== "completed")
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((job) => ({
          id: job.result?.run_id && job.kind === "translation" ? job.result.run_id : job.id,
          jobId: job.id,
          kind: job.kind,
          createdAt: job.createdAt,
          model: job.model,
          status: job.status,
          japanese:
            job.result?.analysis?.regions
              ?.map((region) => region.japanese)
              .join(" / ")
              .slice(0, 180) ||
            job.input?.source?.selected?.japanese ||
            "",
          cost_usd: job.result?.usage?.cost_usd ?? null,
        }));
    }

    async prune(clear = false) {
      // Keep unresolved inputs and their source pages/runs even when clearing cache.
      return this.transaction(["jobs", "claims", "pages", "regions"], "readwrite", (tx, done) => {
        const jobsStore = tx.objectStore("jobs");
        const pagesStore = tx.objectStore("pages");
        const regionsStore = tx.objectStore("regions");
        const requests = [jobsStore.getAll(), pagesStore.getAll(), regionsStore.getAll()];
        let loaded = 0;
        requests.forEach((request) => {
          request.onsuccess = () => {
            if (++loaded !== 3) return;
            const [jobs, pages, regions] = requests.map((item) => item.result);
            const plan = retentionPlan(jobs, pages, regions, clear);
            this.applyRetention(tx, { jobs, pages, regions }, plan);
            done(true);
          };
        });
      });
    }

    applyRetention(tx, records, plan) {
      for (const [name, retained] of [
        ["jobs", plan.jobIds],
        ["pages", plan.pageIds],
        ["regions", plan.regionIds],
      ]) {
        const store = tx.objectStore(name);
        for (const record of records[name]) if (!retained.has(record.id)) store.delete(record.id);
      }

      const request = tx.objectStore("claims").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!plan.jobIds.has(cursor.value.jobId)) cursor.delete();
        cursor.continue();
      };
    }
  }

  const api = { MangaStore, StoreError };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalThis.MangaStorage = api;
})();
