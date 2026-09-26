const test = require("node:test");
const assert = require("node:assert/strict");
const {
  storage,
  provider,
  settings,
  background,
  IDBFactory,
  PNG,
  viewport,
  rect,
  result,
  settle,
} = require("./core-helpers.cjs");

function storageArea(values) {
  return {
    async get(keys) {
      if (typeof keys === "string") return { [keys]: structuredClone(values[keys]) };
      return Object.fromEntries(keys.map((key) => [key, structuredClone(values[key])]));
    },
    async set(value) {
      Object.assign(values, structuredClone(value));
    },
    async remove(key) {
      for (const name of Array.isArray(key) ? key : [key]) delete values[name];
    },
  };
}

async function harness(t, options = {}) {
  const calls = {
    provider: [],
    sent: [],
    injected: [],
    captures: [],
    catalog: [],
    badges: [],
    titles: [],
    openedPopups: 0,
  };
  const listeners = {};
  const tab = { id: 5, windowId: 2, url: "https://reader.example/book?book=123", ...options.tab };
  let active = tab;
  let shortcut = "Alt+Q";
  let access = options.access !== false;
  const local = {
    openRouterApiKey: "private-key-not-for-page",
    selectedModel: "test/cheap",
    mangaModelCatalog: {
      fetchedAt: Date.now(),
      models: [
        { id: "test/cheap", name: "Cheap" },
        { id: "test/another", name: "Another" },
      ],
    },
    ...options.stored,
  };
  const sessionStorage = options.sessionStorage || {};
  const event = (name) => ({
    addListener(callback) {
      listeners[name] = callback;
    },
  });
  const extension = {
    runtime: {
      id: "extension-id",
      getURL: (file) => "moz-extension://test/" + file,
      onMessage: event("message"),
      onConnect: event("connect"),
    },
    storage: { local: storageArea(local), session: storageArea(sessionStorage) },
    permissions: {
      async contains() {
        return access;
      },
    },
    tabs: {
      async query() {
        return [active];
      },
      async get() {
        return tab;
      },
      async captureVisibleTab(...args) {
        calls.captures.push(args);
        return PNG;
      },
      async sendMessage(id, message, target) {
        calls.sent.push({ id, message, target });
        if (options.readerResponse) return options.readerResponse(message);
        return { ok: true, sessionId: message.sessionId, mounted: true };
      },
      onRemoved: event("removed"),
      onUpdated: event("updated"),
    },
    scripting: {
      async insertCSS(value) {
        calls.injected.push(value);
      },
      async executeScript(value) {
        calls.injected.push(value);
      },
    },
    commands: {
      onCommand: event("command"),
      async getAll() {
        return [{ name: "select-manga", shortcut }];
      },
      async update(value) {
        if (value.shortcut === "bad") throw new Error("Unsupported shortcut");
        shortcut = value.shortcut;
      },
      async reset() {
        shortcut = "Alt+Q";
      },
    },
    action: {
      async setTitle(value) {
        calls.titles.push(value);
      },
      async setBadgeText(value) {
        calls.badges.push(value);
      },
      async openPopup() {
        calls.openedPopups++;
        if (options.popupFailure) throw new Error("Firefox blocked automatic popup opening");
      },
    },
  };
  const store = new storage.MangaStore(new IDBFactory(), "reader-background-test");
  const providerMock = {
    ...provider,
    async complete(job) {
      calls.provider.push(job);
      return options.complete ? options.complete(job) : result(job);
    },
  };
  const preferences = new settings.SettingsService(
    extension,
    providerMock,
    async (url, request) => {
      calls.catalog.push({ url, request });
      if (options.catalogFailure) throw new Error("Offline");
      return {
        ok: true,
        async json() {
          return {
            data: [
              {
                id: "test/cheap",
                name: "Cheap",
                architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
                supported_parameters: ["structured_outputs"],
                pricing: {},
              },
            ],
          };
        },
      };
    },
  );
  const app = background.createBackground(extension, {
    store,
    provider: providerMock,
    settings: preferences,
    loadStyles: async () => ":host { color: black; }",
  });
  await app.ready;
  t.after(async () => {
    await settle(app.jobs);
    store.db?.close();
  });

  const sender = { id: extension.runtime.id, tab, frameId: 0, url: tab.url };
  const popup = { id: extension.runtime.id, url: extension.runtime.getURL("popup/popup.html") };
  const request = (message, customSender = sender) => app.listener(message, customSender);
  return {
    app,
    calls,
    local,
    sessionStorage,
    extension,
    sender,
    listeners,
    request,
    setActive(value) {
      active = value;
    },
    setAccess(value) {
      access = value;
    },
    async popup(type, fields = {}) {
      return request({ type: "manga:popup-" + type, ...fields }, popup);
    },
    activate: () => app.reader.start(active).catch(background.errorResponse),
    async start() {
      const response = await app.reader.start(active);
      assert.equal(response.ok, true, response.error);
      return calls.sent.at(-1).message.sessionId;
    },
  };
}

async function translate(h, sessionId, extra = {}) {
  assert.equal((await h.request({ type: "manga:capture", sessionId, viewport })).ok, true);
  const reply = await h.request({
    type: "manga:analyze",
    sessionId,
    viewport,
    rect,
    imageDataUrl: PNG,
    ...extra,
  });
  assert.equal(reply.ok, true, reply.error);
  await settle(h.app.jobs);
  const poll = await h.request({ type: "manga:poll", sessionId, jobId: reply.jobId });
  return { reply, result: poll.job.result };
}

test("missing setup blocks activation before injection or capture and prioritizes the API key", async (t) => {
  const h = await harness(t, {
    stored: { selectedModel: "", openRouterApiKey: "" },
    access: false,
  });
  const config = await h.popup("config");
  assert.equal(config.config.model, "");
  assert.equal(config.config.key_configured, false);

  const start = await h.activate();
  assert.equal(start.ok, false);
  assert.equal(start.code, "setup-key");
  assert.match(start.error, /Save your OpenRouter key/);
  assert.equal(h.calls.sent.length, 0);
  assert.equal(h.calls.injected.length, 0);
  assert.equal(h.calls.captures.length, 0);
  assert.equal((await h.app.store.all("jobs")).length, 0);
  assert.equal(h.calls.provider.length, 0);
});

test("activation requires a model then network permission after the key is saved", async (t) => {
  const h = await harness(t, { stored: { selectedModel: "" }, access: false });
  assert.equal((await h.activate()).code, "setup-model");
  h.local.selectedModel = "test/cheap";
  assert.equal((await h.activate()).code, "setup-access");
  assert.equal(h.calls.injected.length, 0);
  assert.equal(h.calls.captures.length, 0);
  h.setAccess(true);
  await h.start();
  const message = h.calls.sent.at(-1).message;
  assert.equal(message.setupRequired, false);
  assert.equal(message.setupWarning, "");
  assert.equal(message.shortcut, "Alt+Q");
  assert.match(message.readerCss, /:host/);
  assert.deepEqual(h.calls.injected[0].target.frameIds, [0]);
});

