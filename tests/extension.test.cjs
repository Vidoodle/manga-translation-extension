const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "../src/popup");
const code = fs.readFileSync(path.join(root, "popup.js"), "utf8");
const html = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const format = require("../src/popup/popup-format.js");
const plain = (value) => JSON.parse(JSON.stringify(value));
const text = (element) => [element.textContent, ...element.children.map(text)].join(" ");
const models = [
  { id: "test/expensive", name: "Expensive", prompt_per_million: 2, completion_per_million: 10 },
  { id: "test/budget", name: "Budget", prompt_per_million: 0.1, completion_per_million: 0.5 },
  { id: "test/no-prices", name: "Unknown prices" },
];
async function harness(options = {}) {
  const elements = new Map();
  const calls = { messages: [], permissions: [], closes: 0 };
  let gesture = false;
  let hasAccess = options.hasAccess !== false;
  let shortcut = options.shortcut ?? "Alt+Q";
  const config = { key_configured: true, model: "test/budget", ...options.config };
  function element() {
    return {
      value: "",
      disabled: false,
      textContent: "",
      hidden: false,
      open: false,
      listeners: {},
      attributes: {},
      children: [],
      set innerHTML(_) {
        throw new Error("Popup content must be rendered as text, not HTML");
      },
      classes: new Set(),
      addEventListener(name, fn) {
        this.listeners[name] = fn;
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      getAttribute(name) {
        return this.attributes[name];
      },
      replaceChildren(...children) {
        this.children = children;
      },
      append(...children) {
        this.children.push(...children);
      },
      appendChild(child) {
        this.children.push(child);
      },
      focus() {
        this.focused = true;
      },
      get classList() {
        return {
          toggle: (name, enabled) => (enabled ? this.classes.add(name) : this.classes.delete(name)),
        };
      },
    };
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], element());
  elements.get("clear-confirm").hidden = true;
  elements.get("restart-confirm").hidden = true;
  const byId = (id) => {
    assert.ok(elements.has(id), `HTML contains ${id}`);
    return elements.get(id);
  };
  const extension = {
    permissions: {
      contains: async () => hasAccess,
      remove: async () => true,
      request: async (request) => {
        assert.equal(gesture, true, "host permission must be requested directly from a click");
        calls.permissions.push(plain(request));
        hasAccess = !options.denied;
        return hasAccess;
      },
    },
    runtime: {
      sendMessage: async (message) => {
        calls.messages.push(plain(message));
        const response = await options.respond?.(message);
        if (response) return response;
        if (options.errors?.[message.type])
          return { ok: false, error: options.errors[message.type] };
        if (message.type === "manga:popup-anki-config") return { ok: true, config: {} };
        if (message.type === "manga:popup-anki-connect")
          return { ok: true, decks: ["Japanese"], models: ["Basic"] };
        if (message.type === "manga:popup-anki-fields")
          return { ok: true, fields: ["Front", "Back"] };
        if (message.type === "manga:popup-config")
          return { ok: true, config: { ...config, shortcut } };
        if (message.type === "manga:popup-models")
          return { ok: true, catalog: { models, source: "live", ...options.catalog } };
        if (message.type === "manga:popup-cache-stats")
          return {
            ok: true,
            stats: { entries: 12, pages: 3, bytes: 1048576, unresolved: 1, ...options.stats },
          };
        if (message.type === "manga:popup-clear-cache")
          return { ok: true, stats: { entries: 0, pages: 0, bytes: 512, unresolved: 1 } };
        if (message.type === "manga:popup-shortcut") {
          shortcut =
            message.action === "reset"
              ? "Alt+Q"
              : message.action === "disable"
                ? ""
                : message.shortcut;
          return { ok: true, shortcut };
        }
        if (message.type === "manga:popup-save-key") config.key_configured = true;
        if (message.type === "manga:popup-remove-key") config.key_configured = false;
        if (message.type === "manga:popup-save-model") {
          if (!config.model) config.anki_setup_pending = true;
          config.model = message.model;
        }
        if (message.type === "manga:popup-finish-setup") config.anki_setup_pending = false;
        if (message.type === "manga:popup-reset-setup") {
          config.key_configured = false;
          config.model = "";
          config.anki_setup_pending = false;
        }
        return { ok: true };
      },
    },
    get tabs() {
      throw new Error("The configuration popup must not access reading tabs");
    },
    storage: {
      local: {
        get() {
          throw new Error("Popup must not read key storage directly");
        },
        set() {
          throw new Error("Background owns settings persistence");
        },
      },
    },
  };
  const context = vm.createContext({
    console,
    document: { getElementById: byId, createElement: element },
    window: {
      close() {
        calls.closes++;
      },
    },
    Option: function (text, value) {
      this.text = text;
      this.value = value;
    },
    browser: extension,
    MangaPopupFormat: format,
  });
  vm.runInContext(code, context);
  vm.runInContext(fs.readFileSync(path.join(root, "anki-settings.js"), "utf8"), context);
  await new Promise((resolve) => setImmediate(resolve));
  return {
    calls,
    config,
    hasElement: (id) => elements.has(id),
    element: byId,
    fire(id, event = "click") {
      return this.fireElement(byId(id), event);
    },
    fireElement(node, event = "click") {
      gesture = true;
      try {
        return node.listeners[event]();
      } finally {
        gesture = false;
      }
    },
  };
}

