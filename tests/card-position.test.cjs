"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { placeCard } = require("../src/reader/vision.js");
const { harness, settle, run } = require("./reader-harness.cjs");
const closeButton = (header) =>
  header
    .querySelectorAll("button")
    .find((button) => button.attributes["aria-label"] === "Close card");

const pointer = (extra = {}) => ({
  isTrusted: true,
  isPrimary: true,
  button: 0,
  pointerId: 17,
  clientX: 140,
  clientY: 110,
  ...extra,
});

function openCard(position = { x: 0.5, y: 0.5 }) {
  const env = harness();
  env.start({
    cardPosition: position,
    history: { result: run(), imageDataUrl: "fixture:page" },
  });
  const card = env.overlay.ui.card,
    header = env.overlay.ui.cardHeader;
  card.box = {
    x: 12 + 192 * position.x,
    y: 12 + 156 * position.y,
    width: 384,
    height: 220,
  };
  let captured;
  const captures = [],
    releases = [];
  header.setPointerCapture = (id) => {
    captured = id;
    captures.push(id);
  };
  header.hasPointerCapture = (id) => captured === id;
  header.releasePointerCapture = (id) => {
    captured = undefined;
    releases.push(id);
  };
  return { ...env, card, header, captures, releases };
}

test("normalized anchors keep cards within the viewport as their content grows", () => {
  for (const viewport of [
    { width: 600, height: 400 },
    { width: 320, height: 480 },
    { width: 200, height: 100 },
  ]) {
    for (const position of [
      { x: 0, y: 0 },
      { x: 0.35, y: 0.6 },
      { x: 1, y: 1 },
    ]) {
      const placed = placeCard(position, viewport);
      assert.equal(placed.translateX, position.x * 100);
      assert.equal(placed.translateY, position.y * 100);
      assert.ok(placed.width <= viewport.width - 24);
      assert.ok(placed.maxHeight <= viewport.height - 24);
      for (const height of [40, placed.maxHeight]) {
        const left = placed.x - (placed.width * placed.translateX) / 100,
          top = placed.y - (height * placed.translateY) / 100;
        assert.ok(left >= 12 - 1e-8 && left + placed.width <= viewport.width - 12 + 1e-8);
        assert.ok(top >= 12 - 1e-8 && top + height <= viewport.height - 12 + 1e-8);
      }
    }
  }
});

test("fresh sessions restore the preferred card anchor independently of selection geometry", () => {
  const env = openCard({ x: 0.25, y: 0.5 });
  assert.deepEqual(env.overlay.cardPosition, { x: 0.25, y: 0.5 });
  assert.equal(env.card.style.left, "156px");
  assert.equal(env.card.style.top, "200px");
  assert.equal(env.card.style.transform, "translate(-25%, -50%)");
  env.overlay.selection.rect = { x: 599, y: 399, width: 1, height: 1 };
  env.overlay.ui.positionCard();
  assert.equal(env.card.style.left, "156px");
  assert.equal(env.card.style.top, "200px");

  env.start({
    sessionId: "next-session",
    cardPosition: { x: 0.25, y: 0.5 },
    history: { result: run(), imageDataUrl: "fixture:page" },
  });
  assert.equal(env.overlay.ui.card.style.transform, "translate(-25%, -50%)");
  env.overlay.close();
});

test("cards default to the bottom-right anchor when no position is saved", () => {
  const env = harness();
  env.start({ history: { result: run(), imageDataUrl: "fixture:page" } });
  assert.deepEqual(env.overlay.cardPosition, { x: 1, y: 1 });
  assert.equal(env.overlay.ui.card.style.left, "588px");
  assert.equal(env.overlay.ui.card.style.top, "388px");
  assert.equal(env.overlay.ui.card.style.transform, "translate(-100%, -100%)");
  env.overlay.close();
});

test("activation removes orphaned overlay hosts and the new card can move and close", () => {
  const env = harness();
  const orphan = env.doc.createElement("div");
  orphan.setAttribute("data-manga-selection-host", "");
  orphan.attachShadow({ mode: "closed" });
  env.doc.documentElement.append(orphan);
  env.start({ history: { result: run(), imageDataUrl: "fixture:page" } });
  assert.equal(orphan.isConnected, false);
  assert.deepEqual(env.doc.querySelectorAll("[data-manga-selection-host]"), [env.overlay.ui.host]);
  const card = env.overlay.ui.card;
  card.box = { x: 204, y: 168, width: 384, height: 220 };
  const header = env.overlay.ui.cardHeader;
  header.dispatch("pointerdown", pointer());
  header.dispatch("pointermove", pointer({ clientX: 40, clientY: 20 }));
  assert.ok(env.overlay.cardPosition.x < 1);
  assert.ok(env.overlay.cardPosition.y < 1);
  header.dispatch("pointerup", pointer({ clientX: 40, clientY: 20 }));
  closeButton(header).dispatch("click");
  assert.equal(card.isConnected, false);
  assert.equal(env.doc.querySelectorAll("[data-manga-selection-host]").length, 0);
});