test("activation succeeds only after the mounted reader acknowledges the current session", async (t) => {
  let acknowledge, delivered;
  const received = new Promise((resolve) => (delivered = resolve));
  const h = await harness(t, {
    readerResponse: () =>
      new Promise((resolve) => {
        acknowledge = resolve;
        delivered();
      }),
  });
  let finished = false;
  const starting = h.activate().then((response) => {
    finished = true;
    return response;
  });
  await received;
  assert.equal(finished, false);
  assert.equal(h.calls.injected.length, 1);
  assert.equal(h.calls.sent.length, 1);
  acknowledge({
    ok: true,
    sessionId: h.calls.sent[0].message.sessionId,
    mounted: true,
  });
  assert.deepEqual(await starting, { ok: true });
  assert.equal(h.calls.provider.length, 0);
  assert.equal(h.calls.captures.length, 0);
});

test("missing, stale, and unmounted reader acknowledgements surface activation failure without retry", async (t) => {
  const responses = [
    () => undefined,
    () => ({ ok: true }),
    () => ({ ok: true, sessionId: "another-session", mounted: true }),
    (message) => ({ ok: true, sessionId: message.sessionId, mounted: false }),
    (message) => ({ ok: false, sessionId: message.sessionId, mounted: true }),
    () => {
      throw new Error("Receiving end does not exist.");
    },
  ];
  for (const readerResponse of responses) {
    const h = await harness(t, { readerResponse });
    const response = await h.activate();
    assert.equal(response.ok, false);
    assert.equal(response.code, "reader-start");
    assert.match(response.error, /assistant.*open.*Reload the reading page/);
    assert.equal(h.calls.injected.length, 1);
    assert.equal(h.calls.sent.length, 1);
    assert.equal(h.calls.provider.length, 0);
    assert.equal(h.calls.captures.length, 0);
  }
});

test("shortcut without a key opens setup and retains the badge if Firefox blocks the popup", async (t) => {
  for (const popupFailure of [false, true]) {
    const h = await harness(t, { stored: { openRouterApiKey: "" }, popupFailure });
    await h.listeners.command("select-manga", h.sender.tab);

    assert.equal(h.calls.openedPopups, 1);
    assert.deepEqual(h.calls.badges.at(-1), { text: "!", tabId: h.sender.tab.id });
    assert.match(h.calls.titles.at(-1).title, /Save your OpenRouter key/);
    assert.equal(h.calls.injected.length, 0);
    assert.equal(h.calls.captures.length, 0);
    assert.equal(h.calls.sent.length, 0);
    assert.equal(h.calls.provider.length, 0);
  }
});

test("the first shortcut selects and the second delegates to the open reader without popup, capture, or request", async (t) => {
  const h = await harness(t);
  await h.listeners.command("select-manga", h.sender.tab);
  assert.equal(h.calls.injected.length, 1);
  assert.equal(h.calls.openedPopups, 0);
  const sessionId = h.calls.sent[0].message.sessionId;
  await h.listeners.command("select-manga", h.sender.tab);
  assert.equal(h.calls.injected.length, 1);
  assert.equal(h.calls.openedPopups, 0);
  assert.deepEqual(h.calls.sent.at(-1), {
    id: h.sender.tab.id,
    message: { type: "manga:shortcut", sessionId },
    target: { frameId: 0 },
  });
  assert.equal(h.app.reader.sessions.get(sessionId).closed, false);
  assert.equal(h.app.reader.current.get(h.sender.tab.id), sessionId);
  assert.equal((await h.popup("config")).view, undefined);
  assert.equal(h.calls.captures.length, 0);
  assert.equal(h.calls.provider.length, 0);
});

test("a closed reader with saved translations reopens a read-only library without key, model, or access", async (t) => {
  for (const missing of ["key", "model", "access"]) {
    const h = await harness(t);
    const originalSession = await h.start();
    const saved = await translate(h, originalSession);
    await h.request({ type: "manga:cancel", sessionId: originalSession });
    if (missing === "key") await h.popup("remove-key");
    if (missing === "model") h.local.selectedModel = "";
    if (missing === "access") h.setAccess(false);
    const before = { captures: h.calls.captures.length, providers: h.calls.provider.length };
    await h.listeners.command("select-manga", h.sender.tab);
    const message = h.calls.sent.at(-1).message;
    assert.equal(message.type, "manga:start");
    assert.equal(message.library, true);
    assert.equal(message.setupRequired, true);
    assert.ok(message.setupWarning);
    assert.notEqual(message.sessionId, originalSession);
    assert.equal(h.calls.openedPopups, 0);
    const sessionId = message.sessionId;
    const list = await h.request({ type: "manga:library", sessionId });
    assert.equal(list.entries[0].id, saved.result.run_id);
    const opened = await h.request({ type: "manga:history", sessionId, id: saved.result.run_id });
    assert.equal(opened.ok, true, opened.error);
    assert.equal(opened.history.imageDataUrl, PNG);
    assert.equal(
      (await h.request({ type: "manga:capture", sessionId, viewport })).code,
      "setup-" + missing,
    );
    const compare = await h.request({
      type: "manga:analyze",
      sessionId,
      sourceRunId: saved.result.run_id,
      model: "test/another",
    });
    assert.equal(compare.code, "setup-" + missing);
    assert.deepEqual(
      { captures: h.calls.captures.length, providers: h.calls.provider.length },
      before,
    );
    assert.equal((await h.app.store.all("jobs")).length, 1);
  }
});

test("a restored saved library opens after setup reset even when there is no reader session", async (t) => {
  const h = await harness(t);
  const saved = await h.app.jobs.translation({
    imageDataUrl: PNG,
    context: "",
    model: "test/cheap",
  });
  await settle(h.app.jobs);
  await h.popup("reset-setup");
  assert.equal(h.app.reader.sessions.size, 0);
  await h.listeners.command("select-manga", h.sender.tab);
  const message = h.calls.sent.at(-1).message;
  assert.equal(message.library, true);
  assert.equal(message.setupRequired, true);
  assert.equal(h.calls.openedPopups, 0);
  const opened = await h.request({
    type: "manga:history",
    sessionId: message.sessionId,
    id: saved.jobId,
  });
  assert.equal(opened.ok, true, opened.error);
  assert.equal(opened.history.job.status, "completed");
  assert.equal(h.calls.captures.length, 0);
  assert.equal(h.calls.provider.length, 1);
});