const sent = (h, type) => h.calls.messages.filter((message) => message.type === `manga:${type}`);
const virgin = { key_configured: false, model: "" };
function visible(h, name) {
  assert.equal(h.element(`${name}-step`).hidden, false);
  for (const other of ["welcome", "key", "model", "settings", "restart", "unavailable", "anki"])
    if (other !== name) assert.equal(h.element(`${other}-step`).hidden, true);
  assert.equal(h.element("restart-confirm").hidden, name !== "restart");
  assert.equal(h.element("restart-setup").hidden, name !== "settings");
}
function noPaidRequests(h) {
  const allowed = new Set([
    "popup-config",
    "popup-anki-config",
    "popup-finish-setup",
    "popup-models",
    "popup-save-key",
    "popup-remove-key",
    "popup-save-model",
    "popup-shortcut",
    "popup-reset-setup",
    "popup-cache-stats",
    "popup-clear-cache",
  ]);
  for (const message of h.calls.messages)
    assert.ok(allowed.has(message.type.replace(/^manga:/, "")), message.type);
  assert.equal(h.calls.closes, 0);
}
async function choose(h, model) {
  const button = h.element("model-list").children.find((button) => button.value === model);
  assert.ok(button, `Model choice exists: ${model}`);
  await h.fireElement(button);
}

test("virgin popup stays on welcome without catalog or cache work, even with pregranted access", async () => {
  for (const hasAccess of [true, false]) {
    const h = await harness({ hasAccess, config: virgin });
    visible(h, "welcome");
    assert.deepEqual(h.calls.messages, [{ type: "manga:popup-config" }]);
    assert.equal(h.element("setup-warning").textContent, "");
    assert.equal(h.element("catalog-status").textContent, "");
    assert.equal(h.calls.permissions.length, 0);
    await h.fire("refresh-models");
    await h.fire("restart-setup");
    await h.fire("confirm-restart");
    visible(h, "welcome");
    assert.equal(h.calls.messages.length, 1);
    assert.equal(h.calls.closes, 0);
  }
});

test("first setup proceeds key, model and optional Anki, with no paid requests", async () => {
  const h = await harness({ hasAccess: false, config: virgin });
  await h.fire("get-started");
  visible(h, "key");
  assert.equal(h.element("allow-access").hidden, true);
  assert.equal(h.element("remove-key").hidden, true);
  assert.equal(h.element("key-label").textContent, "API key");
  assert.equal(h.element("save-key").textContent, "Save and continue");
  assert.equal(h.element("save-key").disabled, true);
  h.element("api-key").value = " test-secret-key ";
  await h.fire("api-key", "input");
  assert.equal(h.element("save-key").disabled, false);
  assert.equal(sent(h, "popup-models").length, 0);
  await h.fire("save-key");
  visible(h, "model");
  assert.deepEqual(h.calls.permissions, [{ origins: ["https://openrouter.ai/*"] }]);
  assert.deepEqual(sent(h, "popup-save-key"), [
    { type: "manga:popup-save-key", apiKey: "test-secret-key" },
  ]);
  assert.equal(h.element("api-key").value, "");
  assert.match(h.element("key-state").textContent, /saved on this device/);
  assert.equal(sent(h, "popup-cache-stats").length, 0);
  visible(h, "model");
  assert.deepEqual(sent(h, "popup-models"), [{ type: "manga:popup-models", force: true }]);
  assert.equal(h.element("model-list").children[0].value, "test/budget");
  await choose(h, "test/budget");
  visible(h, "model");
  assert.equal(h.element("finish-setup").disabled, false);
  noPaidRequests(h);
  await h.fire("finish-setup");
  visible(h, "anki");
  assert.equal(h.element("anki-skip").hidden, false);
  await h.fire("anki-skip");
  visible(h, "settings");
  assert.equal(sent(h, "popup-cache-stats").length, 1);
  noPaidRequests(h);
  assert.equal(h.calls.closes, 0);
});

test("resume is derived from saved configuration and ready users skip setup without catalog work", async () => {
  const cases = [
    { config: virgin, hasAccess: true, step: "welcome", catalogs: 0 },
    { config: { key_configured: false }, hasAccess: true, step: "settings", catalogs: 0 },
    { config: {}, hasAccess: false, step: "settings", catalogs: 0 },
    { config: { model: "" }, hasAccess: false, step: "key", catalogs: 0 },
    { config: { model: "" }, hasAccess: true, step: "model", catalogs: 1 },
    { config: {}, hasAccess: true, step: "settings", catalogs: 0 },
  ];
  for (const item of cases) {
    const h = await harness(item);
    visible(h, item.step);
    assert.equal(sent(h, "popup-models").length, item.catalogs);
    assert.equal(sent(h, "popup-cache-stats").length, item.step === "settings" ? 1 : 0);
    noPaidRequests(h);
  }
});

test("the configured popup contains only settings and never accesses a reading tab or library", async () => {
  const h = await harness();
  visible(h, "settings");
  for (const id of [
    "select",
    "source",
    "dashboard",
    "header-actions",
    "open-saved",
    "saved-step",
    "history",
    "open-settings",
    "settings-back",
  ])
    assert.equal(h.hasElement(id), false, `${id} must be removed, not hidden`);
  assert.equal(h.element("current-model").textContent, "Budget");
  assert.equal(h.element("current-key").textContent, "Saved on this device");
  assert.equal(h.element("shortcut").textContent, "Alt+Q");
  assert.deepEqual(h.calls.messages, [
    { type: "manga:popup-config" },
    { type: "manga:popup-cache-stats" },
  ]);
  await h.fire("edit-connection");
  visible(h, "key");
  await h.fire("key-back");
  visible(h, "settings");
  assert.equal(sent(h, "popup-cache-stats").length, 1);
  noPaidRequests(h);
});