test("dragging clamps the measured card and saves once on release without capture or translation", async () => {
  const env = openCard();
  env.header.dispatch("pointerdown", pointer());
  assert.deepEqual(env.captures, [17]);
  env.header.dispatch("pointermove", pointer({ clientX: 2000, clientY: 2000 }));
  assert.deepEqual(env.overlay.cardPosition, { x: 1, y: 1 });
  env.header.dispatch("pointermove", pointer({ clientX: -2000, clientY: -2000 }));
  assert.deepEqual(env.overlay.cardPosition, { x: 0, y: 0 });
  assert.equal(env.calls.length, 0, "moving the card is entirely local");
  env.header.dispatch("pointerup", pointer({ clientX: -2000, clientY: -2000 }));
  env.header.dispatch("pointerup", pointer({ clientX: -2000, clientY: -2000 }));
  await settle();
  assert.deepEqual(env.releases, [17]);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].type, "manga:save-card-position");
  assert.deepEqual(env.calls[0].position, { x: 0, y: 0 });
  assert.equal(env.card.style.left, "12px");
  assert.equal(env.card.style.top, "12px");
  env.overlay.close();
});

for (const completedHeight of [260, 376])
  test(`completion during a header drag keeps its pointer offset, clamped for a ${completedHeight}px card`, async () => {
    let complete;
    const pending = new Promise((resolve) => {
      complete = resolve;
    });
    const env = harness((message) => (message.type === "manga:poll" ? pending : undefined));
    env.start({ cardPosition: { x: 0.25, y: 0.1 } });
    env.select();
    await settle();
    const ui = env.overlay.ui,
      card = ui.card,
      header = ui.cardHeader;
    card.getBoundingClientRect = () => {
      const height = ui.body.querySelectorAll("p").some((node) => node.className === "pending")
        ? 120
        : completedHeight;
      const [x, y] = card.style.transform.match(/[\d.]+/g).map(Number);
      return {
        x: parseFloat(card.style.left) - (384 * x) / 100,
        y: parseFloat(card.style.top) - (height * y) / 100,
        width: 384,
        height,
      };
    };
    const original = card.getBoundingClientRect(),
      origin = { clientX: original.x + 20, clientY: original.y + 20 };
    header.dispatch("pointerdown", pointer(origin));
    header.dispatch(
      "pointermove",
      pointer({ clientX: origin.clientX + 20, clientY: origin.clientY + 15 }),
    );
    complete({ ok: true, job: { status: "completed", result: run() } });
    await settle();
    const expectedTop = (dy) => Math.min(original.y + dy, 400 - completedHeight - 12);
    let box = card.getBoundingClientRect();
    assert.ok(Math.abs(box.x - (original.x + 20)) < 1e-8);
    assert.ok(Math.abs(box.y - expectedTop(15)) < 1e-8);
    assert.equal(ui.cardHeader, header);
    assert.match(env.text(ui.body), /Natural 1/);
    header.dispatch(
      "pointermove",
      pointer({ clientX: origin.clientX + 30, clientY: origin.clientY + 20 }),
    );
    box = card.getBoundingClientRect();
    assert.ok(Math.abs(box.x - (original.x + 30)) < 1e-8);
    assert.ok(Math.abs(box.y - expectedTop(20)) < 1e-8);
    header.dispatch(
      "pointerup",
      pointer({ clientX: origin.clientX + 30, clientY: origin.clientY + 20 }),
    );
    await settle();
    assert.equal(
      env.calls.filter((message) => message.type === "manga:save-card-position").length,
      1,
    );
    assert.equal(env.calls.filter((message) => message.type === "manga:capture").length, 1);
    assert.equal(env.calls.filter((message) => message.type === "manga:analyze").length, 1);
    closeButton(header).dispatch("click");
    assert.equal(ui.host, null);
  });

test("only trusted primary header drags move the card; body text and close controls remain usable", async () => {
  const env = openCard();
  const originalStyle = { ...env.card.style },
    close = closeButton(env.header);
  for (const invalid of [
    { isTrusted: false },
    { isPrimary: false },
    { button: 2 },
    { target: close },
  ]) {
    env.header.dispatch("pointerdown", pointer(invalid));
    env.header.dispatch("pointermove", pointer({ clientX: 400, clientY: 300 }));
    env.header.dispatch("pointerup", pointer({ clientX: 400, clientY: 300 }));
  }
  env.overlay.ui.body.dispatch("pointerdown", pointer());
  env.overlay.ui.body.dispatch("pointermove", pointer({ clientX: 400, clientY: 300 }));
  env.overlay.ui.body.dispatch("pointerup", pointer({ clientX: 400, clientY: 300 }));
  await settle();
  assert.deepEqual(env.card.style, originalStyle);
  assert.deepEqual(env.captures, []);
  assert.deepEqual(env.calls, []);
  close.dispatch("click");
  assert.equal(env.overlay.ui.host, null);
});