test("a configured first shortcut mounts selection without reading saved translations", async (t) => {
  const h = await harness(t);
  h.app.store.history = () => assert.fail("Normal activation must not scan saved translations");
  await h.listeners.command("select-manga", h.sender.tab);
  assert.equal(h.calls.sent[0].message.type, "manga:start");
  assert.equal(h.calls.sent[0].message.library, undefined);
  assert.equal(h.calls.openedPopups, 0);
});

test("closed readers and a different active tab start selection instead of receiving an in-page shortcut", async (t) => {
  const h = await harness(t);
  const firstSession = await h.start();
  await h.request({ type: "manga:cancel", sessionId: firstSession });
  await h.listeners.command("select-manga", h.sender.tab);
  assert.equal(h.calls.injected.length, 2);
  assert.equal(h.calls.openedPopups, 0);
  const other = { ...h.sender.tab, id: 12, url: "https://reader.example/other" };
  h.setActive(other);
  await h.listeners.command("select-manga", other);
  assert.equal(h.calls.injected.length, 3);
  assert.equal(h.calls.sent.at(-1).id, other.id);
  assert.equal(h.calls.sent.at(-1).message.type, "manga:start");
  assert.equal(h.calls.openedPopups, 0);
});

test("shortcut acknowledgement failure surfaces an error without opening a popup or resubmitting work", async (t) => {
  for (const invalid of [undefined, { ok: true }, { ok: true, sessionId: "old", mounted: true }]) {
    let acknowledge = false;
    const h = await harness(t, {
      readerResponse: (message) =>
        message.type === "manga:start" || acknowledge
          ? { ok: true, sessionId: message.sessionId, mounted: true }
          : invalid,
    });
    const sessionId = await h.start();
    await h.listeners.command("select-manga", h.sender.tab);
    assert.deepEqual(h.calls.badges.at(-1), { text: "!", tabId: h.sender.tab.id });
    assert.match(h.calls.titles.at(-1).title, /reader could not handle the shortcut.*Reload/);
    assert.equal(h.app.reader.sessions.get(sessionId).closed, false);
    assert.equal(h.calls.openedPopups, 0);
    assert.equal(h.calls.injected.length, 1);
    assert.equal(h.calls.captures.length, 0);
    assert.equal(h.calls.provider.length, 0);
    acknowledge = true;
    await h.listeners.command("select-manga", h.sender.tab);
    assert.deepEqual(h.calls.badges.at(-1), { text: "", tabId: h.sender.tab.id });
    assert.equal(h.calls.sent.at(-1).message.type, "manga:shortcut");
  }
});

test("rapid shortcut presses wait for activation before dispatching the in-page shortcut", async (t) => {
  let acknowledge, delivered;
  const received = new Promise((resolve) => (delivered = resolve));
  const h = await harness(t, {
    readerResponse: (message) =>
      message.type === "manga:start"
        ? new Promise((resolve) => {
            acknowledge = () => resolve({ ok: true, sessionId: message.sessionId, mounted: true });
            delivered();
          })
        : { ok: true, sessionId: message.sessionId, mounted: true },
  });
  const first = h.listeners.command("select-manga", h.sender.tab);
  await received;
  const second = h.listeners.command("select-manga", h.sender.tab);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.injected.length, 1);
  assert.equal(h.calls.openedPopups, 0);
  acknowledge();
  await Promise.all([first, second]);
  assert.equal(h.calls.injected.length, 1);
  assert.deepEqual(
    h.calls.sent.map(({ message }) => message.type),
    ["manga:start", "manga:shortcut"],
  );
  assert.equal(h.calls.openedPopups, 0);
});

test("an unmounted first activation is retried by the next shortcut rather than mistaken for an open reader", async (t) => {
  let attempts = 0;
  const h = await harness(t, {
    readerResponse: (message) =>
      ++attempts === 1 ? undefined : { ok: true, sessionId: message.sessionId, mounted: true },
  });
  await h.listeners.command("select-manga", h.sender.tab);
  const failed = h.app.reader.sessions.get(h.app.reader.current.get(h.sender.tab.id));
  assert.equal(failed.closed, true);
  await h.listeners.command("select-manga", h.sender.tab);
  assert.equal(h.calls.injected.length, 2);
  assert.equal(h.calls.openedPopups, 0);
  assert.equal(h.calls.sent.at(-1).message.type, "manga:start");
});

test("an in-page shortcut preserves running work, ports, and reader ownership", async (t) => {
  let finish;
  const providerResult = new Promise((resolve) => (finish = resolve));
  const h = await harness(t, { complete: () => providerResult });
  const sessionId = await h.start();
  await h.request({ type: "manga:capture", sessionId, viewport });
  const submitted = await h.request({
    type: "manga:analyze",
    sessionId,
    imageDataUrl: PNG,
    viewport,
    rect,
  });
  const session = h.app.reader.sessions.get(sessionId);
  const port = { postMessage() {} };
  h.app.reader.ports.set(port, sessionId);
  const captures = h.calls.captures.length;
  const providers = h.calls.provider.length;
  await h.listeners.command("select-manga", h.sender.tab);
  assert.equal(session.closed, false);
  assert.equal(h.app.reader.sessions.get(sessionId), session);
  assert.equal(h.app.reader.current.get(h.sender.tab.id), sessionId);
  assert.equal(h.app.reader.ports.get(port), sessionId);
  assert.ok(session.jobs.includes(submitted.jobId));
  assert.ok(h.app.jobs.active.has(submitted.jobId));
  assert.equal(h.calls.captures.length, captures);
  assert.equal(h.calls.provider.length, providers);
  finish(result(h.calls.provider[0]));
  await settle(h.app.jobs);
  assert.equal(
    (await h.request({ type: "manga:poll", sessionId, jobId: submitted.jobId })).job.status,
    "completed",
  );
});

test("history and saved study remain accessible without setup while new paid actions are rejected", async (t) => {
  const h = await harness(t);
  const sessionId = await h.start();
  const translated = await translate(h, sessionId);
  const study = await h.request({
    type: "manga:study",
    sessionId,
    runId: translated.result.run_id,
    regionId: "bubble-1",
  });
  assert.equal(study.ok, true);
  await settle(h.app.jobs);
  await h.popup("remove-key");
  h.local.selectedModel = "";
  h.setAccess(false);

  const sentBefore = h.calls.sent.length,
    injectedBefore = h.calls.injected.length;
  const query = h.extension.tabs.query;
  h.extension.tabs.query = async () => {
    throw new Error("Saved translations must not inspect the active tab.");
  };
  const opened = await h.request({
    type: "manga:history",
    sessionId,
    id: translated.result.run_id,
  });
  assert.equal(opened.ok, true, opened.error);
  h.extension.tabs.query = query;
  assert.ok(opened.history.result.studies["bubble-1"]);
  assert.equal(opened.history.imageDataUrl, PNG);
  assert.equal(h.calls.sent.length, sentBefore);
  assert.equal(h.calls.injected.length, injectedBefore);
  const cached = await h.request({
    type: "manga:study",
    sessionId,
    runId: translated.result.run_id,
    regionId: "bubble-1",
  });
  assert.equal(cached.cached, true);
  assert.equal(cached.jobId, study.jobId);
  const compare = await h.request({
    type: "manga:analyze",
    sessionId,
    sourceRunId: translated.result.run_id,
    model: "test/another",
  });
  assert.equal(compare.code, "setup-key");
  assert.equal(compare.jobId, undefined);
  assert.equal((await h.app.store.all("jobs")).length, 2);
  assert.equal(h.calls.captures.length, 1);
  assert.equal(h.calls.provider.length, 2);
});