test("closing before saving restarts welcome; saving a key resumes the model step on reopen", async () => {
  const h = await harness({ config: virgin });
  await h.fire("get-started");
  visible(await harness({ config: h.config }), "welcome");
  h.element("api-key").value = "test-key";
  await h.fire("save-key");
  visible(h, "model");
  assert.equal(sent(h, "popup-models").length, 1);
  const reopened = await harness({ config: h.config });
  visible(reopened, "model");
  assert.equal(sent(reopened, "popup-models").length, 1);
});

test("catalog failure stays in the model step with retry and Back, including after reopening", async () => {
  const errors = { "manga:popup-models": "Offline" };
  const h = await harness({ config: { model: "" }, errors });
  visible(h, "model");
  assert.match(h.element("catalog-status").textContent, /unavailable.*Offline/);
  assert.equal(h.element("refresh-models").textContent, "Retry model list");
  assert.equal(h.element("refresh-models").hidden, false);
  assert.equal(h.element("finish-setup").disabled, true);
  assert.equal(h.element("all-models").hidden, true);
  assert.equal(h.element("model-back").disabled, false);
  await h.fire("model-back");
  visible(h, "key");
  assert.equal(h.element("save-key").textContent, "Continue to models");
  await h.fire("save-key");
  visible(h, "model");
  assert.equal(sent(h, "popup-models").length, 2);
  const reopened = await harness({ config: h.config, errors });
  visible(reopened, "model");
  assert.match(reopened.element("catalog-status").textContent, /Offline/);
  delete errors["manga:popup-models"];
  await h.fire("refresh-models");
  assert.deepEqual(sent(h, "popup-models").at(-1), { type: "manga:popup-models", force: true });
  assert.equal(h.element("refresh-models").hidden, true);
  assert.equal(h.element("model-list").children.length, 3);
  noPaidRequests(h);
});

test("each visit to model selection refreshes prices automatically without a refresh control", async () => {
  const h = await harness();
  assert.equal(sent(h, "popup-models").length, 0);
  for (let visit = 1; visit <= 2; visit++) {
    await h.fire("edit-model");
    visible(h, "model");
    assert.equal(sent(h, "popup-models").length, visit);
    assert.deepEqual(sent(h, "popup-models").at(-1), { type: "manga:popup-models", force: true });
    assert.equal(h.element("refresh-models").hidden, true);
    await h.fire("model-back");
    visible(h, "settings");
  }
  noPaidRequests(h);
});

test("removing a key keeps Settings navigation while model changes require a key", async () => {
  const h = await harness();
  await h.fire("edit-connection");
  visible(h, "key");
  assert.equal(h.element("key-back").textContent, "Back to settings");
  assert.equal(h.element("save-key").textContent, "Replace key");
  assert.equal(h.element("key-label").textContent, "Replacement API key");
  await h.fire("remove-key");
  visible(h, "key");
  assert.equal(h.element("save-key").textContent, "Save key");
  assert.equal(h.element("remove-key").disabled, true);
  noPaidRequests(h);
  await h.fire("key-back");
  visible(h, "settings");
  assert.equal(h.element("edit-connection").textContent, "Add key");
  assert.equal(h.element("edit-model").disabled, true);
  const count = h.calls.messages.length;
  await h.fire("edit-model");
  visible(h, "settings");
  assert.equal(h.calls.messages.length, count);
  assert.equal(h.calls.permissions.length, 0);
});

test("unreadable settings show a read-only error view without starting catalog or cache work", async () => {
  const h = await harness({
    errors: { "manga:popup-config": "Firefox blocked extension settings." },
  });
  visible(h, "unavailable");
  assert.match(h.element("key-state").textContent, /unavailable/);
  assert.equal(h.element("shortcut").textContent, "Unavailable");
  assert.match(h.element("status").textContent, /blocked extension settings/);
  assert.equal(h.calls.messages.length, 1);
  h.element("api-key").value = "test-key";
  for (const id of ["save-key", "remove-key", "save-shortcut"]) await h.fire(id);
  assert.equal(h.calls.messages.length, 1);
  visible(h, "unavailable");
  assert.equal(sent(h, "popup-history").length, 0);
  assert.equal(h.element("clear-cache").disabled, true);
  await h.fire("clear-cache");
  await h.fire("confirm-clear");
  assert.equal(sent(h, "popup-clear-cache").length, 0);
  visible(h, "unavailable");
});

test("storage failures do not appear during setup; finishing surfaces them in Settings", async () => {
  const h = await harness({
    config: virgin,
    errors: { "manga:popup-cache-stats": "Firefox blocked access to the extension's local cache." },
  });
  assert.equal(sent(h, "popup-cache-stats").length, 0);
  await h.fire("get-started");
  h.element("api-key").value = "test-key";
  await h.fire("save-key");
  await choose(h, "test/budget");
  assert.equal(sent(h, "popup-cache-stats").length, 0);
  await h.fire("finish-setup");
  visible(h, "anki");
  assert.equal(h.element("anki-skip").hidden, false);
  await h.fire("anki-skip");
  visible(h, "settings");
  assert.equal(sent(h, "popup-cache-stats").length, 1);
  assert.match(h.element("cache-stats").textContent, /Firefox blocked/);
  assert.equal(sent(h, "popup-history").length, 0);
});

