"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRect, pixelCrop, placeCard } = require("../src/reader/vision.js");
const { harness, settle, run, study } = require("./reader-harness.cjs");
const wordButton = (env) =>
  env.overlay.ui.body.querySelectorAll("button").find((button) => button.className === "jp-word");

test("reverse drags clip and screenshots map by actual dimensions", () => {
  assert.deepEqual(
    normalizeRect({ x: 500, y: 400 }, { x: -20, y: -1 }, { width: 1000, height: 800 }),
    { x: 0, y: 0, width: 500, height: 400 },
  );
  assert.deepEqual(
    pixelCrop(
      { x: 10, y: 20, width: 100, height: 120 },
      { width: 800, height: 600 },
      { width: 1000, height: 1200 },
    ),
    { x: 12, y: 40, width: 126, height: 240 },
  );
  const placed = placeCard({ x: 1, y: 1 }, { width: 320, height: 480 });
  const left = placed.x - (placed.width * placed.translateX) / 100;
  assert.ok(left >= 12 && left + placed.width <= 308);
});

test("one selection request renders safe Japanese, word help and major grammar together", async () => {
  const answer = run();
  answer.analysis.regions[0].grammar = [
    { pattern: "語", explanation: "A suffix meaning language." },
  ];
  const env = harness((message) =>
    message.type === "manga:poll"
      ? { ok: true, job: { status: "completed", result: answer } }
      : undefined,
  );
  env.start();
  await settle();
  assert.equal(env.calls.filter((m) => m.type === "manga:analyze").length, 0);
  env.select();
  await settle();
  assert.equal(env.overlay.ui.shield, null);
  assert.equal(env.calls.filter((m) => m.type === "manga:analyze").length, 1);
  assert.equal(env.calls.filter((m) => m.type === "manga:study").length, 0);
  assert.match(env.text(env.overlay.ui.body), /Natural 1/);
  assert.match(env.text(env.overlay.ui.body), /Grammar.*A suffix meaning language/);
  assert.doesNotMatch(env.text(env.overlay.ui.body), /Explain|separate request/);
  const transcript = env.overlay.ui.body
    .querySelectorAll("p")
    .find((node) => node.className === "japanese");
  assert.equal(
    transcript.children.map((node) => node.textContent).join(""),
    answer.analysis.regions[0].japanese,
  );
  assert.equal(transcript.querySelectorAll("script").length, 0);
  const beforeHover = env.calls.length;
  wordButton(env).dispatch("pointerenter");
  assert.match(env.text(env.overlay.ui.wordHelp.tip), /にほんご.*Japanese language/);
  wordButton(env).dispatch("click");
  await settle();
  assert.equal(env.calls.length, beforeHover);
  assert.match(env.text(env.overlay.ui.body), /0.00045 reported cost/);
  env.overlay.close();
});

