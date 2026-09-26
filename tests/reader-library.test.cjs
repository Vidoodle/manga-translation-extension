"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, settle, run } = require("./reader-harness.cjs");

const entry = (extra = {}) => ({
  id: "saved-a",
  japanese: "日本語 <script>not markup</script>",
  createdAt: Date.UTC(2026, 8, 25, 12),
  status: "completed",
  model: "google/gemini-3-flash-preview",
  cost_usd: 0.00045,
  ...extra,
});
const row = (env) =>
  env.overlay.ui.body
    .querySelectorAll("button")
    .find((button) => button.className === "library-entry");
const bookmark = (env) =>
  env.overlay.ui.cardHeader
    .querySelectorAll("button")
    .find((button) => button.attributes["aria-label"] === "Saved translations");
const history = () => ({ result: run(), imageDataUrl: "fixture:page" });

test("the bookmark opens a safe in-page library and a saved translation in the same host and session", async () => {
  const env = harness((message) => {
    if (message.type === "manga:library") return { ok: true, entries: [entry()] };
    if (message.type === "manga:history") return { ok: true, history: history() };
  });
  env.start({ history: history() });
  const host = env.overlay.ui.host,
    session = env.overlay.session,
    pageFocus = env.doc.activeElement;
  pageFocus.focus = pageFocus.blur = () => {
    throw new Error("Unexpected page focus change");
  };
  bookmark(env).dispatch("click", { isTrusted: false });
  assert.deepEqual(env.calls, []);
  assert.equal(
    bookmark(env).dispatch("pointerdown", { button: 0, isPrimary: true }).defaultPrevented,
    true,
  );
  bookmark(env).dispatch("click");
  assert.match(env.text(env.overlay.ui.body), /Loading saved translations/);
  await settle();
  assert.equal(env.overlay.ui.card.attributes["aria-label"], "Saved translations");
  assert.match(env.text(env.overlay.ui.body), /日本語 <script>not markup<\/script>/);
  assert.match(env.text(env.overlay.ui.body), /Saved.*Gemini 3 Flash \(Preview\).*0\.00045/);
  assert.equal(env.overlay.ui.body.querySelectorAll("script").length, 0);
  assert.equal(env.overlay.ui.host, host);
  assert.equal(
    row(env).dispatch("pointerdown", { button: 0, isPrimary: true }).defaultPrevented,
    true,
  );
  row(env).dispatch("click");
  await settle();
  assert.equal(env.overlay.ui.host, host);
  assert.equal(env.overlay.session, session);
  assert.equal(env.doc.activeElement, pageFocus);
  assert.equal(env.overlay.ui.card.attributes["aria-label"], "Translation");
  assert.match(env.text(env.overlay.ui.body), /Natural 1/);
  assert.equal(env.overlay.ui.body.querySelector("img").src, "fixture:page");
  assert.deepEqual(
    env.calls.map((message) => message.type),
    ["manga:library", "manga:history"],
  );
  env.doc.dispatch("keydown", { key: "Escape" });
  assert.equal(env.overlay.ui.host, null);
  assert.equal(env.doc.activeElement, pageFocus);
});

test("reader buttons suppress only trusted primary pointer focus and retain keyboard activation", () => {
  const env = harness();
  env.start({ history: history() });
  let actions = 0;
  const button = env.overlay.ui.button("Action", () => {
    actions++;
  });
  env.overlay.ui.body.append(button);
  const pageFocus = env.doc.activeElement;
  const down = button.dispatch("pointerdown", { button: 0, isPrimary: true });
  assert.equal(down.defaultPrevented, true);
  assert.equal(env.doc.activeElement, pageFocus);
  assert.equal(actions, 0);
  for (const event of [
    { button: 0, isTrusted: false },
    { button: 0, isPrimary: false },
    { button: 1 },
    { button: 2 },
  ])
    assert.notEqual(button.dispatch("pointerdown", event).defaultPrevented, true);
  button.focus();
  assert.equal(env.doc.activeElement, button, "keyboard focus remains available");
  button.dispatch("click", { detail: 0 });
  assert.equal(actions, 1, "a keyboard-generated click does not require pointerdown");
  button.dispatch("click", { isTrusted: false });
  assert.equal(actions, 1);
  env.overlay.close();
});

test("library loading and entry opening reject duplicate actions without starting paid work", async () => {
  let load, open;
  const loading = new Promise((resolve) => {
    load = resolve;
  });
  const opening = new Promise((resolve) => {
    open = resolve;
  });
  const env = harness((message) => {
    if (message.type === "manga:library") return loading;
    if (message.type === "manga:history") return opening;
  });
  env.start();
  void env.overlay.openLibrary();
  void env.overlay.openLibrary();
  assert.equal(env.calls.length, 1);
  load({ ok: true, entries: [entry()] });
  await settle();
  void env.overlay.openHistory("saved-a");
  void env.overlay.openHistory("saved-a");
  assert.equal(row(env).disabled, true);
  assert.match(env.text(env.overlay.ui.body), /Opening saved translation/);
  open({ ok: true, history: history() });
  await settle();
  assert.deepEqual(
    env.calls.map((message) => message.type),
    ["manga:library", "manga:history"],
  );
  env.overlay.close();
});

test("library failure can be retried and the empty state offers no paid action", async () => {
  let loads = 0;
  const env = harness((message) =>
    message.type === "manga:library"
      ? ++loads === 1
        ? { ok: false, error: "Saved data unavailable" }
        : { ok: true, entries: [] }
      : undefined,
  );
  env.start();
  await env.overlay.openLibrary();
  assert.match(env.text(env.overlay.ui.body), /Saved data unavailable/);
  env.overlay.ui.body.querySelector("button").dispatch("click");
  await settle();
  assert.match(env.text(env.overlay.ui.body), /No saved translations yet/);
  assert.equal(env.overlay.ui.body.querySelector("button"), undefined);
  assert.deepEqual(
    env.calls.map((message) => message.type),
    ["manga:library", "manga:library"],
  );
  env.doc.dispatch("keydown", { key: "Escape" });
  env.start({ sessionId: "next-selection" });
  assert.ok(env.overlay.ui.shield);
  env.overlay.close();
});