test("restart setup requires confirmation, preserves saved translations, and resumes Welcome on reopen", async () => {
  const h = await harness();
  const originalConfig = { ...h.config };
  await h.fire("confirm-restart");
  assert.equal(sent(h, "popup-reset-setup").length, 0);
  await h.fire("restart-setup");
  visible(h, "restart");
  await h.fire("restart-setup");
  visible(h, "restart");
  await h.fire("cancel-restart");
  visible(h, "settings");
  assert.equal(h.element("restart-setup").focused, true);
  assert.deepEqual(h.config, originalConfig);
  assert.equal(sent(h, "popup-reset-setup").length, 0);
  await h.fire("confirm-restart");
  assert.equal(sent(h, "popup-reset-setup").length, 0);
  await h.fire("restart-setup");
  visible(h, "restart");
  await h.fire("confirm-restart");
  visible(h, "welcome");
  assert.deepEqual(h.config, { key_configured: false, model: "", anki_setup_pending: false });
  assert.equal(sent(h, "popup-reset-setup").length, 1);
  assert.equal(sent(h, "popup-clear-cache").length, 0);
  assert.match(h.element("status").textContent, /saved translations.*kept/);
  const reopened = await harness({ config: h.config });
  visible(reopened, "welcome");
  assert.deepEqual(reopened.calls.messages, [{ type: "manga:popup-config" }]);
  noPaidRequests(h);
});

test("a pending setup reset blocks duplicate resets and conflicting settings actions", async () => {
  let finishReset;
  const h = await harness({
    respond: (message) =>
      message.type === "manga:popup-reset-setup"
        ? new Promise((resolve) => {
            finishReset = resolve;
          })
        : undefined,
  });
  await h.fire("restart-setup");
  const resetting = h.fire("confirm-restart");
  visible(h, "restart");
  for (const id of [
    "restart-setup",
    "confirm-restart",
    "cancel-restart",
    "edit-connection",
    "edit-model",
    "save-shortcut",
  ])
    assert.equal(h.element(id).disabled, true, id);
  for (const id of [
    "restart-setup",
    "confirm-restart",
    "edit-connection",
    "edit-model",
    "save-shortcut",
    "cancel-restart",
  ])
    await h.fire(id);
  visible(h, "restart");
  assert.equal(sent(h, "popup-reset-setup").length, 1);
  assert.equal(sent(h, "popup-shortcut").length, 0);
  assert.equal(sent(h, "popup-start").length, 0);
  finishReset({ ok: true });
  await resetting;
  visible(h, "welcome");
});

test("failed setup reset keeps the configuration and allows an explicit retry", async () => {
  const errors = { "manga:popup-reset-setup": "Storage is unavailable." };
  const h = await harness({ errors });
  await h.fire("restart-setup");
  await h.fire("confirm-restart");
  visible(h, "restart");
  assert.equal(h.config.key_configured, true);
  assert.equal(h.config.model, "test/budget");
  assert.match(h.element("status").textContent, /Connection was not reset.*Storage/);
  assert.equal(h.element("confirm-restart").disabled, false);
  delete errors["manga:popup-reset-setup"];
  await h.fire("confirm-restart");
  visible(h, "welcome");
});

test("setup cannot reset while an earlier shortcut write is pending", async () => {
  let finishShortcut;
  const h = await harness({
    respond: (message) =>
      message.type === "manga:popup-shortcut"
        ? new Promise((resolve) => {
            finishShortcut = resolve;
          })
        : undefined,
  });
  h.element("shortcut-input").value = "Ctrl+Shift+U";
  const saving = h.fire("save-shortcut");
  assert.equal(h.element("restart-setup").disabled, true);
  await h.fire("restart-setup");
  visible(h, "settings");
  await h.fire("confirm-restart");
  assert.equal(sent(h, "popup-reset-setup").length, 0);
  finishShortcut({ ok: true, shortcut: "Ctrl+Shift+U" });
  await saving;
  assert.equal(h.element("restart-setup").disabled, false);
  await h.fire("restart-setup");
  visible(h, "restart");
  await h.fire("confirm-restart");
  visible(h, "welcome");
  assert.equal(h.element("shortcut").textContent, "Ctrl+Shift+U");
});

test("model settings show prices, persist only explicit choices, and preserve active requests", async () => {
  const h = await harness({ catalog: { source: "cached" } });
  await h.fire("edit-model");
  visible(h, "model");
  assert.equal(h.element("model-list").children[0].value, "test/budget");
  await choose(h, "test/expensive");
  assert.deepEqual(h.calls.messages.at(-1), {
    type: "manga:popup-save-model",
    model: "test/expensive",
  });
  assert.match(h.element("model-price").textContent, /\$2 input.*saved rates/);
  assert.match(h.element("status").textContent, /future requests/);
  assert.equal(h.element("finish-setup").hidden, true);
  assert.equal(h.element("model-back").textContent, "Back to settings");
  await h.fire("model-back");
  visible(h, "settings");
  assert.equal(h.element("current-model").textContent, "Expensive");
  noPaidRequests(h);
});

