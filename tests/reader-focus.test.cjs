"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { harness, run, settle } = require("./reader-harness.cjs");

function fixture({ scrollOnBlur = false, scrollOnCardFocus = false, respond } = {}) {
  const env = harness((message) => {
    const response = respond?.(message);
    if (response !== undefined) return response;
    if (message.type === "manga:library")
      return {
        ok: true,
        entries: [{ id: "saved-run", status: "completed", japanese: "Saved text" }],
      };
    if (message.type === "manga:history")
      return { ok: true, history: { result: run(), imageDataUrl: "fixture:page" } };
    if (message.type === "manga:restart") {
      overlay.start({ sessionId: "next-session", model: "newly-saved/model" });
      return { ok: true };
    }
  });
  const pageControl = env.doc.activeElement;
  const scroller = env.doc.createElement("div");
  env.doc.body = env.doc.createElement("body");
  env.doc.documentElement.append(env.doc.body);
  env.doc.body.append(scroller);
  scroller.append(pageControl);
  scroller.scrollTop = 840;
  const events = { pageFocus: 0, pageBlur: 0, cardFocus: 0 };
  const focusCalls = [];
  const blurCalls = [];
  env.doc.addEventListener("focusin", (event) => {
    if (event.target.className?.split(" ").includes("card")) {
      events.cardFocus++;
      if (scrollOnCardFocus) scroller.scrollTop = 0;
    }
  });
  const createElement = env.doc.createElement;
  env.doc.createElement = (tag) => {
    const element = createElement(tag);
    element.focus = (options) => {
      focusCalls.push({ element, options });
      if (env.doc.activeElement === element) return;
      env.doc.activeElement?.blur?.();
      env.doc.activeElement = element;
      // preventScroll does not suppress page-observable focus events.
      env.doc.dispatch("focusin", { target: element });
    };
    element.blur = () => {
      blurCalls.push(element);
      if (env.doc.activeElement === element) env.doc.activeElement = env.doc.body;
    };
    return element;
  };
  pageControl.focus = () => {
    focusCalls.push({ element: pageControl });
    if (env.doc.activeElement === pageControl) return;
    env.doc.activeElement = pageControl;
    // A reader's own focus handler can move a nested scrolling container.
    events.pageFocus++;
    scroller.scrollTop = 0;
  };
  pageControl.blur = () => {
    blurCalls.push(pageControl);
    if (env.doc.activeElement !== pageControl) return;
    events.pageBlur++;
    env.doc.activeElement = env.doc.body;
    if (scrollOnBlur) scroller.scrollTop = 0;
  };
  const listeners = [];
  const runtime = {
    ...env.overlay.runtime,
    connect(options) {
      const port = env.overlay.runtime.connect(options);
      // A new session's idle status must not mark older sessions' work idle.
      port.postMessage = (message) => {
        if (message.type === "bind")
          Promise.resolve().then(() =>
            port.onMessage.emit({ type: "manga:work-status", active: 0 }),
          );
      };
      return port;
    },
    onMessage: { addListener: (listener) => listeners.push(listener) },
  };
  const context = vm.createContext({
    window: env.win,
    browser: { runtime },
    MangaVision: require("../src/reader/vision.js"),
    ReaderView: require("../src/reader/reader-view.js"),
    PageTracker: require("../src/reader/page-tracker.js"),
  });
  vm.runInContext(fs.readFileSync(require.resolve("../src/reader/content.js"), "utf8"), context);
  const overlay = context.__mangaSelectionOverlay;
  return {
    ...env,
    overlay,
    scroller,
    pageControl,
    events,
    focusCalls,
    blurCalls,
    send: (message) => listeners[0](message),
    start() {
      listeners[0]({ type: "manga:start", sessionId: "focus-session" });
      const host = overlay.ui.host;
      const remove = host.remove.bind(host);
      host.remove = () => {
        remove();
        // Removing a focused tree makes the document body the active element.
        if (!env.doc.activeElement?.isConnected) env.doc.activeElement = env.doc.body;
      };
    },
  };
}