test("opening an in-page saved translation grants only its ownership without setup, navigation, capture, or request", async (t) => {
  const h = await harness(t);
  const originalSession = await h.start();
  const saved = await translate(h, originalSession);
  const sessionId = await h.start();
  const session = h.app.reader.sessions.get(sessionId);
  const before = {
    providers: h.calls.provider.length,
    captures: h.calls.captures.length,
    injections: h.calls.injected.length,
    sent: h.calls.sent.length,
  };
  await h.popup("remove-key");
  h.local.selectedModel = "";
  h.setAccess(false);
  h.extension.tabs.update = () => assert.fail("Saved translations must not navigate the reader");
  const list = await h.request({ type: "manga:library", sessionId });
  assert.equal(list.ok, true, list.error);
  assert.equal(list.entries[0].id, saved.result.run_id);
  assert.deepEqual(session.runs, []);
  assert.deepEqual(session.jobs, []);
  assert.equal(
    (await h.request({ type: "manga:poll", sessionId, jobId: saved.reply.jobId })).ok,
    false,
  );
  const opened = await h.request({ type: "manga:history", sessionId, id: saved.result.run_id });
  assert.equal(opened.ok, true, opened.error);
  assert.equal(opened.history.imageDataUrl, PNG);
  assert.deepEqual(session.runs, [saved.result.run_id]);
  assert.deepEqual(session.jobs, [saved.reply.jobId]);
  assert.equal(
    (await h.request({ type: "manga:poll", sessionId, jobId: saved.reply.jobId })).job.status,
    "completed",
  );
  const foreign = await h.request({ type: "manga:reopen", sessionId, runId: "unowned-run" });
  assert.equal(foreign.ok, false);
  assert.match(foreign.error, /does not belong to this reading session/);
  assert.deepEqual(
    {
      providers: h.calls.provider.length,
      captures: h.calls.captures.length,
      injections: h.calls.injected.length,
      sent: h.calls.sent.length,
    },
    before,
  );
  assert.equal(h.calls.openedPopups, 0);
});

test("library and history reject closed, stale, foreign, and navigated sessions without exposing entries", async (t) => {
  const h = await harness(t);
  const first = await h.start();
  const sessionId = await h.start();
  const saved = await translate(h, sessionId);
  const missing = await h.request({ type: "manga:history", sessionId, id: "removed-answer" });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /no longer available/);
  for (const type of ["manga:library", "manga:history"]) {
    const message = { type, sessionId, id: saved.result.run_id };
    for (const [request, sender] of [
      [{ ...message, sessionId: first }, h.sender],
      [message, { ...h.sender, frameId: 1 }],
      [message, { ...h.sender, tab: { ...h.sender.tab, id: 999 } }],
      [message, { ...h.sender, url: "https://different.example/" }],
      [
        message,
        { id: h.extension.runtime.id, url: h.extension.runtime.getURL("popup/popup.html") },
      ],
    ]) {
      const response = await h.request(request, sender);
      assert.equal(response.ok, false);
      assert.equal(response.entries, undefined);
      assert.equal(response.history, undefined);
    }
  }
  await h.request({ type: "manga:cancel", sessionId });
  for (const type of ["manga:library", "manga:history"]) {
    const response = await h.request({ type, sessionId, id: saved.result.run_id });
    assert.equal(response.ok, false);
    assert.match(response.error, /session has changed/);
  }
  assert.equal(h.calls.provider.length, 1);
  assert.equal(h.calls.captures.length, 1);
});

test("library reads finishing after dismissal disclose no saved data or ownership", async (t) => {
  for (const type of ["library", "history"]) {
    const h = await harness(t);
    const sourceSession = await h.start();
    const saved = await translate(h, sourceSession);
    const sessionId = await h.start();
    const service = type === "library" ? h.app.store : h.app.jobs;
    const read = service.history.bind(service);
    let received, finish;
    const reading = new Promise((resolve) => {
      received = resolve;
    });
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    service.history = async (...args) => {
      received();
      await pending;
      return read(...args);
    };
    const opening = h.request({ type: "manga:" + type, sessionId, id: saved.result.run_id });
    await reading;
    await h.request({ type: "manga:cancel", sessionId });
    finish();
    const response = await opening;
    assert.equal(response.ok, false);
    assert.equal(response.history, undefined);
    assert.equal(response.entries, undefined);
    assert.deepEqual(h.app.reader.sessions.get(sessionId).jobs, []);
    assert.deepEqual(h.app.reader.sessions.get(sessionId).runs, []);
  }
});

test("opening a pending library entry transfers polling ownership without resubmitting it", async (t) => {
  let finish;
  const h = await harness(t, {
    complete: (job) => new Promise((resolve) => (finish = () => resolve(result(job)))),
  });
  const pending = await h.app.jobs.translation({
    imageDataUrl: PNG,
    context: "",
    model: "test/cheap",
  });
  try {
    const sessionId = await h.start();
    const opened = await h.request({ type: "manga:history", sessionId, id: pending.jobId });
    assert.equal(opened.ok, true, opened.error);
    assert.equal(opened.history.job.job_id, pending.jobId);
    assert.equal(opened.history.job.status, "running");
    const poll = await h.request({ type: "manga:poll", sessionId, jobId: pending.jobId });
    assert.equal(poll.ok, true);
    assert.equal(poll.job.status, "running");
    assert.equal(h.calls.provider.length, 1);
    assert.equal(h.calls.captures.length, 0);
    assert.equal((await h.app.store.all("jobs")).length, 1);
  } finally {
    finish();
  }
});