test("incomplete setup shows instructions without permitting selection or capture", async () => {
  const env = harness();
  env.start({
    setupRequired: true,
    setupWarning: "Add your OpenRouter API key in the extension, then activate again.",
  });
  await settle();
  assert.equal(env.overlay.ui.shield, null);
  assert.match(env.text(env.overlay.ui.card), /Add your OpenRouter API key/);
  assert.doesNotMatch(env.text(env.overlay.ui.card), /Select another area/);
  env.overlay.beginDrag({ isTrusted: true, button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  await env.overlay.captureSelection();
  await env.overlay.restart();
  assert.equal(env.calls.length, 0);
  env.overlay.close();
});

for (const shortcut of ["Alt+Q", "Ctrl+Shift+Y", ""])
  test(`selection hint reflects the ${shortcut || "disabled"} shortcut`, () => {
    const env = harness();
    env.start({ shortcut });
    assert.equal(
      env.overlay.ui.instruction.textContent,
      `Drag over text to translate · ${shortcut ? `${shortcut} for saved translations · ` : ""}Esc to cancel`,
    );
    assert.deepEqual(env.calls, []);
    env.overlay.close();
  });

test("activation and dragging do no capture, pixel work, or saved-page searches; release captures once", async () => {
  const env = harness();
  let canvases = 0;
  const createElement = env.doc.createElement;
  env.doc.createElement = (tag) => {
    const element = createElement(tag);
    if (tag === "canvas") {
      canvases++;
      const getContext = element.getContext;
      element.getContext = (...args) => {
        const context = getContext.apply(element, args);
        context.getImageData = () => {
          throw new Error("Unexpected full screenshot pixel read");
        };
        return context;
      };
    }
    return element;
  };
  env.start();
  await settle();
  const shield = env.overlay.ui.shield;
  shield.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  for (let x = 110; x <= 300; x += 10) {
    shield.dispatch("pointermove", { pointerId: 1, clientX: x, clientY: 300 });
    env.fire(3000);
    await settle();
  }
  assert.equal(env.overlay.ui.selection.style.width, "200px");
  assert.equal(canvases, 0);
  assert.deepEqual(env.calls, []);
  shield.dispatch("pointerup", { pointerId: 1, clientX: 300, clientY: 300 });
  await settle();
  assert.equal(canvases, 1);
  assert.deepEqual(
    env.calls.map((message) => message.type),
    ["manga:capture", "manga:analyze", "manga:poll"],
  );
  assert.deepEqual(env.calls[1].rect, { x: 100, y: 100, width: 200, height: 200 });
  assert.equal(env.calls[1].pageId, undefined);
  assert.equal(env.images.get(env.calls[1].imageDataUrl).width, 200);
  assert.equal(env.images.get(env.calls[1].imageDataUrl).height, 200);
  env.overlay.close();
});

test("an explicit selection still displays backend exact-crop reuse without another provider request", async () => {
  const env = harness((message) =>
    message.type === "manga:analyze"
      ? { ok: true, jobId: "translation-job", cached: true }
      : undefined,
  );
  env.start();
  env.select();
  await settle();
  assert.equal(env.calls.filter((message) => message.type === "manga:capture").length, 1);
  assert.equal(env.overlay.selection.cached, true);
  assert.match(env.text(env.overlay.ui.body), /Saved translation/);
  env.overlay.close();
});

test("setup-required history keeps its translation readable and disables model changes", async () => {
  const result = run();
  result.analysis.regions[0].notes = ["Helpful explanation"];
  const env = harness();
  env.start({ setupRequired: true, history: { result, imageDataUrl: "fixture:page" } });
  await settle();
  assert.match(env.text(env.overlay.ui.body), /Natural 1/);
  assert.doesNotMatch(env.text(env.overlay.ui.body), /Helpful explanation/);
  assert.match(env.text(env.overlay.ui.card), /Complete extension setup/);
  env.overlay.selection.regionIndex = 1;
  env.overlay.ui.renderTranslation();
  assert.equal(env.overlay.ui.grammarRoot.querySelectorAll("button").length, 0);
  assert.equal(
    env.overlay.ui.body
      .querySelectorAll("button")
      .find((button) => button.attributes["aria-label"] === "Change model").disabled,
    true,
  );
  await env.overlay.compareModel("other/model");
  await env.overlay.restart();
  assert.equal(env.calls.length, 0);
  env.overlay.close();
});

test("setup-required failed history cannot retry translations or study jobs", async () => {
  const env = harness();
  env.start({
    setupRequired: true,
    history: {
      imageDataUrl: "fixture:page",
      job: { job_id: "old-translation", status: "interrupted" },
    },
  });
  assert.equal(env.overlay.ui.body.querySelector("button").disabled, true);
  await env.overlay.retryTranslation();
  assert.equal(env.calls.length, 0);
  env.start({
    sessionId: "study-history",
    setupRequired: true,
    history: {
      result: run(),
      imageDataUrl: "fixture:page",
      studyJob: { job_id: "old-study", region_id: "r1", status: "interrupted" },
    },
  });
  const before = env.calls.length;
  assert.equal(env.overlay.ui.grammarRoot.querySelectorAll("button").length, 0);
  assert.equal(env.calls.length, before);
  env.overlay.close();
});

test("setup-required history can still check an existing study job", async () => {
  const env = harness();
  env.start({
    setupRequired: true,
    history: {
      result: run(),
      imageDataUrl: "fixture:page",
      studyJob: { job_id: "study-r1", region_id: "r1", status: "running" },
    },
  });
  await settle();
  assert.deepEqual(
    env.calls.map((message) => message.type),
    ["manga:poll"],
  );
  env.overlay.close();
});

for (const api of ["drawImage", "toDataURL"]) {
  test(
    api + " security failure explains the crop failure and never submits a translation",
    async () => {
      const env = harness();
      const cause = new DOMException("The operation is insecure.", "SecurityError");
      const createElement = env.doc.createElement;
      env.doc.createElement = (tag) => {
        const element = createElement(tag);
        if (tag !== "canvas") return element;
        if (api === "toDataURL")
          element.toDataURL = () => {
            throw cause;
          };
        else {
          const getContext = element.getContext;
          element.getContext = (...args) => {
            const context = getContext.apply(element, args);
            context.drawImage = () => {
              throw cause;
            };
            return context;
          };
        }
        return element;
      };
      await assert.rejects(
        env.overlay.tracker.cropScreenshot(
          "fixture:page",
          { x: 100, y: 100, width: 200, height: 200 },
          { width: 600, height: 400 },
        ),
        (error) => {
          assert.equal(error.cause, cause);
          assert.equal(error.code, "screenshot-crop");
          return true;
        },
      );
      env.start();
      env.select();
      await settle();
      assert.equal(env.overlay.ui.shield, null);
      assert.doesNotMatch(env.text(env.overlay.ui.card), /Select another area/);
      const requestsBefore = env.calls.length;
      await env.overlay.captureSelection();
      env.fire(3000);
      await settle();
      assert.equal(env.calls.length, requestsBefore);
      assert.match(env.text(env.overlay.ui.card), /Couldn’t read this page.*screenshot-crop/);
      assert.doesNotMatch(env.text(env.overlay.ui.body), /operation is insecure|DRM/);
      assert.equal(env.calls.filter((message) => message.type === "manga:analyze").length, 0);
      env.overlay.close();
    },
  );
}
test("capture-access failure blocks more captures and shows a persistent error", async () => {
  const env = harness((message) =>
    message.type === "manga:capture"
      ? {
          ok: false,
          code: "capture-access",
          error: "Firefox could not capture this page. Reload and activate again.",
        }
      : undefined,
  );
  env.start();
  env.select();
  await settle();
  env.fire(3000);
  await settle();
  assert.equal(env.overlay.ui.shield, null);
  assert.match(env.text(env.overlay.ui.body), /Firefox could not capture/);
  assert.doesNotMatch(env.text(env.overlay.ui.card), /Drag to translate/);
  const captures = env.calls.filter((message) => message.type.includes("capture")).length;
  env.fire(3000);
  await env.overlay.captureSelection();
  await settle();
  assert.equal(env.calls.filter((message) => message.type.includes("capture")).length, captures);
  env.start({ sessionId: "reopened-session" });
  await settle();
  assert.equal(env.overlay.captureError, null);
  assert.ok(env.overlay.ui.shield, "fresh activation can retry capture");
  env.overlay.close();
});

test("fatal capture message survives page activity until the user explicitly dismisses it", async () => {
  const env = harness((message) =>
    message.type === "manga:capture"
      ? {
          ok: false,
          code: "screenshot-crop",
          error: "Firefox could not prepare the screenshot. Error code: screenshot-crop.",
        }
      : undefined,
  );
  env.start();
  env.select();
  await settle();
  const card = env.overlay.ui.card;
  const host = env.overlay.ui.host;
  const observer = env.overlay.observer;
  const generation = env.overlay.generation;
  assert.equal(host.style.visibility, "visible");
  assert.doesNotMatch(env.text(env.overlay.ui.card), /Select another area/);
  assert.match(env.text(card), /Couldn’t read this page.*screenshot-crop.*Close message/);
  assert.equal(card.style.width, "384px");
  assert.equal(card.style.maxHeight, "376px");
  for (const name of ["pointerdown", "wheel"]) env.doc.dispatch(name);
  for (const name of ["scroll", "resize", "hashchange", "popstate"]) env.win.dispatch(name);
  env.doc.dispatch("keydown", { key: "ArrowRight" });
  env.doc.dispatch("keydown", { key: "Escape", isTrusted: false });
  env.doc.hidden = true;
  env.doc.dispatch("visibilitychange");
  env.doc.hidden = false;
  env.doc.dispatch("visibilitychange");
  observer.fn([{ type: "attributes", target: env.doc.createElement("canvas") }]);
  const fullScreen = env.doc.createElement("section");
  env.doc.documentElement.append(fullScreen);
  env.doc.fullscreenElement = fullScreen;
  env.doc.dispatch("fullscreenchange");
  assert.equal(host.parent, fullScreen);
  env.doc.fullscreenElement = null;
  env.doc.dispatch("fullscreenchange");
  env.fire(3000);
  await settle();
  assert.equal(env.overlay.ui.card, card);
  assert.equal(card.isConnected, true);
  assert.equal(env.overlay.generation, generation);
  assert.equal(host.parent, env.doc.documentElement);
  assert.equal(env.calls.filter((message) => message.type.includes("capture")).length, 1);
  assert.equal(
    env.calls.some(
      (message) => message.type === "manga:analyze" || message.type === "manga:cancel",
    ),
    false,
  );
  env.doc.dispatch("keydown", { key: "Escape" });
  assert.equal(env.overlay.ui.host, null);
  assert.equal(env.calls.filter((message) => message.type === "manga:cancel").length, 1);
});

test("fatal capture message has an explicit Close action and normal reader invalidation still works", async () => {
  let failed = true;
  const env = harness((message) =>
    failed && message.type === "manga:capture"
      ? {
          ok: false,
          code: "capture-access",
          error: "Firefox could not capture this page.",
        }
      : undefined,
  );
  env.start();
  env.select();
  await settle();
  env.overlay.ui.body
    .querySelectorAll("button")
    .find((button) => button.textContent === "Close message")
    .dispatch("click");
  assert.equal(env.overlay.ui.host, null);
  failed = false;
  env.start({ sessionId: "reopened" });
  await settle();
  assert.equal(env.overlay.captureError, null);
  assert.ok(env.overlay.ui.shield);
  env.win.dispatch("resize");
  assert.equal(env.overlay.ui.host, null);
  assert.equal(env.calls.filter((message) => message.type === "manga:analyze").length, 0);
});

test("another release cannot capture or submit twice while the screenshot is pending", async () => {
  let finishCapture;
  const env = harness((message) =>
    message.type === "manga:capture"
      ? new Promise((resolve) => {
          finishCapture = resolve;
        })
      : undefined,
  );
  env.start();
  env.select();
  await settle();
  await env.overlay.captureSelection();
  assert.equal(env.calls.filter((message) => message.type === "manga:capture").length, 1);
  finishCapture({ ok: true, imageDataUrl: "fixture:page" });
  await settle();
  assert.equal(env.calls.filter((message) => message.type === "manga:analyze").length, 1);
  env.overlay.close();
});
test("translation completion keeps the card visible without another screenshot", async () => {
  const env = harness((message) =>
    message.type === "manga:verify-capture"
      ? { ok: false, code: "capture-access", error: "Unexpected screenshot" }
      : undefined,
  );
  env.start();
  env.select();
  await settle();
  const card = env.overlay.ui.card;
  const crop = env.overlay.selection.cropData;
  assert.match(env.text(env.overlay.ui.body), /Natural 1/);
  assert.equal(env.overlay.ui.body.querySelector("img").src, crop);
  assert.equal(env.overlay.ui.selection, null);
  assert.doesNotMatch(env.text(env.overlay.ui.card), /Select another area/);
  const captures = env.calls.filter((message) => message.type.includes("capture")).length;
  env.fire(3000);
  await settle();
  assert.equal(env.overlay.ui.card, card);
  assert.equal(env.calls.filter((message) => message.type.includes("capture")).length, captures);
  assert.equal(env.calls.filter((message) => message.type === "manga:verify-capture").length, 0);
  assert.equal(env.overlay.ui.host.style.visibility, "visible");
  env.overlay.close();
});

test("tiny and synthetic drags never submit a paid request; shadow root is closed", async () => {
  const env = harness();
  env.start();
  await settle();
  env.select({ x: 100, y: 100 }, { x: 105, y: 103 });
  env.select(undefined, undefined, false);
  await settle();
  assert.equal(env.calls.filter((m) => m.type === "manga:analyze").length, 0);
  assert.equal(env.overlay.ui.host.shadowRoot, null);
  assert.equal(env.overlay.ui.host.shadowMode, "closed");
});

test("synthetic card clicks cannot trigger requests and trusted word clicks remain local", async () => {
  const env = harness();
  env.start();
  env.select();
  await settle();
  const button = wordButton(env);
  const count = env.calls.length;
  button.dispatch("click", { isTrusted: false });
  env.overlay.ui.body
    .querySelectorAll("button")
    .find((node) => node.attributes["aria-label"] === "Change model")
    .dispatch("click", { isTrusted: false });
  await settle();
  assert.equal(env.calls.length, count);
  assert.equal(env.overlay.ui.wordHelp.tip, null);
  button.dispatch("click");
  await settle();
  assert.match(env.text(env.overlay.ui.wordHelp.tip), /にほんご/);
  assert.equal(env.calls.length, count);
  assert.equal(env.calls.filter((m) => m.type === "manga:study").length, 0);
  env.overlay.close();
});

test("closing during screenshot prevents a later paid submission", async () => {
  let resolveCapture;
  const env = harness((message) =>
    message.type === "manga:capture"
      ? new Promise((resolve) => {
          resolveCapture = resolve;
        })
      : undefined,
  );
  env.start();
  env.select();
  await settle();
  env.overlay.close();
  resolveCapture({ ok: true, imageDataUrl: "fixture:page" });
  await settle();
  assert.equal(env.calls.filter((m) => m.type === "manga:analyze").length, 0);
});

test("dismissed card retains heartbeat until active work finishes", async () => {
  const env = harness((message) =>
    message.type === "manga:poll" ? { ok: true, job: { status: "running" } } : undefined,
  );
  env.start();
  env.select();
  await settle();
  env.overlay.close();
  assert.notEqual(env.ports[0].closed, true);
  assert.ok([...env.timers.values()].some((timer) => timer.delay === 15000));
  assert.ok(![...env.timers.values()].some((timer) => timer.delay === 3000));
  env.portStatus(0);
  assert.equal(env.ports[0].closed, true);
  assert.equal(env.timers.size, 0);
});

test("canvas-only changes leave the captured answer visible without recapturing", async () => {
  const env = harness();
  env.start();
  env.select();
  await settle();
  const card = env.overlay.ui.card,
    body = env.overlay.ui.body;
  const crop = env.overlay.selection.cropData,
    calls = env.calls.length;
  env.fixture.screenshot = "fixture:changed";
  env.fire(3000);
  await settle();
  assert.equal(env.overlay.ui.card, card);
  assert.equal(env.overlay.ui.body, body);
  assert.equal(env.overlay.ui.body.querySelector("img").src, crop);
  assert.match(env.text(body), /Natural 1/);
  assert.equal(env.overlay.ui.selection, null);
  assert.equal(env.calls.length, calls);
});

test("a delayed translation stays pending through repeated small scrolls and completes for its captured text", async () => {
  let complete;
  const env = harness((message) =>
    message.type === "manga:poll"
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : undefined,
  );
  env.start();
  env.select();
  await settle();
  const card = env.overlay.ui.card,
    body = env.overlay.ui.body,
    crop = env.overlay.selection.cropData;
  const revision = env.overlay.selectionRevision,
    captures = env.calls.filter((message) => message.type.includes("capture")).length;
  const pendingContent = body.children[0];
  for (let step = 0; step < 20; step++) {
    env.win.scrollY = step * 24;
    env.doc.dispatch("wheel");
    env.win.dispatch("scroll");
    env.fire(3000);
    await settle();
    assert.equal(env.overlay.ui.card, card);
    assert.equal(env.overlay.ui.body, body);
    assert.equal(body.children[0], pendingContent);
    assert.match(env.text(body), /Translating…/);
  }
  assert.equal(env.overlay.selection.detached, true);
  assert.equal(env.overlay.selectionRevision, revision);
  assert.equal(env.overlay.ui.card, card);
  complete({ ok: true, job: { status: "completed", result: run() } });
  await settle();
  assert.equal(env.overlay.ui.card, card);
  assert.equal(env.overlay.ui.body.querySelector("img").src, crop);
  assert.match(env.text(env.overlay.ui.body), /Natural 1/);
  assert.equal(env.calls.filter((message) => message.type === "manga:verify-capture").length, 0);
  assert.equal(env.calls.filter((message) => message.type.includes("capture")).length, captures);
  assert.equal(env.calls.filter((message) => message.type === "manga:analyze").length, 1);
});

test("a completion from an older selection revision cannot replace the current card", async () => {
  const env = harness();
  env.start();
  env.select();
  await settle();
  const generation = env.overlay.generation,
    revision = env.overlay.selectionRevision;
  env.overlay.beginSelection();
  env.overlay.acceptTranslation({ ...run(), run_id: "old-run" }, generation, revision);
  assert.equal(env.overlay.selection.run, null);
  assert.equal(env.overlay.ui.card, null);
  assert.ok(env.overlay.ui.shield);
});

test("scheduled polling retains its original revision after a new selection begins", async () => {
  let polls = 0;
  const env = harness((message) => {
    if (message.type !== "manga:poll") return;
    polls++;
    return {
      ok: true,
      job: polls === 1 ? { status: "running" } : { status: "failed", error: "Old job failed" },
    };
  });
  env.start();
  env.select();
  await settle();
  assert.equal(polls, 1);
  env.overlay.beginSelection();
  const revision = env.overlay.selectionRevision;
  env.fire(1000);
  await settle();
  assert.equal(polls, 1, "a stale scheduled poll must stop before querying or rendering");
  assert.equal(env.overlay.selectionRevision, revision);
  assert.equal(env.overlay.ui.card, null);
  assert.ok(env.overlay.ui.shield);
});

test("page activity preserves card and body while clearing live placement and repositioning when needed", async () => {
  const env = harness();
  env.start();
  env.select();
  await settle();
  const card = env.overlay.ui.card,
    body = env.overlay.ui.body;
  const firstChild = body.children[0],
    revision = env.overlay.selectionRevision;
  const observer = env.overlay.observer;
  env.doc.dispatch("pointerdown");
  for (const name of ["scroll", "hashchange", "popstate"]) env.win.dispatch(name);
  env.doc.dispatch("wheel");
  env.doc.dispatch("keydown", { key: "ArrowRight" });
  env.doc.hidden = true;
  env.doc.dispatch("visibilitychange");
  env.doc.hidden = false;
  observer.fn([{ type: "attributes", target: env.doc.createElement("canvas") }]);
  env.win.innerWidth = 320;
  env.win.innerHeight = 360;
  env.win.dispatch("resize");
  const fullscreen = env.doc.createElement("div");
  env.doc.documentElement.append(fullscreen);
  env.doc.fullscreenElement = fullscreen;
  env.doc.dispatch("fullscreenchange");
  env.fire(3000);
  await settle();
  assert.equal(env.overlay.ui.card, card);
  assert.equal(env.overlay.ui.body, body);
  assert.equal(
    body.children[0],
    firstChild,
    "page activity must not rebuild answer or reset its controls",
  );
  assert.equal(env.overlay.selectionRevision, revision);
  assert.equal(env.overlay.selection.detached, true);
  assert.equal(env.overlay.ui.host.parent, fullscreen);
  const placed = placeCard(env.overlay.cardPosition, env.overlay.viewport);
  const cardLeft = placed.x - (placed.width * placed.translateX) / 100;
  assert.ok(cardLeft >= 12 && cardLeft + placed.width <= 308);
  assert.equal(env.overlay.ui.selection, null);
  assert.equal(env.calls.filter((message) => message.type === "manga:analyze").length, 1);
  assert.equal(env.calls.filter((message) => message.type === "manga:cancel").length, 0);
  env.win.dispatch("pagehide");
  assert.equal(env.overlay.ui.host, null, "full document navigation still cleans up the session");
});

test("new sessions can capture while an old submission is pending without losing their busy guard", async () => {
  const submitted = [];
  const env = harness((message) =>
    message.type === "manga:analyze"
      ? new Promise((resolve) => submitted.push(resolve))
      : undefined,
  );
  env.start();
  env.select();
  await settle();
  assert.equal(submitted.length, 1);
  env.start({ sessionId: "session-b" });
  await settle();
  env.select();
  await settle();
  assert.equal(submitted.length, 2, "the previous session must not block a new selection");

  submitted[0]({ ok: true, jobId: "old-job" });
  await settle();
  assert.equal(env.overlay.selection.pending.has("capture"), true);
  await env.overlay.captureSelection();
  assert.equal(submitted.length, 2, "old completion must not permit a duplicate submission");
  submitted[1]({ ok: true, jobId: "translation-job" });
  await settle();
  assert.match(env.text(env.overlay.ui.body), /Natural 1/);
  assert.equal(env.overlay.selection.pending.has("capture"), false);
  assert.equal(
    env.calls.some((message) => message.type === "manga:poll" && message.jobId === "old-job"),
    false,
  );
  env.overlay.close();
});

for (const operation of ["retry", "compare"]) {
  test(`an old ${operation} completion cannot clear a new session's submission guard`, async () => {
    const submitted = [];
    const type = operation === "retry" ? "manga:retry" : "manga:analyze";
    const env = harness((message) =>
      message.type === type ? new Promise((resolve) => submitted.push(resolve)) : undefined,
    );
    const history =
      operation === "retry"
        ? { imageDataUrl: "fixture:page", job: { job_id: "failed-job", status: "interrupted" } }
        : { imageDataUrl: "fixture:page", result: run() };
    const submit = () =>
      operation === "retry"
        ? env.overlay.retryTranslation()
        : env.overlay.compareModel("other/model");
    env.start({ history });
    const oldWork = submit();
    await settle();
    env.start({ sessionId: "session-b", history });
    const newWork = submit();
    await settle();
    assert.equal(submitted.length, 2);
    submitted[0]({ ok: true, jobId: "old-job" });
    await oldWork;
    assert.equal(env.overlay.selection.pending.has(operation), true);
    await submit();
    assert.equal(submitted.length, 2);
    submitted[1]({ ok: true, jobId: "translation-job" });
    await newWork;
    await settle();
    assert.match(env.text(env.overlay.ui.body), /Natural 1/);
    env.overlay.close();
  });
}

test("detached model comparison identifies the original stored input explicitly", async () => {
  const env = harness();
  env.start({ history: { result: run(), imageDataUrl: "fixture:page" } });
  await env.overlay.compareModel("chosen/alternative");
  await settle();
  const request = env.calls.find((message) => message.type === "manga:analyze");
  assert.equal(request.sourceRunId, "run-a");
  assert.equal(request.model, "chosen/alternative");
  assert.equal(request.pageId, undefined);
  assert.equal(env.calls.filter((message) => message.type === "manga:capture").length, 0);
});

test("translation history recognizes backend job_id and requires explicit charged retry", async () => {
  const env = harness();
  env.start({
    history: {
      imageDataUrl: "fixture:page",
      job: { job_id: "translation-job", status: "interrupted", error: "Stream lost" },
    },
  });
  assert.equal(env.overlay.selection.translationJob, "translation-job");
  assert.match(env.text(env.overlay.ui.body), /may already have been charged/);
  assert.equal(env.calls.filter((message) => message.type === "manga:retry").length, 0);
});

test("running translation history polls the existing job without implying an interruption", async () => {
  const env = harness();
  env.start({
    history: {
      imageDataUrl: "fixture:page",
      job: { job_id: "translation-job", status: "running" },
    },
  });
  await settle();
  assert.match(env.text(env.overlay.ui.body), /Natural 1/);
  assert.equal(env.calls.filter((message) => message.type === "manga:poll").length, 1);
  assert.equal(
    env.calls.filter((message) => ["manga:analyze", "manga:retry"].includes(message.type)).length,
    0,
  );
  assert.doesNotMatch(env.text(env.overlay.ui.body), /Saved translation|interrupted/);
});

test("running study history polls its original job while keeping the translation", async () => {
  const env = harness();
  const result = run();
  env.start({
    history: {
      result,
      imageDataUrl: "fixture:page",
      studyJob: { job_id: "study-r1", regionId: "r1", status: "running" },
    },
  });
  await settle();
  assert.match(env.text(env.overlay.ui.body), /Natural 1/);
  assert.equal(env.overlay.selection.studies.get("r1")?.status, "completed");
  assert.ok(wordButton(env), "The existing inline word help remains available");
  wordButton(env).dispatch("pointerenter");
  assert.match(env.text(env.overlay.ui.wordHelp.tip), /にほんご/);
  assert.equal(
    env.calls.filter((message) => ["manga:study", "manga:retry"].includes(message.type)).length,
    0,
  );
});

test("obsolete study data does not replace the current inline learning", async () => {
  const env = harness();
  const result = run();
  result.studies = { r1: study("r1") };
  env.start({
    history: {
      result,
      imageDataUrl: "fixture:page",
      studyJob: { job_id: "study-r1", regionId: "r1", status: "completed", result: study("r1") },
    },
  });
  await settle();
  assert.equal(env.overlay.selection.studies.get("r1")?.status, "completed");
  assert.equal(env.calls.length, 0);
});

test("explicit paid retry from history removes the saved translation label", async () => {
  const env = harness();
  env.start({
    history: {
      imageDataUrl: "fixture:page",
      job: { job_id: "translation-job", status: "interrupted" },
    },
  });
  await env.overlay.retryTranslation();
  await settle();
  assert.equal(env.overlay.selection.cached, false);
  assert.match(env.text(env.overlay.ui.body), /Natural 1/);
  assert.doesNotMatch(env.text(env.overlay.ui.body), /Saved translation/);
});

test("poll connection errors only check the existing job and unknown cost is not zero", async () => {
  let first = true;
  const env = harness((message) => {
    if (message.type === "manga:poll" && first) {
      first = false;
      throw new Error("Connection interrupted");
    }
  });
  env.start();
  env.select();
  await settle();
  assert.match(env.text(env.overlay.ui.body), /Check again/);
  env.overlay.resumeTranslation();
  await settle();
  assert.equal(env.calls.filter((m) => m.type === "manga:analyze").length, 1);
  assert.equal(env.overlay.ui.cost({}), "Cost not reported");
});
