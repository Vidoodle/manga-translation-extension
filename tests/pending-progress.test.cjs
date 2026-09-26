"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, settle, run } = require("./reader-harness.cjs");

test("elapsed time and polling continue through a long request while the reader scrolls", async (t) => {
  let now = 100000;
  let completed = false;
  t.mock.method(Date, "now", () => now);
  const h = harness((message) => {
    if (message.type === "manga:poll")
      return {
        ok: true,
        job: completed
          ? { status: "completed", result: run() }
          : { status: "running", createdAt: 100000, progress: "Receiving translation…" },
      };
  });
  h.start();
  h.select();
  await settle();
  const card = h.overlay.ui.card;
  for (let second = 1; second <= 40; second++) {
    now += 1000;
    h.win.dispatch("scroll");
    h.fire(1000);
    await settle();
    assert.equal(h.overlay.ui.card, card);
    assert.match(h.text(card), new RegExp(` · ${second}s`));
  }
  assert.equal(h.calls.filter((call) => call.type === "manga:capture").length, 1);
  assert.equal(h.calls.filter((call) => call.type === "manga:analyze").length, 1);
  assert.equal(h.calls.filter((call) => call.type === "manga:poll").length, 41);
  assert.doesNotMatch(h.text(card), /Dismiss to keep reading/);
  completed = true;
  h.fire(1000);
  await settle();
  assert.match(h.text(card), /Natural 1/);
  h.overlay.close();
  assert.equal(h.overlay.timers.size, 0);
});

test("checking an existing request uses its original start time without resubmitting", async (t) => {
  let now = 150000;
  t.mock.method(Date, "now", () => now);
  const h = harness((message) => {
    if (message.type === "manga:poll")
      return { ok: true, job: { status: "running", createdAt: 100000 } };
  });
  h.start();
  h.select();
  await settle();
  h.fire(1000);
  await settle();
  assert.match(h.text(h.overlay.ui.card), / · 50s/);
  now += 5000;
  h.overlay.ui.showJobError("Status temporarily unavailable.", null);
  h.overlay.resumeTranslation();
  await settle();
  assert.match(h.text(h.overlay.ui.card), / · 55s/);
  assert.equal(h.calls.filter((call) => call.type === "manga:analyze").length, 1);
  h.overlay.close();
});

test("reopening a pending saved answer shows its original elapsed time immediately", (t) => {
  t.mock.method(Date, "now", () => 150000);
  const h = harness((message) =>
    message.type === "manga:poll" ? new Promise(() => {}) : undefined,
  );
  h.start({
    history: {
      imageDataUrl: "fixture:page",
      job: { job_id: "saved-pending", status: "running", createdAt: 100000 },
    },
  });
  assert.match(h.text(h.overlay.ui.card), / · 50s/);
  assert.equal(h.calls.filter((call) => call.type === "manga:analyze").length, 0);
  h.overlay.close();
});
