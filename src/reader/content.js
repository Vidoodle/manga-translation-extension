/* In-page selection, session lifecycle, and explicit request coordination. */
(() => {
  "use strict";
  const vision =
    typeof module !== "undefined" && module.exports
      ? require("./vision.js")
      : globalThis.MangaVision;
  const { normalizeRect, pixelCrop, placeCard } = vision;
  const ReaderView =
    typeof module !== "undefined" && module.exports
      ? require("./reader-view.js")
      : globalThis.ReaderView;
  const PageTracker =
    typeof module !== "undefined" && module.exports
      ? require("./page-tracker.js")
      : globalThis.PageTracker;
  class SelectionOverlay {
    constructor(win, runtime) {
      this.ui = new ReaderView(this);
      this.tracker = new PageTracker(this);
      this.win = win;
      this.doc = win.document;
      this.runtime = runtime;
      this.generation = 0;
      this.selectionRevision = 0;
      this.session = null;
      this.cleanups = [];
      this.timers = new Set();
      this.ports = new Map();
      this.resetSelection();
    }

    resetSelection() {
      this.selectionRevision++;
      this.selection = {
        run: null,
        regionIndex: 0,
        studies: new Map(),
        cropData: null,
        translationJob: null,
        startedAt: null,
        rect: null,
        detachedMessage: "",
        detached: false,
        cached: false,
        dragging: false,
        dragOrigin: null,
        dragPointerId: null,
        // Async operations retain this set, so a superseded operation cannot
        // change the busy state of a later selection or session.
        pending: new Set(),
      };
    }

    resetSession(message) {
      this.session = message.sessionId;
      this.library = null;
      this.cardPosition = message.cardPosition || this.cardPosition || { x: 1, y: 1 };
      this.model = message.model || "";
      this.shortcut = message.shortcut || "";
      this.setupRequired = !!message.setupRequired;
      this.setupWarning =
        message.setupWarning ||
        (this.setupRequired
          ? "Complete extension setup: add your OpenRouter key and choose a model, then activate again."
          : "");
      this.captureError = null;
      this.resetSelection();
    }

    listen(target, event, handler, options) {
      target.addEventListener(event, handler, options);
      this.cleanups.push(() => target.removeEventListener(event, handler, options));
    }

    later(handler, delay) {
      const timer = this.win.setTimeout(() => {
        this.timers.delete(timer);
        handler();
      }, delay);
      this.timers.add(timer);
      return timer;
    }

    valid(generation, revision) {
      return (
        !!this.session &&
        this.generation === generation &&
        !!this.ui.host?.isConnected &&
        (revision === undefined || revision === this.selectionRevision)
      );
    }

    ownEvent(event) {
      return (
        !!this.ui.host &&
        (event.composedPath?.().includes(this.ui.host) || this.ui.host.contains(event.target))
      );
    }

    async send(type, extra = {}) {
      const generation = this.generation;
      const result = await this.runtime.sendMessage({
        type: `manga:${type}`,
        sessionId: this.session,
        ...extra,
      });
      if (!result?.ok) {
        if (result?.code?.startsWith("setup-") && this.valid(generation)) {
          this.setupRequired = true;
          this.setupWarning = result.error;
          this.ui.updateSetup();
          if (this.selection.run) this.ui.renderTranslation();
        }
        const error = new Error(
          result?.error || "The extension did not respond. Open its settings to reconnect.",
        );
        Object.assign(error, {
          code: result?.code,
          jobId: result?.jobId,
          retryable: result?.retryable,
          retryAfterMs: result?.retryAfterMs,
        });
        throw error;
      }
      return result;
    }

    connectPort(sessionId) {
      if (!this.runtime.connect) return;
      const record = { active: null, pending: 0, closed: false, sessionId };
      try {
        record.port = this.runtime.connect({ name: "manga:reader" });
        this.ports.set(sessionId, record);
        record.port.onMessage.addListener((message) => {
          if (message?.type === "manga:work-status") {
            record.active = message.active;
            this.releasePort(record);
          }
        });
        record.port.onDisconnect.addListener(() => {
          record.closed = true;
          this.win.clearTimeout(record.heartbeat);
          this.ports.delete(sessionId);
        });
        record.port.postMessage({ type: "bind", sessionId });
        const heartbeat = () => {
          if (record.closed) return;
          try {
            record.port.postMessage({ type: "heartbeat", sessionId });
          } catch {
            return;
          }
          record.heartbeat = this.win.setTimeout(heartbeat, 15000);
        };
        record.heartbeat = this.win.setTimeout(heartbeat, 15000);
      } catch {
        // Status checks use runtime messages and can work without the keepalive port.
      }
    }

    releasePort(record) {
      if (
        !record ||
        record.closed ||
        this.session === record.sessionId ||
        record.active !== 0 ||
        record.pending
      )
        return;
      record.closed = true;
      this.win.clearTimeout(record.heartbeat);
      this.ports.delete(record.sessionId);
      record.port.disconnect();
    }

    async submit(type, extra) {
      const record = this.ports.get(this.session);
      if (record) {
        record.pending++;
        record.active = Math.max(1, record.active || 0);
      }
      try {
        return await this.send(type, extra);
      } finally {
        if (record) {
          record.pending--;
          this.releasePort(record);
        }
      }
    }

    close(notify = true, restoreFocus = true) {
      const sessionId = this.session,
        previousFocus = this.previousFocus;
      this.previousFocus = null;
      this.session = null;
      this.library = null;
      this.generation++;
      for (const cleanup of this.cleanups.splice(0)) cleanup();
      for (const timer of this.timers) this.win.clearTimeout(timer);
      this.timers.clear();
      this.observer?.disconnect();
      this.observer = null;
      this.ui.destroy();
      if (restoreFocus && previousFocus?.isConnected) {
        try {
          previousFocus.focus({ preventScroll: true });
        } catch {}
      }
      if (notify && sessionId)
        Promise.resolve(this.runtime.sendMessage({ type: "manga:cancel", sessionId })).catch(
          () => {},
        );
      this.releasePort(this.ports.get(sessionId));
    }

    start(message) {
      if (!message?.sessionId) return;
      const previousFocus = this.previousFocus?.isConnected
        ? this.previousFocus
        : this.doc.activeElement;
      this.close(this.session !== message.sessionId, false);
      this.resetSession(message);
      this.previousFocus = previousFocus;
      const generation = this.generation;
      this.ui.mount(message.readerCss || "");
      this.viewport = { width: this.win.innerWidth, height: this.win.innerHeight };
      this.connectPort(this.session);
      const invalidate = (event) => {
        if (this.ownEvent(event)) return;
        if (this.ui.card) this.detach();
        else this.close();
      };
      const reposition = () => {
        if (!this.ui.card) return this.close();
        this.ui.cancelCardDrag();
        this.detach();
        this.viewport = { width: this.win.innerWidth, height: this.win.innerHeight };
        (this.doc.fullscreenElement || this.doc.documentElement).append(this.ui.host);
        this.ui.positionCard();
      };
      this.listen(this.win, "resize", reposition);
      this.listen(this.win, "scroll", invalidate, true);
      this.listen(this.win, "pagehide", () => this.close());
      this.listen(this.win, "popstate", invalidate);
      this.listen(this.win, "hashchange", invalidate);
      this.listen(this.doc, "fullscreenchange", reposition);
      this.listen(this.doc, "visibilitychange", () => {
        if (this.doc.hidden) invalidate({});
      });
      this.listen(this.doc, "pointerdown", invalidate, true);
      this.listen(this.doc, "wheel", invalidate, { capture: true, passive: true });
      this.listen(
        this.doc,
        "keydown",
        (event) => {
          if (event.key === "Escape" && event.isTrusted) {
            event.preventDefault();
            event.stopPropagation();
            this.close();
          } else if (
            !this.ownEvent(event) &&
            [
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "PageUp",
              "PageDown",
              "Home",
              "End",
              " ",
            ].includes(event.key)
          )
            invalidate(event);
        },
        true,
      );
      if (this.win.MutationObserver) {
        this.observer = new this.win.MutationObserver((records) => {
          if (!this.valid(generation) || this.captureError) return;
          const surface = (node) =>
            node?.nodeType === 1 &&
            !this.ui.host.contains(node) &&
            (node.matches?.("canvas,img,iframe") || node.querySelector?.("canvas,img,iframe"));
          if (
            records.some((record) =>
              record.type === "attributes"
                ? surface(record.target)
                : [...record.addedNodes, ...record.removedNodes].some(surface),
            )
          )
            invalidate({});
        });
        this.observer.observe(this.doc.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["src", "srcset", "width", "height"],
        });
      }
      if (message.history) {
        this.showHistory(message.history);
        return;
      }
      if (message.library) {
        void this.openLibrary();
        return;
      }
      if (this.setupRequired) {
        this.ui.showSetupRequired();
        return;
      }
      this.beginSelection();
      if (message.error) this.ui.instruction.textContent = message.error;
    }

    beginSelection() {
      this.resetSelection();
      this.library = null;
      if (this.setupRequired) {
        this.ui.showSetupRequired();
        return;
      }
      if (this.captureError) {
        this.ui.showCaptureError(this.captureError.message);
        return;
      }
      this.ui.beginSelection();
    }

    blockCapture(error) {
      if (!["screenshot-read", "screenshot-crop", "capture-access"].includes(error?.code))
        return false;
      this.captureError = error;
      if (this.ui.card && this.selection.cropData) {
        this.ui.updateSetup();
        this.detach(`${error.message} This answer uses the saved selection.`);
      } else this.ui.showCaptureError(error.message);
      return true;
    }

    stopSelectionEvent(event) {
      event.preventDefault();
      event.stopPropagation();
    }

    beginDrag(event) {
      if (
        this.setupRequired ||
        this.captureError ||
        !event.isTrusted ||
        event.target?.closest?.("button")
      )
        return;
      this.stopSelectionEvent(event);
      if (
        event.button !== 0 ||
        this.selection.dragPointerId !== null ||
        this.selection.pending.has("capture")
      )
        return;
      this.selection.dragPointerId = event.pointerId;
      this.selection.dragOrigin = { x: event.clientX, y: event.clientY };
      this.selection.dragging = true;
      this.ui.shield.setPointerCapture?.(this.selection.dragPointerId);
      this.ui.selection.hidden = false;
      this.ui.shield.style.background = "transparent";
      this.ui.updateSelection(
        normalizeRect(this.selection.dragOrigin, this.selection.dragOrigin, this.viewport),
      );
    }

    updateDrag(event) {
      if (
        !event.isTrusted ||
        this.selection.dragPointerId !== event.pointerId ||
        !this.selection.dragOrigin
      )
        return;
      this.stopSelectionEvent(event);
      const drawn = normalizeRect(
        this.selection.dragOrigin,
        { x: event.clientX, y: event.clientY },
        this.viewport,
      );
      this.ui.updateSelection(drawn);
      this.ui.instruction.textContent =
        "Drag around the Japanese you want translated · Esc to cancel";
    }

    finishDrag(event) {
      if (
        !event.isTrusted ||
        this.selection.dragPointerId !== event.pointerId ||
        !this.selection.dragOrigin
      )
        return;
      this.stopSelectionEvent(event);
      this.ui.shield.releasePointerCapture?.(this.selection.dragPointerId);
      this.selection.dragPointerId = null;
      this.selection.dragging = false;
      this.selection.rect = normalizeRect(
        this.selection.dragOrigin,
        { x: event.clientX, y: event.clientY },
        this.viewport,
      );
      this.selection.dragOrigin = null;
      if (this.selection.rect.width < 12 || this.selection.rect.height < 12) {
        this.ui.instruction.textContent = "Drag a larger area around the text · Esc to cancel";
        this.ui.selection.hidden = true;
        return;
      }
      this.captureSelection();
    }

    async captureSelection() {
      if (this.setupRequired || this.captureError || !this.selection.rect) return;
      const selection = this.selection;
      if (selection.pending.has("capture")) return;
      selection.pending.add("capture");
      selection.startedAt = Date.now();
      const revision = ++this.selectionRevision;
      const generation = this.generation,
        viewport = { ...this.viewport },
        rect = { ...selection.rect };
      this.ui.instruction.textContent = "Preparing selection…";
      try {
        const screenshot = await this.tracker.capture(generation, viewport);
        if (!screenshot || !this.valid(generation, revision)) return;
        this.ui.showSelectionCard();
        this.ui.showPending("Preparing selection…");
        const imageDataUrl = await this.tracker.cropScreenshot(screenshot, rect, viewport);
        if (!this.valid(generation, revision)) return;
        selection.cropData = imageDataUrl;
        selection.detached = false;
        selection.cached = false;
        selection.run = null;
        selection.studies.clear();
        this.ui.showPending("Translating selection…");
        const submitted = await this.submit("analyze", {
          imageDataUrl,
          rect,
          viewport,
          context: "",
        });
        if (!this.valid(generation, revision)) return;
        selection.translationJob = submitted.jobId;
        selection.cached = !!submitted.cached;
        this.resumeTranslation();
      } catch (error) {
        if (!this.valid(generation, revision)) return;
        if (this.blockCapture(error)) return;
        this.ui.showSelectionCard();
        selection.translationJob = error.jobId || null;
        this.ui.showJobError(
          error.message,
          error.jobId
            ? { status: error.code === "interrupted" ? "interrupted" : "failed", retryable: true }
            : null,
        );
      } finally {
        selection.pending.delete("capture");
      }
    }

    detach(message = "") {
      if (this.selection.detached || !this.selection.cropData) return;
      this.selection.detached = true;
      this.ui.selection?.remove();
      this.selection.detachedMessage = message;
      this.ui.updatePlacement();
    }

    acceptTranslation(result, generation, revision = this.selectionRevision) {
      if (!this.valid(generation, revision)) return;
      this.selection.run = result;
      this.loadStudies();
      this.ui.renderTranslation();
    }

    loadStudies() {
      this.selection.studies = new Map(
        Object.entries(this.selection.run?.studies || {}).map(([id, result]) => [
          id,
          { result, status: "completed", cached: true },
        ]),
      );
    }

    async openLibrary() {
      if (
        !this.session ||
        !this.ui.host?.isConnected ||
        this.library?.loading ||
        this.library?.opening
      )
        return;
      this.resetSelection();
      this.previousFocus = null;
      const library = { entries: [], loading: true, opening: null, error: "" };
      this.library = library;
      const generation = this.generation,
        revision = this.selectionRevision;
      this.ui.showLibrary(library);
      try {
        const response = await this.send("library");
        if (!this.valid(generation, revision) || this.library !== library) return;
        library.entries = Array.isArray(response.entries) ? response.entries : [];
      } catch (error) {
        if (!this.valid(generation, revision) || this.library !== library) return;
        library.error = error.message;
      }
      if (!this.valid(generation, revision) || this.library !== library) return;
      library.loading = false;
      this.ui.renderLibrary(library);
    }

    async openHistory(id) {
      const library = this.library;
      if (
        !library ||
        library.loading ||
        library.opening ||
        !library.entries.some((entry) => entry.id === id)
      )
        return;
      library.opening = id;
      library.error = "";
      const generation = this.generation,
        revision = this.selectionRevision;
      this.ui.renderLibrary(library);
      try {
        const response = await this.send("history", { id });
        if (!this.valid(generation, revision) || this.library !== library) return;
        if (!response.history) throw new Error("This saved translation is no longer available.");
        this.showHistory(response.history);
      } catch (error) {
        if (!this.valid(generation, revision) || this.library !== library) return;
        library.opening = null;
        library.error = error.message;
        this.ui.renderLibrary(library);
      }
    }

    showHistory(history) {
      this.resetSelection();
      this.library = null;
      this.previousFocus = null;
      this.selection.detached = true;
      this.selection.cached = true;
      this.selection.detachedMessage = "";
      this.selection.cropData = history.imageDataUrl;
      this.selection.rect = {
        x: Math.max(12, this.viewport.width - 410),
        y: 60,
        width: 0,
        height: 0,
      };
      this.ui.makeCard({ focus: false });
      if (history.result) {
        this.selection.run = history.result;
        this.loadStudies();
        if (history.studyJob) {
          const job = history.studyJob;
          const regionId = job.region_id || job.regionId || job.input?.regionId;
          this.selection.regionIndex = Math.max(
            0,
            this.selection.run.analysis.regions.findIndex((region) => region.id === regionId),
          );
          if (job.status === "completed" && job.result) {
            this.selection.studies.set(regionId, {
              status: "completed",
              result: job.result,
              cached: true,
            });
          } else if (["queued", "running"].includes(job.status)) {
            this.selection.studies.set(regionId, {
              status: "pending",
              jobId: job.job_id || job.id || job.jobId,
            });
          } else if (job.status !== "completed") {
            this.selection.studies.set(regionId, {
              status: "error",
              error: job.error || "This explanation was interrupted.",
              jobId: job.job_id || job.id || job.jobId,
              final: ["failed", "interrupted"].includes(job.status),
            });
          }
        }
        this.ui.renderTranslation();
        if (["queued", "running"].includes(history.studyJob?.status)) {
          const region = this.selection.run.analysis.regions[this.selection.regionIndex];
          if (region) void this.requestStudy(region.id);
        }
      } else if (history.job) {
        this.selection.translationJob = history.job.job_id || history.job.id || history.job.jobId;
        if (["queued", "running"].includes(history.job.status)) {
          if (Number.isFinite(history.job.createdAt))
            this.selection.startedAt = history.job.createdAt;
          this.selection.cached = false;
          this.resumeTranslation();
        } else {
          this.ui.showJobError(
            history.job.error || "This request was interrupted; no completed answer was saved.",
            history.job,
          );
        }
      } else this.ui.showError("This saved selection is no longer available.");
    }

    async restart() {
      if (this.setupRequired || this.captureError) return;
      const generation = this.generation,
        revision = this.selectionRevision;
      try {
        await this.send("restart");
      } catch (error) {
        if (this.valid(generation, revision) && this.ui.body) this.ui.showError(error.message);
      }
    }

    async poll(jobId, generation, accept, fail, revision = this.selectionRevision) {
      if (!this.valid(generation, revision)) return;
      try {
        const response = await this.send("poll", { jobId });
        if (!this.valid(generation, revision)) return;
        const job = response.job;
        if (job?.status === "completed") {
          if (!job.result) throw new Error("The request finished without a complete result.");
          await accept(job.result);
        } else if (["failed", "interrupted"].includes(job?.status))
          fail(job.error || "This request was interrupted.", job);
        else if (["queued", "running"].includes(job?.status)) {
          if (jobId === this.selection.translationJob && Number.isFinite(job.createdAt))
            this.selection.startedAt = job.createdAt;
          if (this.ui.progress?.isConnected && job.progress)
            this.ui.progress.textContent =
              typeof job.progress === "string"
                ? job.progress
                : job.progress.message || "Receiving translation…";
          this.later(() => this.poll(jobId, generation, accept, fail, revision), 1000);
        } else throw new Error("The extension returned an unknown request status.");
      } catch (error) {
        if (this.valid(generation, revision)) fail(error.message, null);
      }
    }

    resumeTranslation() {
      if (!this.selection.translationJob) return;
      this.ui.showPending(
        this.selection.cached ? "Opening saved translation…" : "Translating selection…",
      );
      const generation = this.generation;
      const revision = this.selectionRevision;
      this.poll(
        this.selection.translationJob,
        generation,
        (result) => this.acceptTranslation(result, generation, revision),
        (error, job) => this.ui.showJobError(error, job),
      );
    }

    async retryTranslation() {
      if (this.setupRequired) return;
      const selection = this.selection;
      if (selection.pending.has("retry") || !selection.translationJob) return;
      selection.pending.add("retry");
      selection.startedAt = Date.now();
      const revision = this.selectionRevision;
      const generation = this.generation;
      try {
        this.ui.showPending("Submitting your explicit retry…");
        const response = await this.submit("retry", { jobId: this.selection.translationJob });
        if (this.valid(generation, revision)) {
          this.selection.translationJob = response.jobId;
          this.selection.cached = !!response.cached;
          this.resumeTranslation();
        }
      } catch (error) {
        if (this.valid(generation, revision))
          this.ui.showJobError(error.message, { status: "interrupted", retryable: true });
      } finally {
        selection.pending.delete("retry");
      }
    }

    async compareModel(model) {
      if (this.setupRequired) return;
      const selection = this.selection;
      if (selection.pending.has("compare") || !selection.run || !selection.cropData) return;
      selection.pending.add("compare");
      selection.startedAt = Date.now();
      const revision = this.selectionRevision;
      const generation = this.generation;
      const original = this.selection.run;
      try {
        this.ui.showPending("Requesting your selected model…");
        const response = await this.submit("analyze", {
          sourceRunId: original.run_id,
          imageDataUrl: this.selection.cropData,
          rect: this.selection.rect,
          viewport: this.viewport,
          context: "",
          model,
        });
        if (!this.valid(generation, revision)) return;
        this.selection.translationJob = response.jobId;
        this.selection.cached = !!response.cached;
        this.poll(
          response.jobId,
          generation,
          (result) => this.acceptTranslation(result, generation, revision),
          (error, job) => {
            this.selection.run = original;
            this.ui.renderTranslation();
            this.ui.body.append(this.ui.node("p", "error", error));
            if (job)
              this.ui.body.append(
                this.ui.node(
                  "p",
                  "hint",
                  "Check history for this request before retrying; it may have incurred charges.",
                ),
              );
          },
        );
      } catch (error) {
        if (this.valid(generation, revision)) {
          this.selection.run = original;
          this.ui.renderTranslation();
          this.ui.body.append(this.ui.node("p", "error", error.message));
        }
      } finally {
        selection.pending.delete("compare");
      }
    }

    async requestStudy(regionId, retry = false) {
      if (!this.selection.run) return;
      let entry = this.selection.studies.get(regionId);
      if (entry?.status === "loading" || entry?.result) return;
      if (this.setupRequired && (retry || !entry?.jobId)) return;
      entry ||= {};
      entry.status = "loading";
      entry.error = null;
      this.selection.studies.set(regionId, entry);
      this.ui.renderStudy();
      const revision = this.selectionRevision;
      const generation = this.generation,
        runId = this.selection.run.run_id;
      const renderCurrent = (includeWords = false) => {
        if (
          this.valid(generation, revision) &&
          this.selection.run?.run_id === runId &&
          this.selection.run.analysis.regions[this.selection.regionIndex]?.id === regionId
        )
          if (includeWords) this.ui.renderTranslation();
          else this.ui.renderStudy();
      };
      try {
        if (retry && entry.jobId) {
          const response = await this.submit("retry", { jobId: entry.jobId });
          entry.jobId = response.jobId;
          entry.cached = !!response.cached;
          entry.final = false;
        } else if (!entry.jobId) {
          const response = await this.submit("study", { runId, regionId });
          entry.jobId = response.jobId;
          entry.cached = !!response.cached;
        }
        if (!this.valid(generation, revision)) return;
        this.poll(
          entry.jobId,
          generation,
          (result) => {
            entry.status = "completed";
            entry.result = result;
            renderCurrent(true);
          },
          (error, job) => {
            entry.status = "error";
            entry.error = error;
            entry.final = !!job;
            renderCurrent();
          },
        );
      } catch (error) {
        entry.status = "error";
        entry.error = error.message;
        entry.jobId ||= error.jobId;
        entry.final = ["interrupted", "failed"].includes(error.code) && !!entry.jobId;
        renderCurrent();
      }
    }
  }
  if (typeof module !== "undefined" && module.exports)
    module.exports = { SelectionOverlay, normalizeRect, pixelCrop, placeCard };
  else if (!globalThis.__mangaSelectionOverlay) {
    const runtime = (globalThis.browser ?? globalThis.chrome)?.runtime;
    if (!runtime) return;
    const overlay = new SelectionOverlay(window, runtime);
    globalThis.__mangaSelectionOverlay = overlay;
    runtime.onMessage.addListener((message) => {
      if (message?.type === "manga:start") {
        overlay.start(message);
        return Promise.resolve({
          ok: true,
          sessionId: message.sessionId,
          mounted:
            overlay.ui.host?.isConnected === true &&
            Boolean(overlay.ui.shield?.isConnected || overlay.ui.card?.isConnected),
        });
      }
      if (message?.type === "manga:shortcut") {
        if (
          !overlay.session ||
          message.sessionId !== overlay.session ||
          !overlay.ui.host?.isConnected
        )
          return Promise.resolve({ ok: false, error: "This reading session has changed." });
        // Only a second press during selection opens saved translations.
        // An open card means the user wants to select the next passage.
        let action;
        if (overlay.ui.shield?.isConnected) void overlay.openLibrary();
        else action = overlay.restart();
        return Promise.resolve(action).then(() => ({
          ok: true,
          sessionId: overlay.session,
          mounted: Boolean(overlay.ui.shield?.isConnected || overlay.ui.card?.isConnected),
        }));
      }
      return undefined;
    });
  }
})();
