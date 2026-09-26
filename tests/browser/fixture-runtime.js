/* Browser-only test adapter. Never packaged into the extension. */
(() => {
  // Open the test UI for accessibility inspection by default. ?shadow=closed
  // keeps the production boundary for screenshot/coordinate interaction checks.
  const attachShadow = Element.prototype.attachShadow;
  const query = new URLSearchParams(location.search);
  const themePreview = ["light", "dark"].includes(query.get("theme")) ? query.get("theme") : "";
  Element.prototype.attachShadow = function (options) {
    const shadow = attachShadow.call(
      this,
      query.get("shadow") === "closed" ? options : { ...options, mode: "open" },
    );
    if (themePreview) {
      // Exercise the real light-dark() tokens without changing the user's browser theme.
      const style = document.createElement("style");
      style.textContent = `:host, .card, .shield, .jp-gloss { color-scheme: ${themePreview} !important; }`;
      shadow.append(style);
    }
    return shadow;
  };

  const realFetch = window.fetch.bind(window);
  const scenario = new URLSearchParams(location.search).get("scenario");
  const responseParameter = new URLSearchParams(location.search).get("responseMs");
  const responseMs =
    responseParameter !== null && Number.isFinite(Number(responseParameter))
      ? Math.max(0, Math.min(60000, Number(responseParameter)))
      : null;
  const stackedScroll = scenario === "stacked-scroll";
  const changingReaderControls = scenario === "changing-reader-controls";
  const focusSensitive = scenario === "focus-sensitive";
  const popupFocusSensitive = scenario === "popup-focus-sensitive";
  const continuousScroll =
    scenario === "continuous-scroll" ||
    stackedScroll ||
    changingReaderControls ||
    focusSensitive ||
    popupFocusSensitive;
  const slowResponse = scenario === "slow-response" || continuousScroll;
  const captureBlocked = scenario === "capture-blocked";
  if (continuousScroll) {
    document.body.classList.add("continuous-scroll");
    if (stackedScroll) {
      document.body.classList.add("stacked-scroll");
      for (let panel = 2; panel <= 6; panel++) {
        const canvas = document.createElement("canvas");
        canvas.className = "manga-panel";
        canvas.width = 1200;
        canvas.height = 1040;
        canvas.style.top = `${100 + (panel - 1) * 520}px`;
        canvas.setAttribute("aria-label", `Synthetic Japanese manga page ${panel}`);
        document.body.append(canvas);
      }
    } else document.getElementById("manga").height = 6240;
    document.getElementById("scroll-controls").hidden = false;
    for (const id of ["turn", "first", "auto-turn-label"])
      document.getElementById(id).hidden = true;
  }
  const events = () => {
    const listeners = [];
    return {
      listeners,
      addListener(fn) {
        listeners.push(fn);
      },
      removeListener(fn) {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    };
  };
  const local = JSON.parse(sessionStorage.getItem("fixture-local") || "null") || {
    openRouterApiKey: "synthetic-fixture-key",
    selectedModel: "fixture/one",
  };
  const session = {};
  function area(data, persist = false) {
    return {
      async get(keys) {
        if (keys === null) return { ...data };
        if (typeof keys === "string") return { [keys]: data[keys] };
        const result = {};
        for (const key of Array.isArray(keys) ? keys : Object.keys(keys || {}))
          result[key] = data[key];
        return result;
      },
      async set(value) {
        Object.assign(data, value);
        if (persist) sessionStorage.setItem("fixture-local", JSON.stringify(data));
      },
      async remove(key) {
        delete data[key];
        if (persist) sessionStorage.setItem("fixture-local", JSON.stringify(data));
      },
    };
  }
  const onMessage = events(),
    onConnect = events(),
    onCommand = events(),
    onRemoved = events(),
    onUpdated = events();
  const sourceTab = {
    id: 1,
    windowId: 1,
    url: location.origin + "/reader",
    title: "Synthetic manga fixture",
  };
  let page = 1,
    providerCalls = 0,
    captures = 0,
    pendingResponses = 0,
    pageFocusResets = 0,
    popupOpens = 0,
    shortcut = "Alt+Q",
    popupDialog = null;
  const origin = location.origin;
  const contentSender = () => ({
    id: "fixture-extension",
    url: sourceTab.url,
    frameId: 0,
    tab: { ...sourceTab },
  });
  const popupSender = () => ({ id: "fixture-extension", url: origin + "/src/popup/popup.html" });
  async function route(message, sender) {
    if (!onMessage.listeners[0]) throw new Error("Background has not registered");
    if (captureBlocked && ["manga:capture", "manga:verify-capture"].includes(message.type))
      return {
        ok: false,
        code: "screenshot-crop",
        error:
          "The selected screenshot could not be prepared for translation. No translation was sent. Error code: screenshot-crop.",
      };
    return await onMessage.listeners[0](message, sender);
  }
  const api = {
    runtime: {
      id: "fixture-extension",
      getURL: (path) => origin + "/src/" + path,
      onMessage,
      onConnect,
      sendMessage: (message) => route(message, contentSender()),
      connect({ name }) {
        const a = { name, onMessage: events(), onDisconnect: events() },
          b = { name, sender: contentSender(), onMessage: events(), onDisconnect: events() };
        let closed = false;
        a.postMessage = (data) =>
          queueMicrotask(() => {
            if (!closed) b.onMessage.listeners.forEach((fn) => fn(data));
          });
        b.postMessage = (data) =>
          queueMicrotask(() => {
            if (!closed) a.onMessage.listeners.forEach((fn) => fn(data));
          });
        a.disconnect = b.disconnect = () => {
          if (closed) return;
          closed = true;
          a.onDisconnect.listeners.forEach((fn) => fn());
          b.onDisconnect.listeners.forEach((fn) => fn());
        };
        onConnect.listeners.forEach((fn) => fn(b));
        return a;
      },
    },
    storage: { local: area(local, true), session: area(session) },
    permissions: {
      async contains() {
        return true;
      },
      async request() {
        return true;
      },
    },
    commands: {
      onCommand,
      async getAll() {
        return [{ name: "select-manga", shortcut }];
      },
      async update(change) {
        shortcut = change.shortcut;
      },
      async reset() {
        shortcut = "Alt+Q";
      },
    },
    action: {
      async setTitle() {},
      async setBadgeText() {},
      async openPopup() {
        if (popupDialog) {
          popupDialog.querySelector("iframe").focus();
          return;
        }
        popupOpens++;
        fixture.log();
        // A native browser-action popup does not make the reading document inert.
        // showModal() hid page focus side effects and gave a false no-scroll result.
        const dialog = document.createElement("section");
        dialog.id = "fixture-popup";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-label", "Extension popup fixture");
        Object.assign(dialog.style, {
          position: "fixed",
          right: "16px",
          top: "16px",
          zIndex: "2147483647",
          boxSizing: "border-box",
          width: "500px",
          height: "760px",
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 32px)",
          padding: "12px",
          border: "1px solid #81948b",
          borderRadius: "12px",
          background: "#f6f5f0",
          overflow: "hidden",
        });
        dialog.close = () => {
          dialog.remove();
          if (popupDialog === dialog) popupDialog = null;
          if (popupFocusSensitive) {
            // Model the user's observation: closing any native extension popup
            // makes the reading site move upward when browser focus returns.
            pageFocusResets++;
            window.scrollBy(0, -80);
            fixture.log();
          }
        };
        const close = document.createElement("button");
        close.textContent = "Close popup fixture";
        close.addEventListener("click", () => dialog.close());
        const frame = document.createElement("iframe");
        frame.title = "Manga Reading Assistant popup";
        frame.src = `/reader-popup${themePreview ? `?theme=${themePreview}` : ""}`;
        Object.assign(frame.style, {
          display: "block",
          width: "100%",
          height: "calc(100% - 48px)",
          marginTop: "8px",
          border: "0",
        });
        dialog.append(close, frame);
        popupDialog = dialog;
        document.body.append(dialog);
      },
    },
    scripting: { async insertCSS() {}, async executeScript() {} },
    tabs: {
      onRemoved,
      onUpdated,
      async query() {
        return [{ ...sourceTab }];
      },
      async get() {
        return { ...sourceTab };
      },
      async sendMessage(id, message) {
        for (const listener of onMessage.listeners.slice(1)) {
          const response = listener(message, {});
          if (response !== undefined) return await response;
        }
      },
      async captureVisibleTab() {
        captures++;
        const canvas = document.createElement("canvas");
        canvas.width = innerWidth * 2;
        canvas.height = innerHeight * 2;
        const context = canvas.getContext("2d");
        context.fillStyle = "#e9ede7";
        context.fillRect(0, 0, canvas.width, canvas.height);
        for (const manga of document.querySelectorAll("#manga, .manga-panel")) {
          const box = manga.getBoundingClientRect();
          const left = Math.max(0, box.left),
            top = Math.max(0, box.top),
            right = Math.min(innerWidth, box.right),
            bottom = Math.min(innerHeight, box.bottom);
          if (right > left && bottom > top)
            context.drawImage(
              manga,
              ((left - box.left) / box.width) * manga.width,
              ((top - box.top) / box.height) * manga.height,
              ((right - left) / box.width) * manga.width,
              ((bottom - top) / box.height) * manga.height,
              left * 2,
              top * 2,
              (right - left) * 2,
              (bottom - top) * 2,
            );
        }
        if (changingReaderControls) {
          // Simulate toolbar pixels inside an iframe surface. They change on
          // every capture while selected manga pixels remain unchanged.
          const box = document.getElementById("manga").getBoundingClientRect();
          const x = (box.right - 35) * 2,
            y = Math.max(0, box.top) * 2;
          context.fillStyle = "white";
          context.fillRect(x, y, 70, innerHeight * 2);
          context.fillStyle = "black";
          for (let bit = 0; bit < 10; bit++) {
            if (captures & (1 << bit)) context.fillRect(x, y + bit * 24, 70, 20);
          }
        }
        fixture.log();
        return canvas.toDataURL("image/png");
      },
    },
  };
  window.browser = api;
  const model = (id, name) => ({
    id,
    name,
    architecture: { input_modalities: ["image", "text"], output_modalities: ["text"] },
    supported_parameters: ["structured_outputs"],
    pricing: { prompt: "0.0000001", completion: "0.0000005" },
  });
  window.fetch = async (url, options = {}) => {
    if (String(url) === "https://openrouter.ai/api/v1/models")
      return new Response(
        JSON.stringify({
          data: [model("fixture/one", "Fixture One"), model("fixture/two", "Fixture Two")],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    if (String(url) === "https://openrouter.ai/api/v1/chat/completions") {
      providerCalls++;
      pendingResponses++;
      const request = JSON.parse(options.body),
        study = request.response_format.json_schema.name === "manga_study";
      const text = page === 1 ? "もう帰らなきゃ。" : "え、まだ雨だよ。";
      const learning =
        page === 1
          ? {
              words: [
                { surface: "もう", reading: "もう", meaning: "already; now" },
                { surface: "帰らなきゃ", reading: "かえらなきゃ", meaning: "have to go home" },
              ],
              grammar: [{ pattern: "なきゃ", explanation: "A casual way to express necessity." }],
            }
          : {
              words: [
                { surface: "まだ", reading: "まだ", meaning: "still" },
                { surface: "雨", reading: "あめ", meaning: "rain" },
              ],
              grammar: [
                {
                  pattern: "だよ",
                  explanation: "A casual assertion drawing attention to the fact.",
                },
              ],
            };
      const answer = study
        ? {
            notes: ["Synthetic fixture explanation."],
            ...learning,
          }
        : {
            japanese: text,
            translation: page === 1 ? "I need to head home." : "Huh? It's still raining.",
            ...learning,
          };
      const encoded = JSON.stringify(answer);
      const stream = new ReadableStream({
        start(controller) {
          const emit = (value) =>
            controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(value) + "\n\n"));
          let cursor = 0;
          const scrollTimer =
            continuousScroll && !study && document.getElementById("auto-scroll")?.checked
              ? setInterval(() => {
                  if (document.getElementById("auto-scroll").checked) window.scrollBy(0, 24);
                }, 400)
              : null;
          const finish = () => {
            clearInterval(timer);
            clearInterval(scrollTimer);
            pendingResponses--;
            fixture.log();
          };
          const timer = setInterval(
            () => {
              if (options.signal?.aborted) {
                finish();
                controller.error(new Error("Aborted"));
                return;
              }
              if (cursor < encoded.length) {
                emit({
                  id: "fixture-generation",
                  choices: [
                    {
                      delta: { content: encoded.slice(cursor, cursor + 120) },
                      finish_reason: null,
                    },
                  ],
                });
                cursor += 120;
              } else {
                emit({
                  choices: [{ delta: {}, finish_reason: "stop" }],
                  usage: { prompt_tokens: 100, completion_tokens: 80, cost: 0 },
                });
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                finish();
                controller.close();
              }
            },
            responseMs !== null || slowResponse
              ? (responseMs ?? 8000) / (Math.ceil(encoded.length / 120) + 1)
              : 300,
          );
        },
      });
      if (!study && document.getElementById("auto-turn")?.checked)
        setTimeout(() => fixture.turn(2), 400);
      fixture.log();
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    }
    if (String(url).startsWith("/") || String(url).startsWith(origin + "/src/"))
      return realFetch(url, options);
    throw new Error("Unexpected fixture network request: " + url);
  };
  window.fixture = {
    api,
    async activate() {
      for (const listener of onCommand.listeners) await listener("select-manga", { ...sourceTab });
    },
    async popup(type, payload = {}) {
      return route({ type: "manga:" + type, ...payload }, popupSender());
    },
    closePopup() {
      popupDialog?.close();
    },
    showError(result) {
      if (!result?.ok) document.getElementById("status").textContent = "Error: " + result?.error;
    },
    turn(number) {
      page = number;
      fixture.paint();
      fixture.log();
    },
    log() {
      const out = document.getElementById("status");
      if (out)
        out.textContent = `${captureBlocked ? "Simulated screenshot failure\n" : ""}${continuousScroll ? `Continuous scroll · ${Math.round(scrollY)} px` : `Page ${page}`}\nSimulated provider requests: ${providerCalls}\nLocal captures: ${captures}\nExtension popups opened: ${popupOpens}\nPending responses: ${pendingResponses}${responseMs !== null || slowResponse ? ` · ${(responseMs ?? 8000) / 1000}-second stream` : ""}${focusSensitive || popupFocusSensitive ? `\nPage focus resets: ${pageFocusResets}` : ""}`;
    },
    paint() {
      const canvas = document.getElementById("manga");
      if (!canvas) return;
      if (stackedScroll) {
        [...document.querySelectorAll("#manga, .manga-panel")].forEach((panel, index) => {
          const context = panel.getContext("2d");
          context.setTransform(2, 0, 0, 2, 0, 0);
          paintPanel(context, index + 1);
        });
        return;
      }
      const context = canvas.getContext("2d");
      context.setTransform(2, 0, 0, 2, 0, 0);
      if (continuousScroll) {
        for (let panel = 1; panel <= 6; panel++) {
          context.save();
          context.translate(0, (panel - 1) * 520);
          paintPanel(context, panel);
          context.restore();
        }
      } else paintPanel(context, page);
    },
  };
  function paintPanel(context, number) {
    context.fillStyle = "white";
    context.fillRect(0, 0, 600, 520);
    context.lineWidth = 3;
    context.strokeStyle = "#222";
    context.strokeRect(18, 18, 564, 480);
    context.beginPath();
    context.ellipse(300, 130, 180, 70, 0, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = "#111";
    context.font = "28px sans-serif";
    context.textAlign = "center";
    context.fillText(number % 2 ? "もう帰らなきゃ。" : "え、まだ雨だよ。", 300, 140);
    context.strokeRect(40, 255, 520, 210);
    context.fillStyle = ["#81948b", "#b88d91", "#8a91b0", "#b8a778", "#a889af", "#7ca7a0"][
      (number - 1) % 6
    ];
    context.fillRect(80, 280, 100, 150);
    context.fillRect(235, 315, 45, 130);
    context.fillRect(330, 275, 175, 65);
    context.font = "20px sans-serif";
    context.fillStyle = "#222";
    context.fillText("Synthetic manga page " + number, 350, 405);
  }
  window.addEventListener("scroll", () => fixture.log(), { passive: true });
  if (focusSensitive) {
    document.addEventListener(
      "focusin",
      (event) => {
        // Model a reading site's focus manager. preventScroll cannot stop page
        // handlers from moving their own reading viewport after focus changes.
        if (event.target.closest("header, #fixture-popup")) return;
        pageFocusResets++;
        window.scrollTo(0, 0);
        fixture.log();
      },
      true,
    );
  }
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        !event.isTrusted ||
        event.repeat ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "q"
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      for (const listener of onCommand.listeners) listener("select-manga", { ...sourceTab });
    },
    true,
  );
})();