test("removing the key after activation blocks capture, translation, study and explicit retry before new intent", async (t) => {
  const h = await harness(t, {
    complete: async (job) => {
      if (job.input.context === "fail")
        throw new provider.ProviderError("Lost connection", "interrupted", true);
      return result(job);
    },
  });
  const sessionId = await h.start();
  const translated = await translate(h, sessionId);
  const failed = await h.request({
    type: "manga:analyze",
    sessionId,
    imageDataUrl: PNG,
    viewport,
    rect,
    context: "fail",
  });
  await settle(h.app.jobs);
  await h.popup("remove-key");

  for (const request of [
    { type: "manga:capture", viewport },
    { type: "manga:analyze", imageDataUrl: PNG, viewport, rect, context: "new" },
    { type: "manga:study", runId: translated.result.run_id, regionId: "bubble-1" },
    { type: "manga:retry", jobId: failed.jobId },
  ]) {
    const response = await h.request({ ...request, sessionId });
    assert.equal(response.code, "setup-key", request.type);
    assert.equal(response.jobId, undefined, request.type);
  }
  const cached = await h.request({
    type: "manga:analyze",
    sessionId,
    sourceRunId: translated.result.run_id,
    model: "test/cheap",
  });
  assert.equal(cached.cached, true);
  assert.equal(h.calls.captures.length, 1);
  assert.equal(h.calls.provider.length, 2);
  assert.equal((await h.app.store.all("jobs")).length, 2);
});

test("Firefox screenshot and injection SecurityErrors retain their cause and give an actionable message", async (t) => {
  const h = await harness(t);
  const cause = Object.assign(new Error("The operation is insecure."), { name: "SecurityError" });
  const inject = h.extension.scripting.executeScript;
  h.extension.scripting.executeScript = async () => {
    throw cause;
  };
  await assert.rejects(
    h.app.reader.start(h.sender.tab),
    (error) =>
      error.code === "reader-access" &&
      error.cause === cause &&
      /Firefox blocked the assistant.*shortcut/.test(error.message),
  );
  h.extension.scripting.executeScript = inject;
  const sessionId = await h.start();
  h.extension.tabs.captureVisibleTab = async () => {
    throw cause;
  };
  await assert.rejects(
    h.app.reader.capture(h.app.reader.sessions.get(sessionId), {
      type: "manga:capture",
      viewport,
    }),
    (error) =>
      error.code === "capture-access" &&
      error.cause === cause &&
      /Firefox blocked the screenshot.*shortcut/.test(error.message),
  );
  assert.equal(h.app.reader.capturing.size, 0);
  assert.equal(h.calls.provider.length, 0);
});

test("blocked local settings reads and writes report recovery steps instead of raw SecurityErrors", async (t) => {
  const h = await harness(t);
  const cause = Object.assign(new Error("The operation is insecure."), { name: "SecurityError" });
  for (const [operation, run] of [
    ["get", () => h.app.settings.key()],
    ["set", () => h.app.settings.saveKey("new-valid-key")],
    ["remove", () => h.app.settings.removeKey()],
  ]) {
    const original = h.extension.storage.local[operation];
    h.extension.storage.local[operation] = async () => {
      throw cause;
    };
    await assert.rejects(
      run(),
      (error) =>
        error.code === "settings-storage" &&
        error.cause === cause &&
        /Firefox blocked .* extension settings\. Restart Firefox/.test(error.message) &&
        !error.message.includes("insecure"),
    );
    h.extension.storage.local[operation] = original;
  }
  assert.equal(h.calls.provider.length, 0);
});

test("blocked session storage retains its cause and names the recovery action", async (t) => {
  const h = await harness(t);
  const cause = Object.assign(new Error("The operation is insecure."), { name: "SecurityError" });
  for (const [operation, run] of [
    ["get", () => h.app.reader.restore()],
    ["set", () => h.app.reader.save()],
  ]) {
    h.extension.storage.session[operation] = async () => {
      throw cause;
    };
    await assert.rejects(
      run(),
      (error) =>
        error.code === "session-storage" &&
        error.cause === cause &&
        /Firefox blocked .*reading session.*Restart Firefox/.test(error.message),
    );
  }
});

test("credentials stay within settings and replacement/removal never calls a provider", async (t) => {
  const h = await harness(t);
  await h.popup("save-key", { apiKey: "new-private-key" });
  const config = await h.popup("config");
  await h.start();
  assert.equal(JSON.stringify([config, h.calls.sent]).includes("new-private-key"), false);
  assert.equal((await h.popup("save-key", { apiKey: " " })).ok, false);
  assert.equal(h.local.openRouterApiKey, "new-private-key");
  await h.popup("remove-key");
  assert.equal(h.local.openRouterApiKey, undefined);
  assert.equal(h.calls.provider.length, 0);
});

test("restarting setup removes only key and model while saved translations and active requests survive", async (t) => {
  let finish;
  const h = await harness(t, {
    stored: { readerCardPosition: { x: 0.25, y: 0.75 } },
    complete: (job) =>
      job.input.context === "pending"
        ? new Promise((resolve) => {
            finish = () => resolve(result(job));
          })
        : result(job),
  });
  await h.popup("shortcut", { action: "set", shortcut: "Ctrl+Shift+U" });
  const sessionId = await h.start();
  const translated = await translate(h, sessionId);
  await h.request({ type: "manga:capture", sessionId, viewport });
  const pending = await h.request({
    type: "manga:analyze",
    sessionId,
    imageDataUrl: PNG,
    viewport,
    rect,
    context: "pending",
  });
  assert.equal(pending.ok, true, pending.error);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finish, "function");
  const before = await h.app.store.stats();
  const providerCalls = h.calls.provider.length;
  assert.equal((await h.popup("reset-setup")).ok, true);
  assert.equal(h.local.openRouterApiKey, undefined);
  assert.equal(h.local.selectedModel, undefined);
  assert.deepEqual(h.local.readerCardPosition, { x: 0.25, y: 0.75 });
  const config = (await h.popup("config")).config;
  assert.deepEqual(config, { key_configured: false, model: "", shortcut: "Ctrl+Shift+U" });
  assert.equal(h.calls.provider.length, providerCalls);
  assert.deepEqual(await h.app.store.stats(), before);
  assert.equal(
    (await h.request({ type: "manga:history", sessionId, id: translated.result.run_id })).history
      .imageDataUrl,
    PNG,
  );
  const running = await h.request({ type: "manga:history", sessionId, id: pending.jobId });
  assert.ok(["queued", "running"].includes(running.history.job.status));
  finish();
  await settle(h.app.jobs);
  const completed = await h.request({ type: "manga:history", sessionId, id: pending.jobId });
  assert.equal(completed.history.job.status, "completed");
  assert.ok(completed.history.result);
  assert.equal(h.calls.provider.length, providerCalls);
});