for (const state of ["selection", "answer"])
  test(`opening the in-page library from ${state} and returning to a saved card preserves scroll without focus or blur`, async () => {
    const env = fixture();
    env.start();
    if (state === "answer") env.overlay.ui.showSelectionCard();
    const host = env.overlay.ui.host;
    const focusCount = env.focusCalls.length,
      blurCount = env.blurCalls.length;
    if (state === "selection") {
      const acknowledgement = await env.send({
        type: "manga:shortcut",
        sessionId: "focus-session",
      });
      assert.equal(acknowledgement.ok, true);
      assert.equal(acknowledgement.sessionId, "focus-session");
      assert.equal(acknowledgement.mounted, true);
    } else await env.overlay.openLibrary();
    await settle();
    assert.equal(env.overlay.ui.host, host);
    assert.equal(env.overlay.ui.card.attributes["aria-label"], "Saved translations");
    await env.overlay.openHistory("saved-run");
    assert.equal(env.overlay.ui.card.attributes["aria-label"], "Translation");
    env.doc.dispatch("keydown", { key: "Escape" });
    assert.equal(env.focusCalls.length, focusCount);
    assert.equal(env.blurCalls.length, blurCount);
    assert.equal(env.scroller.scrollTop, 840);
    assert.equal(env.events.pageFocus, 0);
    assert.equal(env.overlay.ui.host, null);
    assert.deepEqual(
      env.calls.map((message) => message.type),
      ["manga:library", "manga:history", "manga:cancel"],
    );
  });

test("ordinary card dismissal restores focus once, while a stale library command leaves the current reader alone", async () => {
  const env = fixture();
  env.start();
  env.overlay.ui.showSelectionCard();
  const card = env.overlay.ui.card;
  const stale = await env.send({ type: "manga:shortcut", sessionId: "older-session" });
  assert.equal(stale.ok, false);
  assert.equal(env.overlay.ui.card, card);
  assert.equal(env.doc.activeElement, card);
  assert.equal(env.events.cardFocus, 1);
  assert.deepEqual(env.focusCalls[0].options, { preventScroll: true });
  assert.equal(env.events.pageFocus, 0);
  env.doc.dispatch("keydown", { key: "Escape" });
  assert.equal(env.doc.activeElement, env.pageControl);
  assert.equal(env.events.pageFocus, 1);
  assert.equal(env.overlay.previousFocus, null);
  env.doc.body.focus();
  env.overlay.close();
  assert.equal(env.doc.activeElement, env.doc.body);
  assert.equal(env.events.pageFocus, 1);
});

