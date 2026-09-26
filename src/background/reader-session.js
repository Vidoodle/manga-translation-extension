/* Browser capabilities: authenticate reader sessions, capture and keep work connected. */
(() => {
  "use strict";

  const SESSION_KEY = "mangaReaderSessionsV3";
  const readableTab = (tab) =>
    tab && Number.isInteger(tab.id) && /^https?:\/\//.test(tab.url || "");

  function accessError(cause, code, message) {
    if (cause?.name !== "SecurityError" && !/SecurityError|insecure/i.test(cause?.message || ""))
      return cause;
    const error = new Error(message, { cause });
    error.code = code;
    return error;
  }

  function viewport(value) {
    return value &&
      [value.width, value.height].every((n) => Number.isFinite(n) && n >= 1 && n <= 20000)
      ? { width: value.width, height: value.height }
      : null;
  }

  function rectangle(value, view, min = 4) {
    if (
      !value ||
      !view ||
      ![value.x, value.y, value.width, value.height].every(Number.isFinite) ||
      value.x < 0 ||
      value.y < 0 ||
      value.width < min ||
      value.height < min ||
      value.x + value.width > view.width + 1 ||
      value.y + value.height > view.height + 1
    )
      return null;
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  }

  class ReaderService {
    constructor({ extension, settings, jobs, digest, loadStyles }) {
      this.extension = extension;
      this.settings = settings;
      this.jobs = jobs;
      this.digest = digest;
      this.loadStyles = loadStyles || (() => this.readPackagedStyles());
      this.stylesPromise = null;
      this.sessions = new Map();
      this.current = new Map();
      this.activations = new Map();
      this.ports = new Map();
      this.capturing = new Set();
      this.ready = this.restore();
    }

    async readPackagedStyles() {
      if (!this.stylesPromise) {
        this.stylesPromise = Promise.all(
          ["shared/theme.css", "reader/reader.css", "shared/japanese.css"].map(async (path) => {
            const response = await fetch(this.extension.runtime.getURL(path));
            if (!response.ok)
              throw new Error("The reader styles could not be loaded. Reload the extension.");
            return response.text();
          }),
        )
          .then((styles) => styles.join("\n"))
          .catch((error) => {
            this.stylesPromise = null;
            throw error;
          });
      }

      return this.stylesPromise;
    }

    async restore() {
      let saved;
      try {
        const values = await this.extension.storage.session.get(SESSION_KEY);
        saved = values[SESSION_KEY] || [];
      } catch (cause) {
        throw accessError(
          cause,
          "session-storage",
          "Firefox blocked the reading session storage. Restart Firefox, reopen the extension, and try again.",
        );
      }
      for (const session of saved)
        if (session && Date.now() - session.createdAt < 6 * 60 * 60 * 1000) {
          this.sessions.set(session.sessionId, session);
          if (!session.closed) this.current.set(session.tabId, session.sessionId);
        }
    }

    async save() {
      try {
        await this.extension.storage.session.set({
          [SESSION_KEY]: [...this.sessions.values()].slice(-50),
        });
      } catch (cause) {
        throw accessError(
          cause,
          "session-storage",
          "Firefox blocked saving the reading session. Restart Firefox, reopen the extension, and try again.",
        );
      }
    }

    popupSender(sender) {
      return (
        sender.id === this.extension.runtime.id &&
        !sender.tab &&
        sender.url === this.extension.runtime.getURL("popup/popup.html")
      );
    }

    async handleShortcut(tab) {
      await this.ready;
      const session = this.sessions.get(this.current.get(tab?.id));
      if (!session || session.closed || session.url !== tab.url) return false;
      await this.active(session);
      if (this.current.get(tab.id) !== session.sessionId || session.closed) return false;
      try {
        const response = await this.extension.tabs.sendMessage(
          tab.id,
          { type: "manga:shortcut", sessionId: session.sessionId },
          { frameId: 0 },
        );
        if (this.current.get(tab.id) !== session.sessionId || session.closed) return true;
        if (
          response?.ok !== true ||
          response.sessionId !== session.sessionId ||
          response.mounted !== true
        )
          throw new Error("The page did not acknowledge the shortcut.");
      } catch (cause) {
        if (this.current.get(tab.id) !== session.sessionId || session.closed) return true;
        throw new Error(
          "The reader could not handle the shortcut on this page. Reload the reading page and try again." +
            (cause?.message ? ` ${cause.message}` : ""),
          { cause },
        );
      }
      return true;
    }

    async scope(url) {
      const parsed = new URL(url);
      // Queries/fragments can identify a book. Hash them instead of recording private URL tokens.
      return (
        parsed.origin +
        parsed.pathname +
        (parsed.search || parsed.hash
          ? "#scope=" + (await this.digest(parsed.search + parsed.hash))
          : "")
      );
    }

    async active(session) {
      const [tab] = await this.extension.tabs.query({ active: true, windowId: session.windowId });
      if (tab?.id !== session.tabId || tab?.url !== session.url)
        throw new Error(
          "Return to the reading tab before selecting text or making another request.",
        );
      return tab;
    }

    async authenticate(message, sender) {
      await this.ready;
      if (sender.id !== this.extension.runtime.id || sender.frameId !== 0 || !sender.tab)
        throw new Error("Only the reading overlay can make this request.");
      const session = this.sessions.get(message.sessionId);
      if (
        !session ||
        session.tabId !== sender.tab.id ||
        this.current.get(sender.tab.id) !== session.sessionId
      )
        throw new Error("This reading session has changed. Activate the assistant again.");
      const tab = await this.extension.tabs.get(session.tabId);
      if (
        sender.url !== session.url ||
        tab.url !== session.url ||
        tab.windowId !== session.windowId
      )
        throw new Error("The reading page changed. Activate the assistant again.");
      return session;
    }

    async start(tab, { library = false } = {}) {
      await this.ready;
      if (!readableTab(tab))
        throw new Error("Open a BookWalker reading page, then use the shortcut.");
      const activation = Symbol();
      this.activations.set(tab.id, activation);
      const latest = () => this.activations.get(tab.id) === activation;
      const config = await this.settings.config();
      const setup = await this.settings.setup(config);
      if (!latest()) return { ok: true };
      if (setup && !library) throw Object.assign(new Error(setup.message), { code: setup.code });
      const cardPosition = await this.settings.cardPosition();
      const readerCss = await this.loadStyles();
      const session = {
        sessionId: crypto.randomUUID(),
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url,
        scope: await this.scope(tab.url),
        model: config.model,
        readOnly: Boolean(setup),
        createdAt: Date.now(),
        closed: false,
        jobs: [],
        runs: [],
        pages: [],
        captures: [],
      };
      if (!latest()) return { ok: true };
      await this.active(session);
      if (!latest()) return { ok: true };
      const previous = this.sessions.get(this.current.get(tab.id));
      if (previous) previous.closed = true;
      this.sessions.set(session.sessionId, session);
      this.current.set(tab.id, session.sessionId);
      await this.save();
      if (!latest() || session.closed) return { ok: true };
      try {
        await this.extension.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          files: [
            "shared/models.js",
            "shared/japanese.js",
            "reader/vision.js",
            "reader/reader-view.js",
            "reader/page-tracker.js",
            "reader/content.js",
          ],
        });
      } catch (cause) {
        if (!latest() || session.closed) return { ok: true };
        session.closed = true;
        await this.save().catch(() => {});
        throw accessError(
          cause,
          "reader-access",
          "Firefox blocked the assistant on this page. Open the BookWalker reading tab and use the shortcut again.",
        );
      }
      if (!latest() || session.closed) return { ok: true };
      try {
        const response = await this.extension.tabs.sendMessage(
          tab.id,
          {
            type: "manga:start",
            sessionId: session.sessionId,
            model: config.model,
            cardPosition,
            shortcut: config.shortcut,
            readerCss,
            setupWarning: setup?.message || "",
            setupRequired: Boolean(setup),
            ...(library ? { library: true } : {}),
          },
          { frameId: 0 },
        );
        if (!latest() || session.closed) return { ok: true };
        if (
          response?.ok !== true ||
          response.sessionId !== session.sessionId ||
          response.mounted !== true
        )
          throw new Error("The page did not confirm that its reader opened.");
      } catch (cause) {
        if (!latest() || session.closed) return { ok: true };
        session.closed = true;
        await this.save().catch(() => {});
        throw Object.assign(
          new Error(
            "The assistant could not open on this page. Reload the reading page, then try the shortcut again." +
              (cause?.message ? ` ${cause.message}` : ""),
            { cause },
          ),
          { code: "reader-start" },
        );
      }
      return { ok: true };
    }

    async capture(session, message) {
      if (session.closed)
        throw new Error("Activate the assistant again before capturing the page.");
      const setup = await this.settings.setup();
      if (setup) throw Object.assign(new Error(setup.message), { code: setup.code });
      const view = viewport(message.viewport);
      if (!view || (message.rect && !rectangle(message.rect, view)))
        throw new Error("Select a rectangle inside the visible page.");
      await this.active(session);
      const now = Date.now();
      const recent = session.captures.filter((time) => now - time < 1000);
      const allowedBurst = message.type === "manga:verify-capture" || session.captures.length < 3;
      if (
        this.capturing.has(session.windowId) ||
        (recent.length && (!allowedBurst || recent.length >= 3))
      ) {
        const error = new Error(
          "The page capture is settling. Try the visual check again shortly.",
        );
        error.code = "capture-throttled";
        error.retryAfterMs = 1100;
        throw error;
      }
      session.captures = [...recent, now];
      this.capturing.add(session.windowId);
      try {
        let imageDataUrl;
        try {
          imageDataUrl = await this.extension.tabs.captureVisibleTab(session.windowId, {
            format: "png",
          });
        } catch (cause) {
          throw accessError(
            cause,
            "capture-access",
            "Firefox blocked the screenshot. Return to the BookWalker reading tab, use the shortcut, and try selecting again.",
          );
        }
        await this.active(session);
        if (this.current.get(session.tabId) !== session.sessionId || session.closed)
          throw new Error("The selection changed during capture. Select again.");
        return imageDataUrl;
      } finally {
        this.capturing.delete(session.windowId);
      }
    }

    async ownJob(session, jobId) {
      if (!session.jobs.includes(jobId)) session.jobs.push(jobId);
      await this.save();
      this.notify();
    }

    async ownRun(session, runId) {
      if (!session.runs.includes(runId)) {
        session.runs.push(runId);
        await this.save();
      }
    }

    notify() {
      for (const [port, sessionId] of this.ports) {
        const session = this.sessions.get(sessionId);
        const active = session?.jobs.filter((jobId) => this.jobs.active.has(jobId)).length || 0;
        try {
          port.postMessage({ type: "manga:work-status", active });
        } catch {
          this.ports.delete(port);
        }
      }
    }

    connect(port) {
      if (port.name !== "manga:reader") return;
      port.onMessage.addListener((message) => {
        if (message?.type === "heartbeat" && this.ports.get(port) === message.sessionId) {
          this.notify();
          return;
        }
        if (message?.type !== "bind") return;
        this.authenticate(message, port.sender)
          .then((session) => {
            this.ports.set(port, session.sessionId);
            this.notify();
          })
          .catch(() => {
            try {
              port.disconnect();
            } catch {}
          });
      });
      port.onDisconnect.addListener(() => {
        this.ports.delete(port);
      });
    }

    async invalidate(tabId) {
      await this.ready;
      this.activations.delete(tabId);
      this.current.delete(tabId);
      for (const [key, session] of this.sessions)
        if (session.tabId === tabId) {
          session.closed = true;
          if (!session.jobs.some((jobId) => this.jobs.active.has(jobId))) this.sessions.delete(key);
        }
      await this.save();
    }
  }

  globalThis.MangaReader = { ReaderService, viewport, rectangle, readableTab };
  if (typeof module !== "undefined" && module.exports) module.exports = globalThis.MangaReader;
})();
