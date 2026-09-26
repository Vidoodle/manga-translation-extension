/* Browser message composition. Data, requests, settings and capture have separate services. */
(() => {
  "use strict";

  function errorResponse(error) {
    return {
      ok: false,
      error: error?.message || "The request could not be completed.",
      ...(error?.code ? { code: error.code } : {}),
      ...(error?.jobId ? { jobId: error.jobId } : {}),
      ...(error?.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}),
    };
  }

  function createBackground(extension, dependencies = {}) {
    const store = dependencies.store || new MangaStorage.MangaStore();
    const provider = dependencies.provider || MangaProvider;
    const settings =
      dependencies.settings || new MangaSettings.SettingsService(extension, provider);
    let reader;
    const jobs = new MangaJobs.RequestService({
      store,
      provider,
      settings,
      onChange: () => reader?.notify(),
    });
    reader = new MangaReader.ReaderService({
      extension,
      settings,
      jobs,
      digest: MangaJobs.digest,
      loadStyles: dependencies.loadStyles,
    });
    const pages = new MangaPages.PageService(store, MangaReader, MangaJobs);
    const ready = Promise.all([store.open(), reader.ready]);
    ready.catch(() => {});
    const activeTab = async () =>
      (await extension.tabs.query({ active: true, currentWindow: true }))[0];
    async function startReader(tab) {
      const issue = await settings.setup();
      if (issue) {
        let hasSaved = false;
        try {
          await ready;
          hasSaved = (await store.history()).length > 0;
        } catch {
          // Setup remains available if local saved data cannot be read.
        }
        if (hasSaved) return reader.start(tab, { library: true });
        throw Object.assign(new Error(issue.message), { code: issue.code });
      }
      await ready;
      return reader.start(tab);
    }
    const requireJob = (session, id) => {
      if (!session.jobs.includes(id))
        throw new Error(
          "This request does not belong to this reading session. Open it from Saved translations.",
        );
    };
    const requireRun = (session, id) => {
      if (!session.runs.includes(id))
        throw new Error(
          "This translation does not belong to this reading session. Open it from Saved translations.",
        );
    };
    async function ownSubmission(session, operation) {
      if (session.readOnly) {
        const issue = await settings.setup();
        if (issue) throw Object.assign(new Error(issue.message), { code: issue.code });
      }
      try {
        const result = await operation();
        await reader.ownJob(session, result.jobId);
        return { ok: true, ...result };
      } catch (error) {
        if (error.jobId) await reader.ownJob(session, error.jobId);
        throw error;
      }
    }

    async function analyzeSelection(session, message) {
      if (session.closed)
        throw new Error("Activate the assistant before requesting a translation.");
      await reader.active(session);

      if (message.sourceRunId) {
        requireRun(session, message.sourceRunId);
        const original = await jobs.source(message.sourceRunId);
        if (!original?.result) throw new Error("This source translation is no longer saved.");
        if (!message.model)
          throw new Error("Choose a model explicitly to compare this saved selection.");

        return ownSubmission(session, () =>
          jobs.translation({
            imageDataUrl: original.input.imageDataUrl,
            context: original.input.context,
            associations: original.associations,
            model: message.model,
            retryJobId: message.retryJobId,
          }),
        );
      }

      if (!session.captures.length) throw new Error("Select the visible text first.");
      const imageDataUrl = MangaPages.image(message.imageDataUrl);
      const context = message.context ?? "";
      if (typeof context !== "string" || context.length > 12000)
        throw new Error("Reading context must be at most 12,000 characters.");

      const association = await pages.association(session.scope, message);
      return ownSubmission(session, () =>
        jobs.translation({
          imageDataUrl,
          context,
          association,
          model: message.model || session.model,
          retryJobId: message.retryJobId,
        }),
      );
    }

    async function pollRequest(session, jobId) {
      requireJob(session, jobId);
      const job = await jobs.poll(jobId);
      if (job.kind === "translation" && job.result?.run_id)
        await reader.ownRun(session, job.result.run_id);

      return { ok: true, job };
    }

    async function requestStudy(session, message) {
      requireRun(session, message.runId);
      await reader.active(session);
      if (session.closed)
        throw new Error("Open the saved translation before requesting an explanation.");

      return ownSubmission(session, () =>
        jobs.study(message.runId, message.regionId, message.retryJobId),
      );
    }

    async function retryRequest(session, jobId) {
      requireJob(session, jobId);
      await reader.active(session);
      if (session.closed) throw new Error("Open the saved request before retrying.");

      return ownSubmission(session, () => jobs.retry(jobId));
    }

    function requireOpen(session) {
      if (session.closed || reader.current.get(session.tabId) !== session.sessionId)
        throw new Error("This reading session has changed. Activate the assistant again.");
    }

    async function openHistory(session, id) {
      requireOpen(session);
      const history = await jobs.history(id);
      requireOpen(session);
      if (history.job?.job_id) await reader.ownJob(session, history.job.job_id);
      if (history.result?.run_id) await reader.ownRun(session, history.result.run_id);
      return { ok: true, history };
    }

    async function popup(message, sender) {
      if (!reader.popupSender(sender))
        throw new Error("This request is only available from extension settings.");
      switch (message.type) {
        case "manga:popup-config":
          return { ok: true, config: await settings.config() };
        case "manga:popup-save-key":
          await settings.saveKey(message.apiKey);
          return { ok: true };
        case "manga:popup-remove-key":
          await settings.removeKey();
          return { ok: true };
        case "manga:popup-reset-setup":
          await settings.resetSetup();
          return { ok: true };
        case "manga:popup-save-model":
          await settings.saveModel(message.model);
          return { ok: true };
        case "manga:popup-models":
          return {
            ok: true,
            catalog: await settings.models(Boolean(message.force || message.refresh)),
          };
        case "manga:popup-shortcut":
          return {
            ok: true,
            shortcut: await settings.changeShortcut(message.action, message.shortcut),
          };
        case "manga:popup-cache-stats":
          await ready;
          return { ok: true, stats: await store.stats() };
        case "manga:popup-clear-cache":
          await ready;
          await store.prune(true);
          return { ok: true, stats: await store.stats() };
        default:
          throw new Error("Unknown extension settings request.");
      }
    }

    async function handle(message, sender) {
      if (!message || typeof message.type !== "string") throw new Error("Unknown request.");
      if (message.type.startsWith("manga:popup-")) return popup(message, sender);
      await ready;
      const session = await reader.authenticate(message, sender);
      switch (message.type) {
        case "manga:cancel":
          session.closed = true;
          await reader.save();
          reader.notify();
          return { ok: true };
        case "manga:restart":
          return startReader(await reader.active(session));
        case "manga:save-card-position":
          await settings.saveCardPosition(message.position);
          return { ok: true };
        case "manga:capture":
        case "manga:verify-capture":
          return { ok: true, imageDataUrl: await reader.capture(session, message) };
        case "manga:models":
          return { ok: true, catalog: await settings.models(true) };
        case "manga:library": {
          requireOpen(session);
          const entries = await store.history();
          requireOpen(session);
          return { ok: true, entries };
        }
        case "manga:history":
          return openHistory(session, message.id);
        case "manga:page-list":
          return { ok: true, pages: await pages.list(session.scope) };
        case "manga:page-get": {
          const result = await pages.get(session.scope, message.pageId, {
            includeReference: message.includeReference !== false,
          });
          for (const region of result.regions) await reader.ownRun(session, region.runId);
          return { ok: true, ...result };
        }
        case "manga:page-save":
          return { ok: true, pageId: await pages.save(session.scope, message.page) };
        case "manga:analyze":
          return analyzeSelection(session, message);
        case "manga:poll":
          return pollRequest(session, message.jobId);
        case "manga:reopen":
          requireRun(session, message.runId);
          return { ok: true, ...(await jobs.reopen(message.runId)) };
        case "manga:study":
          return requestStudy(session, message);
        case "manga:retry":
          return retryRequest(session, message.jobId);
        default:
          throw new Error("Unknown reading request.");
      }
    }

    const listener = (message, sender) =>
      message?.type?.startsWith("manga:")
        ? handle(message, sender).catch(errorResponse)
        : undefined;
    extension.runtime.onMessage.addListener(listener);
    extension.runtime.onConnect.addListener((port) => reader.connect(port));
    const commandQueue = new Map();
    extension.commands.onCommand.addListener((command, tab) => {
      if (command !== "select-manga") return;
      return (async () => {
        tab ||= await activeTab();
        const previous = commandQueue.get(tab?.id) || Promise.resolve();
        const operation = previous
          .catch(() => {})
          .then(async () => {
            if (!(await reader.handleShortcut(tab))) await startReader(tab);
            await extension.action.setBadgeText({ text: "", tabId: tab.id });
          });
        commandQueue.set(tab?.id, operation);
        try {
          await operation;
        } finally {
          if (commandQueue.get(tab?.id) === operation) commandQueue.delete(tab?.id);
        }
      })().catch(async (error) => {
        if (tab?.id) {
          await extension.action.setBadgeText({ text: "!", tabId: tab.id });
          await extension.action.setTitle({ title: errorResponse(error).error, tabId: tab.id });
        }
        if (error.code?.startsWith("setup-")) {
          try {
            await extension.action.openPopup();
          } catch {
            // The badge/title still explain setup if Firefox cannot open the popup.
          }
        }
      });
    });
    extension.tabs.onRemoved.addListener((tabId) => {
      void reader.invalidate(tabId).catch(() => {});
    });
    extension.tabs.onUpdated.addListener((tabId, change) => {
      if (change.url || change.status === "loading") void reader.invalidate(tabId).catch(() => {});
    });
    return { ready, handle, listener, store, jobs, reader, settings, pages };
  }

  globalThis.MangaBackground = { createBackground, errorResponse };
  if (typeof module !== "undefined" && module.exports) module.exports = globalThis.MangaBackground;
  const extension = globalThis.browser ?? globalThis.chrome;
  if (extension) createBackground(extension);
})();