for (const state of ["answer", "pending", "library", "library-loading", "history-opening"])
  test(`the shortcut from ${state} starts selection instead of reloading saved translations`, async () => {
    let release;
    const deferred = new Promise((resolve) => (release = resolve));
    const env = fixture({
      respond(message) {
        if (
          (state === "pending" && message.type === "manga:poll") ||
          (state === "library-loading" && message.type === "manga:library") ||
          (state === "history-opening" && message.type === "manga:history")
        )
          return deferred;
      },
    });
    env.start();
    await settle();
    let outstanding;
    if (state === "answer") {
      env.overlay.ui.showSelectionCard();
      env.overlay.showHistory({ result: run(), imageDataUrl: "fixture:page" });
    } else if (state === "pending") {
      env.overlay.ui.showSelectionCard();
      env.overlay.selection.translationJob = "pending-job";
      env.portStatus(1);
      outstanding = env.overlay.poll(
        "pending-job",
        env.overlay.generation,
        () => assert.fail("Old completion must not replace the new selection"),
        () => assert.fail("Old failure must not replace the new selection"),
      );
    } else {
      await env.send({ type: "manga:shortcut", sessionId: "focus-session" });
      await settle();
      if (state === "history-opening") outstanding = env.overlay.openHistory("saved-run");
    }
    const libraryReads = env.calls.filter((message) => message.type === "manga:library").length;
    const oldPort = env.overlay.ports.get("focus-session");
    const reply = await env.send({ type: "manga:shortcut", sessionId: "focus-session" });
    assert.equal(reply.ok, true);
    assert.equal(reply.mounted, true);
    assert.equal(reply.sessionId, "next-session");
    assert.equal(env.overlay.model, "newly-saved/model");
    assert.equal(env.overlay.ui.shield.isConnected, true);
    assert.equal(env.overlay.ui.card, null);
    assert.equal(env.calls.filter((message) => message.type === "manga:restart").length, 1);
    assert.equal(
      env.calls.filter((message) => message.type === "manga:library").length,
      libraryReads,
    );
    assert.equal(
      env.calls.some((message) => /capture|analyze|retry/.test(message.type)),
      false,
    );
    if (state === "pending") assert.notEqual(oldPort.closed, true);
    release({
      ok: true,
      entries: [],
      history: { result: run(), imageDataUrl: "fixture:page" },
      job: { status: "completed", result: run() },
    });
    await outstanding;
    await settle();
    assert.equal(env.overlay.ui.shield.isConnected, true);
    assert.equal(env.overlay.ui.card, null);
    env.overlay.close();
  });

test("replacing a live card preserves the original focus target without focusing the reading page between cards", () => {
  const env = fixture();
  env.start();
  env.overlay.ui.showSelectionCard();
  const firstCard = env.overlay.ui.card;
  env.start();
  env.overlay.ui.showSelectionCard();
  assert.equal(firstCard.isConnected, false);
  assert.notEqual(env.overlay.ui.card, firstCard);
  assert.equal(env.doc.activeElement, env.overlay.ui.card);
  assert.equal(env.scroller.scrollTop, 840);
  assert.equal(env.events.cardFocus, 2);
  assert.equal(env.events.pageFocus, 0);
  env.doc.dispatch("keydown", { key: "Escape" });
  assert.equal(env.doc.activeElement, env.pageControl);
  assert.equal(env.events.pageFocus, 1);
});

for (const cause of ["page control blur", "new card focus"])
  test(`saved translation mount, replacement and Escape preserve nested scroll with a ${cause} handler`, async () => {
    const env = fixture({
      scrollOnBlur: cause === "page control blur",
      scrollOnCardFocus: cause === "new card focus",
    });
    env.start();
    await env.send({ type: "manga:shortcut", sessionId: "focus-session" });
    await settle();
    await env.overlay.openHistory("saved-run");
    assert.equal(env.scroller.scrollTop, 840, `mount must not trigger the ${cause} handler`);
    assert.equal(env.doc.activeElement, env.pageControl);
    const firstCard = env.overlay.ui.card;
    await env.overlay.openLibrary();
    await settle();
    await env.overlay.openHistory("saved-run");
    assert.equal(firstCard.isConnected, false);
    assert.notEqual(env.overlay.ui.card, firstCard);
    assert.equal(env.scroller.scrollTop, 840, `replacement must not trigger the ${cause} handler`);
    assert.equal(env.doc.activeElement, env.pageControl);
    env.doc.dispatch("keydown", { key: "Escape" });
    assert.equal(env.overlay.ui.host, null);
    assert.equal(env.scroller.scrollTop, 840, `Escape must not trigger the ${cause} handler`);
    assert.equal(env.doc.activeElement, env.pageControl);
    assert.deepEqual(env.focusCalls, []);
    assert.deepEqual(env.blurCalls, []);
    assert.deepEqual(env.events, { pageFocus: 0, pageBlur: 0, cardFocus: 0 });
    assert.equal(
      env.calls.some((message) => /capture|analyze|study/.test(message.type)),
      false,
    );
  });
