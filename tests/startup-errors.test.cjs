"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { storage, provider, settings, background, IDBFactory } = require("./core-helpers.cjs");

function storageArea(values = {}) {
  return {
    async get(keys) {
      return Object.fromEntries(
        (typeof keys === "string" ? [keys] : keys).map((key) => [key, values[key]]),
      );
    },
    async set(changes) {
      Object.assign(values, changes);
    },
    async remove(key) {
      delete values[key];
    },
  };
}

function blockedStartup(t, { asynchronous = false, hasKey = true } = {}) {
  const securityError = new DOMException("The operation is insecure.", "SecurityError");
  const indexedDB = new IDBFactory();
  t.mock.method(indexedDB, "open", () => {
    if (!asynchronous) throw securityError;
    const request = { error: securityError };
    queueMicrotask(() => request.onerror());
    return request;
  });
  const local = {
    ...(hasKey ? { openRouterApiKey: "synthetic-test-key" } : {}),
    selectedModel: "test/cheap",
    mangaModelCatalog: {
      fetchedAt: Date.now(),
      models: [
        { id: "test/cheap", name: "Cheap" },
        { id: "test/another", name: "Another" },
      ],
    },
  };
  const calls = { injections: 0, captures: 0, paid: 0, catalog: 0 };
  const commandErrors = [];
  let command;
  let shortcut = "Alt+Q";
  const event = { addListener() {} };
  const extension = {
    runtime: {
      id: "startup-test",
      getURL: (file) => "moz-extension://startup-test/" + file,
      onMessage: event,
      onConnect: event,
    },
    storage: { local: storageArea(local), session: storageArea() },
    permissions: {
      async contains() {
        return true;
      },
    },
    commands: {
      onCommand: {
        addListener(listener) {
          command = listener;
        },
      },
      async getAll() {
        return [{ name: "select-manga", shortcut }];
      },
      async update(change) {
        shortcut = change.shortcut;
      },
    },
    action: {
      async setTitle({ title }) {
        commandErrors.push(title);
      },
      async setBadgeText() {},
      async openPopup() {},
    },
    tabs: {
      onRemoved: event,
      onUpdated: event,
      async query() {
        return [{ id: 1, windowId: 1, url: "https://reader.example/book" }];
      },
      async captureVisibleTab() {
        calls.captures++;
      },
      async sendMessage() {},
    },
    scripting: {
      async executeScript() {
        calls.injections++;
      },
    },
  };
  const providerMock = {
    ...provider,
    async complete() {
      calls.paid++;
      throw new Error("No provider request is allowed in this startup test.");
    },
  };
  const preferences = new settings.SettingsService(extension, providerMock, async () => {
    calls.catalog++;
    throw new Error("This test uses only the cached model catalog.");
  });
  const store = new storage.MangaStore(indexedDB, "startup-errors");
  const app = background.createBackground(extension, {
    store,
    provider: providerMock,
    settings: preferences,
    loadStyles: async () => "",
  });
  t.after(() => store.db?.close());
  const sender = {
    id: extension.runtime.id,
    url: extension.runtime.getURL("popup/popup.html"),
  };
  return {
    app,
    calls,
    local,
    async activate() {
      await command("select-manga", { id: 1, windowId: 1, url: "https://reader.example/book" });
      return commandErrors.at(-1);
    },
    popup: (type, fields = {}) => app.listener({ type: `manga:popup-${type}`, ...fields }, sender),
  };
}

function assertStorageFailure(response) {
  assert.equal(response.ok, false);
  assert.equal(response.code, "storage");
  assert.match(response.error, /local cache/i);
  assert.match(response.error, /restart Firefox/i);
  assert.doesNotMatch(response.error, /the operation is insecure/i);
}

test("a synchronous IndexedDB security failure preserves settings and blocks cache work safely", async (t) => {
  const env = blockedStartup(t);
  await assert.rejects(env.app.ready, { code: "storage" });

  const initial = await env.popup("config");
  assert.equal(initial.ok, true);
  assert.deepEqual(initial.config, {
    key_configured: true,
    model: "test/cheap",
    shortcut: "Alt+Q",
  });
  assert.equal(JSON.stringify(initial).includes("synthetic-test-key"), false);

  assert.equal((await env.popup("remove-key")).ok, true);
  assert.equal((await env.popup("config")).config.key_configured, false);
  assert.equal((await env.popup("save-key", { apiKey: "synthetic-replacement-key" })).ok, true);
  assert.equal((await env.popup("config")).config.key_configured, true);
  assert.equal(env.local.openRouterApiKey, "synthetic-replacement-key");

  const models = await env.popup("models");
  assert.equal(models.ok, true);
  assert.equal(models.catalog.models.length, 2);
  assert.equal((await env.popup("save-model", { model: "test/another" })).ok, true);
  assert.equal(
    (await env.popup("shortcut", { action: "set", shortcut: "Ctrl+Shift+U" })).shortcut,
    "Ctrl+Shift+U",
  );
  const changed = await env.popup("config");
  assert.equal(changed.config.model, "test/another");
  assert.equal(changed.config.shortcut, "Ctrl+Shift+U");

  for (const route of ["cache-stats", "clear-cache"]) assertStorageFailure(await env.popup(route));
  assert.match(await env.activate(), /local cache/i);
  assert.deepEqual(env.calls, { injections: 0, captures: 0, paid: 0, catalog: 0 });
});

test("missing-key setup is reported before a failed cache without injecting or submitting", async (t) => {
  const env = blockedStartup(t, { hasKey: false });
  await assert.rejects(env.app.ready, { code: "storage" });
  const error = await env.activate();
  assert.match(error, /save.*OpenRouter key/i);
  assert.doesNotMatch(error, /insecure|local cache/i);
  assert.deepEqual(env.calls, { injections: 0, captures: 0, paid: 0, catalog: 0 });
});

test("an asynchronous IndexedDB security error is also actionable without disabling settings", async (t) => {
  const env = blockedStartup(t, { asynchronous: true });
  await assert.rejects(env.app.ready, { code: "storage" });
  assertStorageFailure(await env.popup("cache-stats"));
  assert.equal((await env.popup("config")).ok, true);
  assert.deepEqual(env.calls, { injections: 0, captures: 0, paid: 0, catalog: 0 });
});