test("unavailable saved model is retained through catalog refresh and filtering", async () => {
  const h = await harness({ config: { model: "vendor/discontinued" } });
  await h.fire("edit-model");
  assert.equal(h.element("selected-model-name").textContent, "Discontinued");
  assert.equal(h.element("selected-model").hidden, false);
  assert.equal(
    h.element("model-list").children.some((button) => button.value === "vendor/discontinued"),
    false,
  );
  h.element("model-search").value = "budget";
  await h.fire("model-search", "input");
  assert.equal(h.element("selected-model-name").textContent, "Discontinued");
  assert.match(h.element("model-price").textContent, /could not be verified/);
  assert.equal(sent(h, "popup-save-model").length, 0);
});

test("failed model save restores the old choice and clearly labels cached rates", async () => {
  const h = await harness({
    config: { model: "test/expensive" },
    catalog: { source: "cached", warning: "Offline." },
    errors: { "manga:popup-save-model": "Unavailable model." },
  });
  await h.fire("edit-model");
  await choose(h, "test/budget");
  assert.equal(h.element("selected-model-name").textContent, "Expensive");
  assert.match(h.element("catalog-status").textContent, /saved model list.*Offline/);
  assert.match(h.element("model-price").textContent, /saved rates/);
  assert.match(h.element("status").textContent, /Unavailable/);
});

test("catalog failure in settings keeps the saved model and allows Back to Settings", async () => {
  const h = await harness({ errors: { "manga:popup-models": "Offline" } });
  await h.fire("edit-model");
  assert.equal(h.element("selected-model-name").textContent, "Budget");
  assert.match(h.element("catalog-status").textContent, /unavailable.*Offline/);
  await h.fire("model-back");
  visible(h, "settings");
});

test("permission denial does not save a key or advance setup", async () => {
  const h = await harness({ denied: true, hasAccess: false, config: virgin });
  await h.fire("get-started");
  h.element("api-key").value = "test-secret-key";
  await h.fire("save-key");
  assert.equal(sent(h, "popup-save-key").length, 0);
  assert.equal(h.element("api-key").value, "test-secret-key");
  assert.match(h.element("status").textContent, /not granted/);
  assert.equal(sent(h, "popup-models").length, 0);
  visible(h, "key");
  noPaidRequests(h);
});

test("resumed setup continues with its saved key and asks for missing permission before loading models", async () => {
  const h = await harness({ hasAccess: false, config: { model: "" } });
  visible(h, "key");
  assert.equal(h.element("allow-access").hidden, true);
  assert.equal(h.element("save-key").textContent, "Continue to models");
  assert.equal(h.element("save-key").disabled, false);
  assert.equal(sent(h, "popup-models").length, 0);
  await h.fire("save-key");
  visible(h, "model");
  assert.equal(sent(h, "popup-models").length, 1);
  assert.equal(sent(h, "popup-save-key").length, 0);
  assert.equal(h.calls.permissions.length, 1);
});

test("empty key save does not erase an existing key", async () => {
  const h = await harness();
  await h.fire("edit-connection");
  await h.fire("save-key");
  assert.equal(h.calls.permissions.length, 0);
  assert.equal(sent(h, "popup-save-key").length, 0);
  assert.equal(h.element("remove-key").disabled, false);
});

test("failed key persistence retains the pasted value and does not advance setup", async () => {
  const h = await harness({ config: virgin, errors: { "manga:popup-save-key": "Storage failed" } });
  await h.fire("get-started");
  h.element("api-key").value = "test-key";
  await h.fire("save-key");
  assert.equal(h.element("api-key").value, "test-key");
  assert.equal(h.element("save-key").disabled, false);
  assert.equal(sent(h, "popup-models").length, 0);
  assert.equal(h.element("remove-key").disabled, true);
  assert.match(h.element("status").textContent, /Storage failed/);
  visible(h, "key");
});

test("a pending key save cannot be submitted twice or advance after permission refresh", async () => {
  let finishSave;
  const h = await harness({
    config: virgin,
    respond: (message) =>
      message.type === "manga:popup-save-key"
        ? new Promise((resolve) => {
            finishSave = resolve;
          })
        : undefined,
  });
  await h.fire("get-started");
  h.element("api-key").value = "test-key";
  const pending = h.fire("save-key");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.element("save-key").disabled, true);
  assert.equal(h.element("key-back").disabled, true);
  await h.fire("save-key");
  await h.fire("key-back");
  visible(h, "key");
  assert.equal(sent(h, "popup-save-key").length, 1);
  assert.equal(sent(h, "popup-models").length, 0);
  finishSave({ ok: true });
  await pending;
  assert.equal(h.element("save-key").disabled, false);
  visible(h, "model");
  assert.equal(sent(h, "popup-models").length, 1);
});

test("shortcut reflects actual binding and supports set, disable, reset", async () => {
  const h = await harness({ shortcut: "Ctrl+Shift+U" });
  assert.equal(h.element("shortcut").textContent, "Ctrl+Shift+U");
  h.element("shortcut-input").value = "Alt+X";
  await h.fire("save-shortcut");
  assert.equal(h.element("shortcut").textContent, "Alt+X");
  await h.fire("disable-shortcut");
  assert.equal(h.element("shortcut").textContent, "Disabled");
  await h.fire("reset-shortcut");
  assert.equal(h.element("shortcut").textContent, "Alt+Q");
});

test("rejected shortcut preserves the displayed actual binding", async () => {
  const h = await harness({ errors: { "manga:popup-shortcut": "Reserved combination" } });
  h.element("shortcut-input").value = "Ctrl+L";
  await h.fire("save-shortcut");
  assert.equal(h.element("shortcut").textContent, "Alt+Q");
  assert.equal(h.element("shortcut-input").value, "Alt+Q");
  assert.match(h.element("status").textContent, /unchanged.*Reserved/);
});

