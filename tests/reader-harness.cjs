"use strict";
const { SelectionOverlay } = require("../src/reader/content.js");

function harness(handler) {
  const calls = [],
    timers = new Map(),
    images = new Map(),
    ports = [];
  let nextTimer = 0,
    nextImage = 0;
  const width = 600,
    height = 400;

  function raster(changed = false) {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value =
          x > 95 && x < 305 && y > 95 && y < 305
            ? x > 115 && x < 285 && y > 115 && y < 285 && x % 30 < 7 && y % 24 < 14
              ? 10
              : 255
            : (Math.floor(x / 25) + Math.floor(y / 23)) % 2
              ? 230
              : 30;
        const offset = (y * width + x) * 4;
        data[offset] = data[offset + 1] = data[offset + 2] = value;
      }
    }
    if (changed) {
      for (let y = 110; y < 180; y++) {
        for (let x = 120; x < 160; x++) {
          const offset = (y * width + x) * 4;
          data[offset] = data[offset + 1] = data[offset + 2] = 80;
        }
      }
    }
    return { width, height, data };
  }

  images.set("fixture:page", raster());
  images.set("fixture:changed", raster(true));

  class Target {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(fn);
    }

    removeEventListener(name, fn) {
      this.listeners.get(name)?.delete(fn);
    }

    dispatch(name, extra = {}) {
      const event = {
        isTrusted: true,
        target: this,
        composedPath: () => [this],
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.propagationStopped = true;
        },
        ...extra,
      };
      for (const fn of [...(this.listeners.get(name) || [])]) fn(event);
      return event;
    }
  }

  class Element extends Target {
    constructor(tag) {
      super();
      this.tagName = tag.toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.style = {};
      this.attributes = {};
      this.textContent = "";
    }

    get isConnected() {
      return this.root || !!this.parent?.isConnected || !!this.host?.isConnected;
    }

    set innerHTML(_) {
      throw new Error("Unsafe HTML insertion");
    }

    append(...items) {
      for (const item of items) {
        item.remove();
        item.parent = this;
        this.children.push(item);
      }
    }

    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this);
      this.parent = null;
    }

    replaceChildren(...items) {
      for (const item of [...this.children]) item.remove();
      this.textContent = "";
      this.append(...items);
    }

    attachShadow({ mode }) {
      const shadow = new Element("shadow");
      shadow.host = this;
      this.shadowMode = mode;
      this.shadowRoot = mode === "open" ? shadow : null;
      return shadow;
    }

    setAttribute(name, value) {
      this.attributes[name] = value;
    }

    focus() {
      doc.activeElement = this;
    }

    contains(target) {
      return target === this || this.children.some((item) => item.contains(target));
    }

    matches(selector) {
      if (selector.startsWith("[") && selector.endsWith("]"))
        return Object.hasOwn(this.attributes, selector.slice(1, -1));
      return selector.split(",").includes(this.tagName.toLowerCase());
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0];
    }

    querySelectorAll(selector) {
      return this.children.flatMap((item) => [
        ...(item.matches(selector) ? [item] : []),
        ...item.querySelectorAll(selector),
      ]);
    }

    closest(selector) {
      return this.matches(selector) ? this : this.parent?.closest(selector);
    }

    getBoundingClientRect() {
      return this.box || { x: 0, y: 0, width: 0, height: 0 };
    }

    setPointerCapture() {}

    releasePointerCapture() {}

    getContext() {
      const canvas = this;
      return {
        drawImage(source, ...args) {
          const swidth = source.naturalWidth || source.width;
          const sheight = source.naturalHeight || source.height;
          let sx = 0,
            sy = 0,
            sw = swidth,
            sh = sheight,
            dx = 0,
            dy = 0,
            dw = canvas.width,
            dh = canvas.height;
          if (args.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = args;
          canvas.data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
          for (let y = 0; y < dh; y++) {
            for (let x = 0; x < dw; x++) {
              const from =
                (Math.min(sheight - 1, Math.floor(sy + (y * sh) / dh)) * swidth +
                  Math.min(swidth - 1, Math.floor(sx + (x * sw) / dw))) *
                4;
              const to = ((dy + y) * canvas.width + dx + x) * 4;
              for (let n = 0; n < 4; n++) canvas.data[to + n] = source.data[from + n];
            }
          }
        },
        getImageData() {
          return { width: canvas.width, height: canvas.height, data: canvas.data };
        },
      };
    }

    toDataURL() {
      const key = `fixture:canvas:${++nextImage}`;
      images.set(key, { width: this.width, height: this.height, data: this.data.slice() });
      return key;
    }
  }

  const doc = new Target();
  doc.documentElement = new Element("html");
  doc.documentElement.root = true;
  doc.createElement = (tag) => new Element(tag);
  doc.createElementNS = (_namespace, tag) => new Element(tag);
  doc.querySelectorAll = (selector) => doc.documentElement.querySelectorAll(selector);
  doc.activeElement = new Element("button");
  doc.documentElement.append(doc.activeElement);
  const win = new Target();
  Object.assign(win, {
    document: doc,
    innerWidth: width,
    innerHeight: height,
    getComputedStyle() {
      return {};
    },
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestAnimationFrame(fn) {
      Promise.resolve().then(fn);
    },
    Image: class {
      set src(value) {
        const source = images.get(value);
        if (!source) {
          Promise.resolve().then(() => this.onerror());
          return;
        }
        this.data = source.data;
        this.naturalWidth = source.width;
        this.naturalHeight = source.height;
        Promise.resolve().then(() => this.onload());
      }
    },
    MutationObserver: class {
      constructor(fn) {
        this.fn = fn;
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  });

  const fixture = { page: null, regions: [], screenshot: "fixture:page" };
  const portStatus = (active) =>
    ports
      .filter((port) => !port.closed)
      .forEach((port) => port.onMessage.emit({ type: "manga:work-status", active }));
  const event = () => ({
    listeners: [],
    addListener(fn) {
      this.listeners.push(fn);
    },
    emit(message) {
      for (const fn of this.listeners) fn(message);
    },
  });
  const runtime = {
    connect() {
      const port = {
        onMessage: event(),
        onDisconnect: event(),
        postMessage(message) {
          if (message.type === "bind") Promise.resolve().then(() => portStatus(0));
        },
        disconnect() {
          this.closed = true;
          this.onDisconnect.emit();
        },
      };
      ports.push(port);
      return port;
    },
    async sendMessage(message) {
      calls.push(message);
      const custom = handler && (await handler(message, fixture));
      if (custom !== undefined) return custom;
      if (message.type === "manga:capture") return { ok: true, imageDataUrl: fixture.screenshot };
      if (message.type === "manga:analyze") {
        portStatus(1);
        fixture.regions.push({ id: "saved-a", runId: "run-a", model: "test/model", ...message });
        return { ok: true, jobId: "translation-job" };
      }
      if (message.type === "manga:retry") {
        portStatus(1);
        return { ok: true, jobId: message.jobId };
      }
      if (message.type === "manga:poll") {
        portStatus(0);
        return {
          ok: true,
          job: {
            status: "completed",
            result: message.jobId === "translation-job" ? run() : study(message.jobId.slice(6)),
          },
        };
      }
      return { ok: true };
    },
  };
  const overlay = new SelectionOverlay(win, runtime);
  const text = (element) =>
    element ? [element.textContent, ...element.children.map(text)].join(" ") : "";
  return {
    overlay,
    win,
    doc,
    calls,
    timers,
    ports,
    images,
    fixture,
    portStatus,
    text,
    start(message = {}) {
      overlay.start({ sessionId: "session-a", model: "test/model", shortcut: "Alt+Q", ...message });
    },
    select(from = { x: 100, y: 100 }, to = { x: 300, y: 300 }, trusted = true) {
      const shield = overlay.ui.shield;
      shield.dispatch("pointerdown", {
        isTrusted: trusted,
        button: 0,
        pointerId: 1,
        clientX: from.x,
        clientY: from.y,
      });
      shield.dispatch("pointermove", {
        isTrusted: trusted,
        pointerId: 1,
        clientX: to.x,
        clientY: to.y,
      });
      shield.dispatch("pointerup", {
        isTrusted: trusted,
        pointerId: 1,
        clientX: to.x,
        clientY: to.y,
      });
    },
    fire(delay) {
      for (const [id, item] of [...timers])
        if (item.delay === delay) {
          timers.delete(id);
          item.fn();
        }
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 180; i++) await Promise.resolve();
};

const run = () => ({
  run_id: "run-a",
  model: "test/model",
  latency_ms: 350,
  usage: { cost_usd: 0.00045 },
  analysis: {
    warnings: [],
    regions: [1, 2].map((n) => ({
      id: `r${n}`,
      japanese: `日本語${n}<script>alert(1)</script>`,
      translation: `Natural ${n}`,
      notes: [],
      words: [{ surface: "日本語", reading: "にほんご", meaning: "Japanese language" }],
      grammar: [],
    })),
  },
});

const study = (regionId) => ({
  run_id: "run-a",
  region_id: regionId,
  study: {
    notes: ["Helpful explanation"],
    words: [{ surface: "日本語", reading: "にほんご", meaning: "Japanese language" }],
    grammar: [],
  },
});

module.exports = { harness, settle, run, study };
