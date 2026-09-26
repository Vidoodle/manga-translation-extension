"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ReaderService } = require("../src/background/reader-session.js");

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function fixture() {
  const tab = { id: 1, windowId: 1, url: "https://reader.example/book" };
  const calls = { injections: [], messages: [] };
  const extension = {
    storage: { session: { get: async () => ({}), set: async () => {} } },
    tabs: {
      query: async () => [tab],
      get: async () => tab,
      sendMessage: async (tabId, message) => {
        calls.messages.push(message);
        return { ok: true, sessionId: message.sessionId, mounted: true };
      },
    },
    scripting: {
      executeScript: async (request) => {
        calls.injections.push(request);
      },
    },
  };
  const settings = {
    config: async () => ({ key_configured: true, model: "test/model", shortcut: "Alt+Q" }),
    setup: async () => null,
    cardPosition: async () => ({ x: 1, y: 1 }),
  };
  const reader = new ReaderService({
    extension,
    settings,
    jobs: { active: new Set() },
    digest: async () => "scope",
    loadStyles: async () => "",
  });
  await reader.ready;
  return { tab, calls, extension, settings, reader };
}

test("a slower first injection cannot activate over the newer reading session", async () => {
  const h = await fixture();
  const injected = deferred(),
    release = deferred();
  h.extension.scripting.executeScript = async () => {
    h.calls.injections.push(true);
    if (h.calls.injections.length === 1) {
      injected.resolve();
      await release.promise;
    }
  };
  const first = h.reader.start(h.tab);
  await injected.promise;
  await h.reader.start(h.tab);
  const latest = h.reader.current.get(h.tab.id);
  release.resolve();
  await first;
  assert.equal(h.calls.messages.length, 1);
  assert.equal(h.calls.messages[0].sessionId, latest);
  assert.equal(h.reader.sessions.get(latest).closed, false);
});

test("a slower first settings read cannot replace a newer activation", async () => {
  const h = await fixture();
  const reading = deferred(),
    release = deferred();
  const config = h.settings.config;
  let reads = 0;
  h.settings.config = async () => {
    if (++reads === 1) {
      reading.resolve();
      await release.promise;
    }
    return config();
  };
  const first = h.reader.start(h.tab);
  await reading.promise;
  await h.reader.start(h.tab);
  const latest = h.reader.current.get(h.tab.id);
  release.resolve();
  await first;
  assert.equal(h.reader.current.get(h.tab.id), latest);
  assert.equal(h.calls.messages.length, 1);
  assert.equal(h.calls.injections.length, 1);
});

test("navigation during injection cannot deliver a stale reader start", async () => {
  const h = await fixture();
  const injected = deferred(),
    release = deferred();
  h.extension.scripting.executeScript = async () => {
    injected.resolve();
    await release.promise;
  };
  const start = h.reader.start(h.tab);
  await injected.promise;
  await h.reader.invalidate(h.tab.id);
  release.resolve();
  await start;
  assert.equal(h.calls.messages.length, 0);
  assert.equal(h.reader.current.has(h.tab.id), false);
});

test("an older activation response cannot fail or replace a newer mounted reader", async () => {
  for (const rejected of [false, true]) {
    const h = await fixture();
    const delivered = deferred(),
      reply = deferred();
    h.extension.tabs.sendMessage = async (tabId, message) => {
      h.calls.messages.push(message);
      if (h.calls.messages.length === 1) {
        delivered.resolve();
        return reply.promise;
      }
      return { ok: true, sessionId: message.sessionId, mounted: true };
    };
    const first = h.reader.start(h.tab);
    await delivered.promise;
    assert.deepEqual(await h.reader.start(h.tab), { ok: true });
    const latest = h.reader.current.get(h.tab.id);
    if (rejected) reply.reject(new Error("The older reader disconnected."));
    else reply.resolve(undefined);
    assert.deepEqual(await first, { ok: true });
    assert.equal(h.reader.current.get(h.tab.id), latest);
    assert.equal(h.reader.sessions.get(latest).closed, false);
    assert.equal(h.calls.messages.length, 2);
    assert.equal(h.calls.injections.length, 2);
  }
});

test("a shortcut can acknowledge the new session created by restarting the reader", async () => {
  const h = await fixture();
  await h.reader.start(h.tab);
  const delivered = deferred(),
    reply = deferred();
  const send = h.extension.tabs.sendMessage;
  h.extension.tabs.sendMessage = async (tabId, message) => {
    if (message.type !== "manga:shortcut") return send(tabId, message);
    delivered.resolve();
    return reply.promise;
  };
  const opening = h.reader.handleShortcut(h.tab);
  await delivered.promise;
  await h.reader.start(h.tab);
  const latest = h.reader.current.get(h.tab.id);
  reply.resolve({ ok: true, sessionId: latest, mounted: true });
  assert.equal(await opening, true);
  assert.equal(h.reader.current.get(h.tab.id), latest);
  assert.equal(h.reader.sessions.get(latest).closed, false);
});