test("cache clearing requires the Settings confirmation and preserves unresolved status", async () => {
  const h = await harness();
  await h.fire("clear-cache");
  assert.equal(h.element("clear-confirm").hidden, false);
  await h.fire("cancel-clear");
  assert.match(h.element("cache-stats").textContent, /12 saved translations.*1.0 MB.*1 unfinished/);
  await h.fire("clear-cache");
  assert.equal(h.element("clear-confirm").hidden, false);
  assert.equal(sent(h, "popup-clear-cache").length, 0);
  await h.fire("cancel-clear");
  assert.equal(h.element("clear-confirm").hidden, true);
  await h.fire("clear-cache");
  await h.fire("confirm-clear");
  assert.equal(sent(h, "popup-clear-cache").length, 1);
  assert.match(h.element("cache-stats").textContent, /0 saved translations.*1 unfinished/);
  assert.equal(h.element("clear-confirm").hidden, true);
});

test("pending cache clearing blocks duplicate clears and conflicting settings writes", async () => {
  let finishClear;
  const h = await harness({
    respond: (message) =>
      message.type === "manga:popup-clear-cache"
        ? new Promise((resolve) => {
            finishClear = resolve;
          })
        : undefined,
  });
  await h.fire("clear-cache");
  const clearing = h.fire("confirm-clear");
  for (const id of [
    "confirm-clear",
    "cancel-clear",
    "edit-model",
    "edit-connection",
    "restart-setup",
    "save-shortcut",
  ])
    assert.equal(h.element(id).disabled, true, id);
  for (const id of [
    "confirm-clear",
    "cancel-clear",
    "edit-model",
    "edit-connection",
    "restart-setup",
    "save-shortcut",
  ])
    await h.fire(id);
  visible(h, "settings");
  assert.equal(h.element("clear-confirm").hidden, false);
  assert.equal(sent(h, "popup-clear-cache").length, 1);
  assert.equal(sent(h, "popup-models").length, 0);
  assert.equal(sent(h, "popup-shortcut").length, 0);
  assert.equal(sent(h, "popup-reset-setup").length, 0);
  finishClear({ ok: true, stats: { entries: 0, pages: 0, bytes: 512, unresolved: 1 } });
  await clearing;
  assert.equal(h.element("clear-confirm").hidden, true);
  assert.equal(h.element("edit-connection").disabled, false);
  assert.match(h.element("cache-stats").textContent, /1 unfinished/);
  noPaidRequests(h);
});

test("unknown prices are not displayed as free and genuine zero cost remains zero", () => {
  for (const value of [null, undefined, NaN, Infinity, -1, "0"])
    assert.equal(format.money(value), "unknown");
  assert.equal(format.money(0), "$0");
  assert.match(format.price({ models }, "test/no-prices"), /unknown input.*unknown output/);
});