test("setup reset cannot be undone by a model save left pending by an earlier popup", async (t) => {
  const h = await harness(t);
  h.local.mangaModelCatalog.fetchedAt = 0;
  const fetcher = h.app.settings.fetcher;
  let finishCatalog;
  h.app.settings.fetcher = async (...args) => {
    await new Promise((resolve) => {
      finishCatalog = resolve;
    });
    return fetcher(...args);
  };
  const oldSave = h.popup("save-model", { model: "test/cheap" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finishCatalog, "function");
  // Closing a popup does not cancel the background handler it already started.
  const resetFromNewPopup = h.popup("reset-setup");
  await new Promise((resolve) => setImmediate(resolve));
  finishCatalog();
  const [saved, reset] = await Promise.all([oldSave, resetFromNewPopup]);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(reset.ok, true, reset.error);
  assert.equal(h.local.openRouterApiKey, undefined);
  assert.equal(h.local.selectedModel, undefined);
  const config = await h.popup("config");
  assert.equal(config.config.key_configured, false);
  assert.equal(config.config.model, "");
  assert.equal(h.calls.provider.length, 0);
});

test("configuration is popup-only and old popup reading routes are no longer available", async (t) => {
  const h = await harness(t);
  const response = await h.request({ type: "manga:popup-reset-setup" });
  assert.equal(response.ok, false);
  assert.match(response.error, /only available from extension settings/);
  for (const route of ["start", "history", "open-history", "show-history", "retry-history"]) {
    const removed = await h.popup(route, { id: "arbitrary", jobId: "arbitrary" });
    assert.equal(removed.ok, false);
    assert.match(removed.error, /Unknown extension settings request/);
  }
  assert.equal(h.local.openRouterApiKey, "private-key-not-for-page");
  assert.equal(h.local.selectedModel, "test/cheap");
  assert.equal(h.calls.injected.length, 0);
  assert.equal(h.calls.provider.length, 0);
});

for (const kind of ["translation", "study"]) {
  test(`in-page retry of a saved ${kind} validates setup and reuses only the original job input`, async (t) => {
    let attempts = 0,
      finish;
    const h = await harness(t, {
      complete: (job) => {
        if (job.kind !== kind) return result(job);
        if (++attempts === 1)
          throw new provider.ProviderError("The response was interrupted", "interrupted", true);
        return new Promise((resolve) => {
          finish = () => resolve(result(job));
        });
      },
    });
    const sessionId = await h.start();
    const page = await h.request({
      type: "manga:page-save",
      sessionId,
      page: { imageDataUrl: PNG, viewport, descriptor: { version: 1 } },
    });
    const translated = await translate(h, sessionId, {
      context: "original context",
      pageId: page.pageId,
    });
    let jobId = translated.reply.jobId;
    if (kind === "study") {
      const studying = await h.request({
        type: "manga:study",
        sessionId,
        runId: translated.result.run_id,
        regionId: "bubble-1",
      });
      jobId = studying.jobId;
      await settle(h.app.jobs);
    }
    const original = structuredClone(await h.app.jobs.get(jobId));
    assert.equal(original.status, "interrupted");
    const sentBefore = h.calls.sent.length,
      injectedBefore = h.calls.injected.length,
      capturesBefore = h.calls.captures.length,
      providerBefore = h.calls.provider.length;
    for (let read = 0; read < 2; read++)
      assert.equal((await h.request({ type: "manga:history", sessionId, id: jobId })).ok, true);
    assert.equal(h.calls.provider.length, providerBefore, "reading never retries");

    await h.popup("remove-key");
    const blocked = await h.request({ type: "manga:retry", sessionId, jobId });
    assert.equal(blocked.code, "setup-key");
    assert.equal((await h.app.store.all("jobs")).length, kind === "study" ? 2 : 1);
    assert.equal(h.calls.provider.length, providerBefore);
    await h.popup("save-key", { apiKey: "replacement-fixture-key" });
    const [first, duplicate] = await Promise.all([
      h.request({
        type: "manga:retry",
        sessionId,
        jobId,
        imageDataUrl: "untrusted replacement",
        model: "test/another",
        context: "changed",
      }),
      h.request({ type: "manga:retry", sessionId, jobId }),
    ]);
    assert.equal(first.ok, true, first.error);
    assert.equal(duplicate.ok, true, duplicate.error);
    assert.equal(first.jobId, duplicate.jobId);
    assert.notEqual(first.jobId, jobId);
    assert.equal(h.calls.provider.length, providerBefore + 1);
    const retried = await h.app.jobs.get(first.jobId);
    assert.equal(retried.kind, original.kind);
    assert.equal(retried.model, original.model);
    assert.deepEqual(retried.input, original.input);
    assert.deepEqual(retried.associations, original.associations);
    finish();
    await settle(h.app.jobs);
    assert.equal(
      (await h.request({ type: "manga:history", sessionId, id: first.jobId })).history.job.status,
      "completed",
    );
    assert.equal(h.calls.sent.length, sentBefore);
    assert.equal(h.calls.injected.length, injectedBefore);
    assert.equal(h.calls.captures.length, capturesBefore);
    assert.equal(h.calls.provider.length, providerBefore + 1);
  });
}

test("card position persists into the next activation without exposing credentials", async (t) => {
  const h = await harness(t);
  const sessionId = await h.start();
  assert.deepEqual(h.calls.sent.at(-1).message.cardPosition, { x: 1, y: 1 });
  const saved = await h.request({
    type: "manga:save-card-position",
    sessionId,
    position: { x: 0.25, y: 0.75, ignored: "extra metadata" },
  });
  assert.deepEqual(saved, { ok: true });
  assert.deepEqual(h.local.readerCardPosition, { x: 0.25, y: 0.75 });
  const preferences = new settings.SettingsService(h.extension, provider);
  assert.deepEqual(await preferences.cardPosition(), { x: 0.25, y: 0.75 });

  await h.start();
  assert.deepEqual(h.calls.sent.at(-1).message.cardPosition, { x: 0.25, y: 0.75 });
  assert.equal(JSON.stringify([saved, h.calls.sent]).includes(h.local.openRouterApiKey), false);
  assert.equal(h.calls.captures.length, 0);
  assert.equal(h.calls.catalog.length, 0);
  assert.equal(h.calls.provider.length, 0);
});

test("authenticated card-position updates need no setup, capture or active tab", async (t) => {
  const h = await harness(t);
  const sessionId = await h.start();
  await h.popup("remove-key");
  h.local.selectedModel = "";
  h.setAccess(false);
  h.setActive({ ...h.sender.tab, id: 999 });

  const saved = await h.request({
    type: "manga:save-card-position",
    sessionId,
    position: { x: 0, y: 1 },
  });
  assert.deepEqual(saved, { ok: true });
  assert.deepEqual(h.local.readerCardPosition, { x: 0, y: 1 });
  assert.equal(h.calls.captures.length, 0);
  assert.equal(h.calls.catalog.length, 0);
  assert.equal(h.calls.provider.length, 0);
});

test("invalid card positions default when read and cannot overwrite a saved preference", async (t) => {
  const h = await harness(t);
  const invalid = [
    undefined,
    null,
    [],
    { x: 0 },
    { x: "0.5", y: 0.5 },
    { x: NaN, y: 0.5 },
    { x: 0.5, y: Infinity },
    { x: -0.01, y: 0.5 },
    { x: 0.5, y: 1.01 },
  ];
  for (const position of invalid) {
    h.local.readerCardPosition = position;
    assert.deepEqual(await h.app.settings.cardPosition(), { x: 1, y: 1 });
  }
  const sessionId = await h.start();
  assert.deepEqual(h.calls.sent.at(-1).message.cardPosition, { x: 1, y: 1 });
  h.local.readerCardPosition = { x: 1, y: 0 };
  for (const position of invalid) {
    const response = await h.request({ type: "manga:save-card-position", sessionId, position });
    assert.equal(response.ok, false);
    assert.match(response.error, /valid card position/);
    assert.deepEqual(h.local.readerCardPosition, { x: 1, y: 0 });
  }
});

test("card-position writes reject unauthenticated and replaced reader sessions", async (t) => {
  const h = await harness(t, { stored: { readerCardPosition: { x: 0.2, y: 0.8 } } });
  const previous = await h.start();
  const sessionId = await h.start();
  const message = { type: "manga:save-card-position", sessionId, position: { x: 0, y: 0 } };
  for (const sender of [
    { ...h.sender, id: "foreign" },
    { ...h.sender, frameId: 1 },
    { ...h.sender, url: "https://other.example/" },
    { ...h.sender, tab: undefined },
  ]) {
    assert.equal((await h.request(message, sender)).ok, false);
  }
  for (const id of [previous, "unknown"]) {
    assert.equal((await h.request({ ...message, sessionId: id })).ok, false);
  }
  assert.deepEqual(h.local.readerCardPosition, { x: 0.2, y: 0.8 });
});

test("reader and popup routes reject foreign extensions, frames and unknown sessions", async (t) => {
  const h = await harness(t);
  const sessionId = await h.start();
  for (const sender of [
    { ...h.sender, id: "foreign" },
    { ...h.sender, frameId: 1 },
    { ...h.sender, url: "https://other.example/" },
  ]) {
    assert.equal(
      (await h.request({ type: "manga:capture", sessionId, viewport }, sender)).ok,
      false,
    );
  }
  assert.equal(
    (await h.request({ type: "manga:popup-save-key", apiKey: "bad-test-key" })).ok,
    false,
  );
  assert.equal(
    (await h.request({ type: "manga:capture", sessionId: "unknown", viewport })).ok,
    false,
  );
  assert.equal(h.calls.captures.length, 0);
});

test("shortcut validation preserves the previous binding and supports disable/reset", async (t) => {
  const h = await harness(t);
  assert.equal((await h.popup("shortcut", { action: "set", shortcut: "bad" })).ok, false);
  assert.equal((await h.popup("config")).config.shortcut, "Alt+Q");
  assert.equal((await h.popup("shortcut", { action: "disable" })).shortcut, "");
  assert.equal((await h.popup("shortcut", { action: "reset" })).shortcut, "Alt+Q");
});

test("catalog refresh and unavailable-model errors never silently replace the selected model", async (t) => {
  const h = await harness(t, { catalogFailure: true });
  const catalog = await h.popup("models", { force: true });
  assert.equal(catalog.catalog.source, "cached");
  assert.match(catalog.catalog.warning, /stale/);
  assert.equal((await h.popup("save-model", { model: "vendor/unavailable" })).ok, false);
  assert.equal(h.local.selectedModel, "test/cheap");
  assert.equal(h.calls.provider.length, 0);
});

test("catalog errors distinguish missing permission from a failed connection", async (t) => {
  const h = await harness(t, {
    access: false,
    catalogFailure: true,
    stored: { mangaModelCatalog: undefined },
  });
  const denied = await h.popup("models");
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "setup-access");
  assert.match(denied.error, /allow access to OpenRouter/i);
  assert.equal(h.calls.catalog.length, 0);

  h.setAccess(true);
  const unavailable = await h.popup("models");
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.error, /Could not load the model list.*Check your connection/);
  assert.doesNotMatch(unavailable.error, /allow.*access/i);
  assert.equal(h.calls.catalog.length, 1);
});