test("other pointers cannot move or finish a drag and cancellation restores the prior position", async () => {
  const env = openCard({ x: 0.25, y: 0.5 });
  const originalStyle = { ...env.card.style };
  env.header.dispatch("pointerdown", pointer());
  env.header.dispatch("pointermove", pointer({ pointerId: 18, clientX: 2000, clientY: 2000 }));
  env.header.dispatch("pointerup", pointer({ pointerId: 18, clientX: 2000, clientY: 2000 }));
  env.header.dispatch("pointercancel", pointer({ pointerId: 18 }));
  env.header.dispatch("lostpointercapture", pointer({ pointerId: 18 }));
  env.header.dispatch("pointercancel", pointer({ isTrusted: false }));
  assert.deepEqual(env.overlay.cardPosition, { x: 0.25, y: 0.5 });
  env.header.dispatch("pointermove", pointer({ clientX: 2000, clientY: 2000 }));
  assert.deepEqual(env.overlay.cardPosition, { x: 1, y: 1 });
  env.header.dispatch("pointercancel", pointer());
  env.header.dispatch("pointermove", pointer({ clientX: -2000, clientY: -2000 }));
  env.header.dispatch("pointerup", pointer());
  await settle();
  assert.deepEqual(env.overlay.cardPosition, { x: 0.25, y: 0.5 });
  assert.deepEqual(env.card.style, originalStyle);
  assert.deepEqual(env.calls, []);
  assert.deepEqual(env.releases, [17]);
  env.overlay.close();
});

test("losing capture restores the position without trying to release a pointer already lost", async () => {
  const env = openCard();
  env.header.dispatch("pointerdown", pointer());
  env.header.dispatch("pointermove", pointer({ clientX: 2000, clientY: 2000 }));
  env.header.hasPointerCapture = () => false;
  env.header.releasePointerCapture = () => {
    throw new Error("The pointer is no longer captured");
  };
  env.header.dispatch("lostpointercapture", pointer());
  await settle();
  assert.deepEqual(env.overlay.cardPosition, { x: 0.5, y: 0.5 });
  assert.deepEqual(env.calls, []);
  env.overlay.close();
});

test("clicking the header without dragging does not write a preference", async () => {
  const env = openCard();
  env.header.dispatch("pointerdown", pointer());
  env.header.dispatch("pointerup", pointer());
  await settle();
  assert.deepEqual(env.overlay.cardPosition, { x: 0.5, y: 0.5 });
  assert.deepEqual(env.calls, []);
  env.overlay.close();
});

for (const event of ["resize", "fullscreenchange"]) {
  test(`${event} cancels a drag and fits the remembered position to the new viewport`, async () => {
    const env = openCard({ x: 0.25, y: 0.5 });
    env.header.dispatch("pointerdown", pointer());
    env.header.dispatch("pointermove", pointer({ clientX: 2000, clientY: 2000 }));
    env.win.innerWidth = 320;
    env.win.innerHeight = 260;
    if (event === "fullscreenchange") {
      const fullscreen = env.doc.createElement("div");
      env.doc.documentElement.append(fullscreen);
      env.doc.fullscreenElement = fullscreen;
      env.doc.dispatch(event);
      assert.equal(env.overlay.ui.host.parent, fullscreen);
    } else env.win.dispatch(event);
    env.header.dispatch("pointerup", pointer({ clientX: 2000, clientY: 2000 }));
    await settle();
    assert.equal(env.overlay.ui.card, env.card);
    assert.deepEqual(env.overlay.cardPosition, { x: 0.25, y: 0.5 });
    assert.equal(env.card.style.left, "86px");
    assert.equal(env.card.style.top, "130px");
    assert.equal(env.card.style.transform, "translate(-25%, -50%)");
    assert.equal(env.card.style.width, "296px");
    assert.equal(env.card.style.maxHeight, "236px");
    assert.deepEqual(env.releases, [17]);
    assert.deepEqual(env.calls, []);
    env.overlay.close();
  });
}

test("closing during a drag clears the old header so late pointer events cannot save", async () => {
  const env = openCard();
  env.header.dispatch("pointerdown", pointer());
  env.header.dispatch("pointermove", pointer({ clientX: 2000, clientY: 2000 }));
  env.overlay.close();
  const callsAfterClose = env.calls.length;
  env.header.dispatch("pointermove", pointer({ clientX: -2000, clientY: -2000 }));
  env.header.dispatch("pointerup", pointer());
  await settle();
  assert.equal(env.overlay.ui.cardHeader, null);
  assert.equal(env.overlay.ui.card, null);
  assert.equal(env.calls.length, callsAfterClose);
  assert.equal(
    env.calls.some((message) => message.type === "manga:save-card-position"),
    false,
  );
});