test("recommended model cards use available models and current prices without choosing automatically", async () => {
  const flash = "google/gemini-3.1-flash-lite";
  const catalogModels = [
    ...models,
    {
      id: flash,
      name: "Google Gemini 3.1 Flash Lite",
      prompt_per_million: 0.77,
      completion_per_million: 4.5,
    },
    {
      id: "google/gemini-3-flash-preview",
      name: "Google Gemini 3 Flash Preview",
      prompt_per_million: 2,
      completion_per_million: 12,
    },
    {
      id: "qwen/qwen3.8-flash",
      name: "Qwen Qwen3.8 Flash",
      prompt_per_million: 5,
      completion_per_million: 25,
    },
  ];
  const h = await harness({ config: { model: "" }, catalog: { models: catalogModels } });
  const cards = h.element("recommended-models").children;
  assert.deepEqual(
    cards.map((button) => button.value),
    ["google/gemini-3-flash-preview", flash],
  );
  assert.deepEqual(
    cards.map((button) => button.getAttribute("aria-pressed")),
    ["false", "false"],
  );
  assert.equal(cards[0].children[0].children[0].textContent, "Gemini 3 Flash");
  assert.equal(cards[0].children[0].children[1].textContent, "Recommended · Preview");
  assert.equal(cards[0].children[1].textContent, "For translations, word meanings and grammar.");
  assert.equal(cards[1].children[0].children[0].textContent, "Gemini 3.1 Flash-Lite");
  assert.equal(cards[1].children[0].children[1].textContent, "Faster & cheaper");
  assert.equal(
    cards[1].children[1].textContent,
    "Shorter waits and lower cost, with less reliable word explanations.",
  );
  assert.match(cards[1].children.at(-1).textContent, /\$0.77 input.*\$4.5 output.*1M tokens/);
  assert.equal(h.element("all-models").open, false);
  assert.equal(h.element("selected-model").hidden, true);
  assert.equal(sent(h, "popup-save-model").length, 0);
  await h.fireElement(cards[1]);
  assert.deepEqual(sent(h, "popup-save-model"), [{ type: "manga:popup-save-model", model: flash }]);
  assert.equal(h.element("recommended-models").children[1].getAttribute("aria-pressed"), "true");
  assert.equal(h.element("recommended-models").children[1].focused, true);
  assert.equal(
    h
      .element("model-list")
      .children.find((button) => button.value === flash)
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(h.element("finish-setup").disabled, false);
  assert.equal(h.element("selected-model").hidden, true);
  visible(h, "model");
  await choose(h, flash);
  assert.equal(sent(h, "popup-save-model").length, 1);
  h.element("model-search").value = "Qwen";
  await h.fire("model-search", "input");
  assert.equal(h.element("model-list").children.length, 1);
  assert.equal(h.element("selected-model-name").textContent, "Google Gemini 3.1 Flash Lite");
  noPaidRequests(h);
});

test("unavailable recommendations never become selectable and an unavailable saved choice remains visible", async () => {
  const saved = "google/gemini-3.1-pro-preview";
  const h = await harness({
    config: { model: saved },
    catalog: {
      models: [
        ...models,
        {
          id: "google/gemini-3.1-flash-lite",
          name: "Flash",
          prompt_per_million: 0.5,
          completion_per_million: 3,
        },
      ],
    },
  });
  await h.fire("edit-model");
  assert.equal(h.element("recommended-models").children.length, 1);
  assert.equal(h.element("recommended-models").children[0].value, "google/gemini-3.1-flash-lite");
  assert.equal(
    h.element("model-list").children.some((button) => button.value === saved),
    false,
  );
  assert.equal(h.element("selected-model-name").textContent, "Gemini 3.1 Pro (Preview)");
  assert.match(h.element("model-price").textContent, /availability could not be verified/);
  assert.equal(sent(h, "popup-save-model").length, 0);
  await h.fire("model-back");
  assert.equal(h.element("current-model").textContent, "Gemini 3.1 Pro (Preview)");
});

test("alternative models remain in the full catalog and a saved choice is not replaced", async () => {
  const previous = [
    "openai/gpt-6-luna",
    "qwen/qwen3.8-flash",
    "google/gemini-3.1-pro-preview",
    "anthropic/claude-opus-4.6",
    "anthropic/claude-sonnet-5",
  ];
  for (const [saved, displayName] of [
    [previous[0], "GPT-6 Luna"],
    [previous[1], "Qwen3.8 Flash"],
    [previous[4], "Claude Sonnet 5"],
  ]) {
    const h = await harness({
      config: { model: saved },
      catalog: {
        models: [
          ...previous.map((id) => ({
            id,
            name: id,
            prompt_per_million: 1,
            completion_per_million: 2,
          })),
          {
            id: "google/gemini-3-flash-preview",
            name: "Gemini 3 Flash Preview",
            prompt_per_million: 0.31,
            completion_per_million: 1.42,
          },
        ],
      },
    });
    await h.fire("edit-model");
    assert.deepEqual(
      h.element("recommended-models").children.map((button) => button.value),
      ["google/gemini-3-flash-preview"],
    );
    const all = h.element("model-list").children;
    for (const id of previous) assert.ok(all.some((button) => button.value === id));
    assert.equal(all.find((button) => button.value === saved).getAttribute("aria-pressed"), "true");
    assert.equal(h.element("selected-model-name").textContent, saved);
    assert.equal(sent(h, "popup-save-model").length, 0);
    await h.fire("model-back");
    assert.equal(h.element("current-model").textContent, displayName);
    noPaidRequests(h);
  }
});

test("a pending model selection disables choices and Finish while retaining keyboard focus on completion", async () => {
  let finishSave;
  const h = await harness({
    config: { model: "" },
    respond: (message) =>
      message.type === "manga:popup-save-model"
        ? new Promise((resolve) => {
            finishSave = resolve;
          })
        : undefined,
  });
  const budget = h.element("model-list").children.find((button) => button.value === "test/budget");
  const pending = h.fireElement(budget);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.element("model-list").children.every((button) => button.disabled));
  assert.equal(h.element("finish-setup").disabled, true);
  await choose(h, "test/expensive");
  await h.fire("finish-setup");
  assert.equal(sent(h, "popup-save-model").length, 1);
  visible(h, "model");
  finishSave({ ok: true });
  await pending;
  const selected = h
    .element("model-list")
    .children.find((button) => button.value === "test/budget");
  assert.equal(selected.focused, true);
  assert.equal(selected.getAttribute("aria-pressed"), "true");
  assert.equal(h.element("finish-setup").disabled, false);
});

test("empty saved data omits a meaningless clear action", async () => {
  const h = await harness({
    stats: { entries: 0, pages: 0, regions: 0, bytes: 512, unresolved: 1 },
  });
  assert.equal(h.element("clear-cache").hidden, true);
  assert.equal(h.element("clear-cache").disabled, true);
  await h.fire("clear-cache");
  assert.equal(h.element("clear-confirm").hidden, true);
});

test("existing users can repair permission or replace a key without reentering model setup", async () => {
  const h = await harness({ hasAccess: false });
  visible(h, "settings");
  assert.equal(h.element("edit-connection").textContent, "Allow access");
  await h.fire("edit-connection");
  assert.equal(h.element("allow-access").hidden, false);
  assert.equal(h.element("key-back").textContent, "Back to settings");
  await h.fire("allow-access");
  assert.equal(h.element("allow-access").hidden, true);
  assert.equal(sent(h, "popup-models").length, 0);
  h.element("api-key").value = "replacement-key";
  await h.fire("api-key", "input");
  await h.fire("save-key");
  visible(h, "key");
  assert.equal(sent(h, "popup-models").length, 0);
  await h.fire("key-back");
  visible(h, "settings");
  visible(h, "settings");
  noPaidRequests(h);
});