test("the default catalog fetch keeps its browser receiver and caches the public response", async (t) => {
  const h = await harness(t, { stored: { mangaModelCatalog: undefined } });
  const requests = [];
  t.mock.method(globalThis, "fetch", async function (url, request) {
    if (this !== globalThis)
      throw new TypeError(
        "Window.fetch called on an object that does not implement interface Window.",
      );
    requests.push({ url, request });
    return {
      ok: true,
      async json() {
        return {
          data: [
            {
              id: "test/cheap",
              architecture: { input_modalities: ["image"], output_modalities: ["text"] },
              supported_parameters: ["structured_outputs"],
            },
          ],
        };
      },
    };
  });
  const preferences = new settings.SettingsService(h.extension, provider);
  const live = await preferences.models();
  assert.equal(live.source, "live");
  assert.equal(live.models[0].id, "test/cheap");
  assert.deepEqual(h.local.mangaModelCatalog, live);
  assert.equal((await preferences.models()).source, "cached");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, provider.API + "/models");
  assert.equal(requests[0].request.credentials, "omit");
  assert.equal(new Headers(requests[0].request.headers).has("Authorization"), false);
});

test("catalog failures identify their boundary without exposing response bodies or keys", async (t) => {
  const secret = "private-response-content";
  const timeout = Object.assign(new Error(secret), { name: "TimeoutError" });
  const malformed = new SyntaxError(secret);
  const quota = Object.assign(new Error(secret), { name: "QuotaExceededError" });
  const storageFailure = new Error(secret);
  const valid = {
    data: [
      {
        id: "test/cheap",
        architecture: { input_modalities: ["image"], output_modalities: ["text"] },
        supported_parameters: ["structured_outputs"],
      },
    ],
  };
  const cases = [
    { name: "request timeout", requestError: timeout, cause: timeout, message: /took too long/ },
    { name: "HTTP failure", status: 503, message: /HTTP 503/ },
    {
      name: "invalid JSON",
      bodyError: malformed,
      cause: malformed,
      message: /unreadable model list/,
    },
    {
      name: "invalid response shape",
      body: { error: secret },
      message: /unreadable model catalog/,
    },
    { name: "no compatible models", body: { data: [] }, message: /no compatible image models/ },
    { name: "body timeout", bodyError: timeout, cause: timeout, message: /took too long/ },
    {
      name: "cache quota",
      saveError: quota,
      cause: quota,
      message: /Free some browser storage/,
    },
    {
      name: "cache write",
      saveError: storageFailure,
      cause: storageFailure,
      message: /could not save the model list on this device/,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const local = { openRouterApiKey: secret };
      const extension = {
        storage: { local: storageArea(local) },
        permissions: { contains: async () => true },
      };
      if (scenario.saveError)
        extension.storage.local.set = async () => {
          throw scenario.saveError;
        };
      const preferences = new settings.SettingsService(extension, provider, async () => {
        if (scenario.requestError) throw scenario.requestError;
        return {
          ok: !scenario.status,
          status: scenario.status,
          async json() {
            assert.equal(scenario.status, undefined, "HTTP errors must not read a response body");
            if (scenario.bodyError) throw scenario.bodyError;
            return scenario.body || valid;
          },
        };
      });
      await assert.rejects(preferences.models(), (error) => {
        assert.match(error.message, scenario.message);
        assert.equal(error.message.includes(secret), false);
        assert.equal(error.code, "catalog");
        if (scenario.cause) assert.equal(error.cause, scenario.cause);
        return true;
      });
      assert.equal(preferences.catalogRequest, null);
      assert.equal(local.mangaModelCatalog, undefined);
      assert.equal(local.openRouterApiKey, secret);
    });
  }
});