test("an unavailable entry leaves the library usable for another explicit attempt", async () => {
  const env = harness((message) => {
    if (message.type === "manga:library") return { ok: true, entries: [entry()] };
    if (message.type === "manga:history")
      return { ok: false, error: "That translation was removed." };
  });
  env.start();
  await env.overlay.openLibrary();
  await env.overlay.openHistory("saved-a");
  assert.match(env.text(env.overlay.ui.body), /That translation was removed/);
  assert.equal(row(env).disabled, false);
  assert.equal(env.overlay.ui.card.attributes["aria-label"], "Saved translations");
  env.overlay.close();
});

for (const delayed of ["library", "history"])
  test(`a late ${delayed} response cannot replace a newer selection session`, async () => {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const env = harness((message) => {
      if (message.type === `manga:${delayed}`) return pending;
      if (message.type === "manga:library") return { ok: true, entries: [entry()] };
    });
    env.start();
    if (delayed === "library") void env.overlay.openLibrary();
    else {
      await env.overlay.openLibrary();
      void env.overlay.openHistory("saved-a");
    }
    env.start({ sessionId: "new-session" });
    const host = env.overlay.ui.host;
    release(
      delayed === "library" ? { ok: true, entries: [entry()] } : { ok: true, history: history() },
    );
    await settle();
    assert.equal(env.overlay.ui.host, host);
    assert.ok(env.overlay.ui.shield);
    assert.equal(env.overlay.ui.card, null);
    env.overlay.close();
  });

test("opening the library preserves a running request and its completion cannot overwrite the list", async () => {
  let complete;
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  const env = harness((message) => {
    if (message.type === "manga:poll") return pending;
    if (message.type === "manga:library")
      return { ok: true, entries: [entry({ status: "running" })] };
  });
  env.start();
  env.select();
  await settle();
  const port = env.ports[0],
    session = env.overlay.session,
    host = env.overlay.ui.host;
  await env.overlay.openLibrary();
  complete({ ok: true, job: { status: "completed", result: run() } });
  await settle();
  assert.equal(env.overlay.ui.host, host);
  assert.equal(env.overlay.session, session);
  assert.notEqual(port.closed, true);
  assert.equal(env.overlay.ui.card.attributes["aria-label"], "Saved translations");
  assert.doesNotMatch(env.text(env.overlay.ui.body), /Natural 1/);
  assert.equal(env.calls.filter((message) => message.type === "manga:analyze").length, 1);
  assert.equal(env.calls.filter((message) => message.type === "manga:capture").length, 1);
  env.overlay.close();
});

test("a running library entry polls its existing job without a capture or new submission", async () => {
  const env = harness((message) => {
    if (message.type === "manga:library")
      return { ok: true, entries: [entry({ status: "running" })] };
    if (message.type === "manga:history")
      return {
        ok: true,
        history: {
          imageDataUrl: "fixture:page",
          job: { job_id: "translation-job", status: "running" },
        },
      };
  });
  env.start();
  await env.overlay.openLibrary();
  await env.overlay.openHistory("saved-a");
  await settle();
  assert.match(env.text(env.overlay.ui.body), /Natural 1/);
  assert.deepEqual(
    env.calls.map((message) => message.type),
    ["manga:library", "manga:history", "manga:poll"],
  );
  assert.equal(env.calls[2].jobId, "translation-job");
  env.overlay.close();
});

test("repeated library and answer navigation releases replaced card listeners", async () => {
  const env = harness((message) => {
    if (message.type === "manga:library") return { ok: true, entries: [entry()] };
    if (message.type === "manga:history") return { ok: true, history: history() };
  });
  env.start({ history: history() });
  const sessionListeners = env.overlay.cleanups.length;
  const listenerCount = (node) =>
    [...node.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  const removed = [];
  for (let i = 0; i < 20; i++) {
    removed.push(env.overlay.ui.card, env.overlay.ui.cardHeader);
    await env.overlay.openLibrary();
    removed.push(env.overlay.ui.card, env.overlay.ui.cardHeader);
    await env.overlay.openHistory("saved-a");
    assert.equal(env.overlay.cleanups.length, sessionListeners);
    assert.ok(removed.every((node) => !node.isConnected));
    assert.ok(removed.every((node) => listenerCount(node) === 0));
  }
  const card = env.overlay.ui.card,
    header = env.overlay.ui.cardHeader;
  assert.ok(listenerCount(card) > 0);
  assert.ok(listenerCount(header) > 0);
  env.overlay.close();
  assert.equal(env.overlay.cleanups.length, 0);
  assert.equal(listenerCount(card), 0);
  assert.equal(listenerCount(header), 0);
});

test("a library-only activation opens saved translations without completed setup", async () => {
  const env = harness((message) =>
    message.type === "manga:library" ? { ok: true, entries: [entry()] } : undefined,
  );
  env.start({
    library: true,
    setupRequired: true,
    setupWarning: "Add your key before translating.",
  });
  assert.equal(env.overlay.ui.card.attributes["aria-label"], "Saved translations");
  assert.equal(env.overlay.ui.shield, null);
  await settle();
  assert.ok(row(env));
  assert.deepEqual(
    env.calls.map((message) => message.type),
    ["manga:library"],
  );
  env.overlay.close();
});