test("Anki configuration is optional, requests local permission from a click and maps Basic fields", async () => {
  const initial = await harness({ config: virgin });
  assert.equal(initial.element("anki-step").hidden, true);
  assert.equal(
    initial.calls.messages.some((m) => m.type.includes("anki")),
    false,
  );
  const h = await harness();
  await h.fire("edit-anki");
  assert.equal(h.element("anki-step").hidden, false);
  assert.equal(h.element("settings-step").hidden, true);
  await h.fire("anki-connect");
  assert.deepEqual(h.calls.permissions.at(-1), { origins: ["http://127.0.0.1/*"] });
  assert.equal(h.element("anki-fields").hidden, false);
  assert.equal(h.element("anki-save").disabled, false);
  await h.fire("anki-save");
  assert.deepEqual(sent(h, "popup-anki-save")[0].config, {
    deck: "Japanese",
    model: "Basic",
    apiKey: "",
    mapping: { Front: ["word"], Back: ["reading", "meaning", "japanese", "translation"] },
  });
  visible(h, "settings");
  assert.match(h.element("status").textContent, /Anki is ready/);
});

test("Kaishi setup selects the preset and preserves an existing Word Furigana mapping", async () => {
  const { kaishiPreset } = require("../src/background/anki.js");
  const fields = [
    "Word",
    "Word Reading",
    "Word Meaning",
    "Word Furigana",
    "Sentence",
    "Sentence Meaning",
    "Sentence Furigana",
  ];
  for (const existing of [false, true]) {
    const h = await harness({
      respond: (message) => {
        if (message.type === "manga:popup-anki-config")
          return {
            ok: true,
            config: existing
              ? { model: "Kaishi 1.5k", mapping: { "Word Furigana": ["reading"] } }
              : {},
          };
        if (message.type === "manga:popup-anki-connect")
          return { ok: true, decks: ["Mined Words"], models: ["Kaishi 1.5k"] };
        if (message.type === "manga:popup-anki-fields")
          return { ok: true, fields, preset: kaishiPreset(fields) };
      },
    });
    await h.fire("edit-anki");
    await h.fire("anki-connect");
    assert.match(h.element("anki-mapping-hint").textContent, /Kaishi/);
    await h.fire("anki-save");
    const config = sent(h, "popup-anki-save")[0].config;
    assert.deepEqual(config.mapping.Word, ["word"]);
    assert.deepEqual(config.mapping.Sentence, ["japanese"]);
    assert.deepEqual(config.mapping["Sentence Meaning"], ["translation"]);
    assert.deepEqual(config.mapping[existing ? "Word Furigana" : "Word Reading"], ["reading"]);
  }
});

test("Anki denied permission or missing fields cannot save a partial setup", async () => {
  const denied = await harness({ denied: true });
  await denied.fire("edit-anki");
  await denied.fire("anki-connect");
  assert.equal(sent(denied, "popup-anki-connect").length, 0);
  assert.equal(denied.element("anki-save").disabled, true);
  const h = await harness({ errors: { "manga:popup-anki-fields": "Anki is closed" } });
  await h.fire("edit-anki");
  await h.fire("anki-connect");
  assert.equal(h.element("anki-save").disabled, true);
  assert.equal(h.element("anki-fields").hidden, true);
  await h.fire("anki-save");
  assert.equal(sent(h, "popup-anki-save").length, 0);
});

test("unfinished Anki onboarding resumes without contacting Anki and skipping persists completion", async () => {
  const h = await harness({ config: { anki_setup_pending: true } });
  visible(h, "anki");
  assert.equal(h.element("anki-step-label").textContent, "STEP 3 OF 3 · OPTIONAL");
  assert.equal(h.element("anki-skip").hidden, false);
  assert.equal(h.element("anki-back").textContent, "Back");
  assert.equal(h.element("anki-disconnect").hidden, true);
  assert.equal(h.calls.permissions.length, 0);
  assert.equal(sent(h, "popup-anki-connect").length, 0);
  await h.fire("anki-skip");
  assert.equal(h.config.anki_setup_pending, false);
  visible(await harness({ config: h.config }), "settings");
  assert.equal(sent(h, "popup-anki-save").length, 0);
});

test("Anki onboarding can return to model selection and finish with a saved mapping", async () => {
  const h = await harness({ config: { anki_setup_pending: true } });
  await h.fire("anki-back");
  visible(h, "model");
  assert.equal(h.element("finish-setup").hidden, false);
  await h.fire("finish-setup");
  visible(h, "anki");
  await h.fire("anki-connect");
  await h.fire("anki-save");
  assert.equal(sent(h, "popup-anki-save").length, 1);
  assert.equal(sent(h, "popup-finish-setup").length, 1);
  visible(h, "settings");
  visible(await harness({ config: h.config }), "settings");
});

test("Anki being offline does not prevent finishing setup without it", async () => {
  const h = await harness({
    config: { anki_setup_pending: true },
    errors: { "manga:popup-anki-connect": "Open Anki and try again." },
  });
  await h.fire("anki-connect");
  assert.match(h.element("anki-status").textContent, /Open Anki/);
  assert.equal(h.element("anki-skip").disabled, false);
  await h.fire("anki-skip");
  visible(h, "settings");
  await h.fire("edit-anki");
  assert.equal(h.element("anki-skip").hidden, true);
  assert.equal(h.element("anki-back").textContent, "Back to settings");
});