test("capture is active-tab only and throttles repeated visual checks", async (t) => {
  const h = await harness(t);
  const sessionId = await h.start();
  for (let index = 0; index < 3; index++) {
    assert.equal((await h.request({ type: "manga:verify-capture", sessionId, viewport })).ok, true);
  }
  const throttled = await h.request({ type: "manga:verify-capture", sessionId, viewport });
  assert.equal(throttled.code, "capture-throttled");
  assert.ok(throttled.retryAfterMs >= 1000);
  h.setActive({ ...h.sender.tab, id: 999 });
  assert.equal((await h.request({ type: "manga:capture", sessionId, viewport })).ok, false);
});

test("dismissal leaves work running and a retained reader port reports its eventual completion", async (t) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const h = await harness(t, {
    complete: async (job) => {
      await pending;
      return result(job);
    },
  });
  const sessionId = await h.start();
  const messages = [];
  let receive;
  const port = {
    name: "manga:reader",
    sender: h.sender,
    postMessage(message) {
      messages.push(message);
    },
    disconnect() {},
    onMessage: {
      addListener(fn) {
        receive = fn;
      },
    },
    onDisconnect: { addListener() {} },
  };
  h.listeners.connect(port);
  receive({ type: "bind", sessionId });
  await new Promise((resolve) => setImmediate(resolve));
  await h.request({ type: "manga:capture", sessionId, viewport });
  const submit = await h.request({
    type: "manga:analyze",
    sessionId,
    viewport,
    rect,
    imageDataUrl: PNG,
  });
  await h.request({ type: "manga:cancel", sessionId });
  receive({ type: "heartbeat", sessionId });
  assert.equal(messages.at(-1).active, 1);

  release();
  await settle(h.app.jobs);
  assert.equal(messages.at(-1).active, 0);
  assert.equal(
    (await h.request({ type: "manga:poll", sessionId, jobId: submit.jobId })).job.status,
    "completed",
  );
  assert.equal(h.calls.provider.length, 1);
});

test("model comparisons use the owned saved crop without a screenshot or current-page position", async (t) => {
  const h = await harness(t);
  const firstSession = await h.start();
  const savedPage = await h.request({
    type: "manga:page-save",
    sessionId: firstSession,
    page: { imageDataUrl: PNG, viewport, descriptor: { version: 1 } },
  });
  assert.equal(savedPage.ok, true, savedPage.error);
  const original = await translate(h, firstSession, {
    context: "Original context",
    pageId: savedPage.pageId,
  });
  const sessionId = firstSession;
  const compare = await h.request({
    type: "manga:analyze",
    sessionId,
    sourceRunId: original.result.run_id,
    model: "test/another",
    imageDataUrl: "untrusted replacement",
    context: "untrusted context",
    pageId: "unrelated-history-page",
    rect: { x: 900, y: 600, width: 100, height: 100 },
  });
  assert.equal(compare.ok, true, compare.error);
  await settle(h.app.jobs);

  assert.equal(h.calls.captures.length, 1);
  assert.equal(h.calls.provider[1].input.imageDataUrl, PNG);
  assert.equal(h.calls.provider[1].input.context, "Original context");
  assert.deepEqual(h.calls.provider[1].associations, h.calls.provider[0].associations);
  const saved = await h.app.store.page(savedPage.pageId);
  assert.deepEqual(
    new Set(saved.regions.map((region) => region.model)),
    new Set(["test/cheap", "test/another"]),
  );
  assert.ok(saved.regions.every((region) => JSON.stringify(region.rect) === JSON.stringify(rect)));
  assert.equal(
    (
      await h.request({
        type: "manga:analyze",
        sessionId,
        sourceRunId: "foreign-run",
        model: "test/another",
      })
    ).ok,
    false,
  );
});

test("document scope includes hashed book identity and does not disclose private query tokens", async (t) => {
  const h = await harness(t);
  const a = await h.app.reader.scope("https://reader.example/read?book=a&token=private");
  const b = await h.app.reader.scope("https://reader.example/read?book=b&token=private");
  assert.notEqual(a, b);
  assert.equal(a.includes("private"), false);
  assert.match(a, /^https:\/\/reader.example\/read#scope=/);
});

test("saved page metadata preserves recognition boundaries and rejects a different document", async (t) => {
  const h = await harness(t);
  const sessionId = await h.start();
  const surface = { x: 20, y: 10, width: 500, height: 700, kind: "canvas", complete: true };
  const saved = await h.request({
    type: "manga:page-save",
    sessionId,
    page: {
      imageDataUrl: PNG,
      viewport,
      surface,
      descriptor: { version: 1, width: 500, height: 700, thumbnail: [12, 34], texture: 8 },
    },
  });
  assert.equal(saved.ok, true, saved.error);

  const list = await h.request({ type: "manga:page-list", sessionId });
  assert.deepEqual(list.pages[0].surface, surface);
  assert.equal(list.pages[0].imageDataUrl, undefined);
  const reopened = await h.request({ type: "manga:page-get", sessionId, pageId: saved.pageId });
  assert.deepEqual(reopened.page.surface, surface);
  assert.equal(reopened.page.imageDataUrl, PNG);
  await assert.rejects(
    h.app.pages.get("https://different.example/book", saved.pageId),
    /another reading document/,
  );
});

test("a pruned page reference reports unavailable placement instead of an expired page id", async (t) => {
  const h = await harness(t);
  const sessionId = await h.start();
  const prune = h.app.store.prune.bind(h.app.store);
  h.app.store.prune = () => prune(true);

  const saved = await h.request({
    type: "manga:page-save",
    sessionId,
    page: { imageDataUrl: PNG, viewport, descriptor: { version: 1 } },
  });
  assert.equal(saved.ok, false);
  assert.equal(saved.pageId, undefined);
  assert.match(saved.error, /translate without saved page placement/);

  h.app.store.prune = prune;
  const translated = await translate(h, sessionId);
  assert.ok(translated.result.run_id);
  assert.equal(h.calls.provider.length, 1);
});
