"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, settle, run } = require("./reader-harness.cjs");

test("a failed keepalive port does not stop a healthy request status channel", async () => {
  const h = harness();
  h.overlay.runtime.connect = () => {
    throw new Error("Keepalive port unavailable");
  };
  h.start();
  h.select();
  await settle();

  assert.equal(h.overlay.selection.run?.run_id, "run-a");
  assert.match(h.text(h.overlay.ui.body), /Natural 1/);
  assert.equal(h.calls.filter((message) => message.type === "manga:analyze").length, 1);
  assert.equal(h.calls.filter((message) => message.type === "manga:poll").length, 1);
  assert.equal(h.calls.filter((message) => message.type === "manga:retry").length, 0);
  h.overlay.close();
});

test("Check again after a port disconnect retrieves the existing answer without resubmitting", async () => {
  let firstPoll = true;
  const h = harness((message) => {
    if (message.type === "manga:poll" && firstPoll) {
      firstPoll = false;
      throw new Error("Status temporarily unavailable");
    }
  });
  h.start();
  h.select();
  await settle();
  const check = h.overlay.ui.body.querySelector("button");
  assert.equal(check.textContent, "Check again");
  const errorText = h.text(h.overlay.ui.body);
  h.ports[0].disconnect();
  assert.equal(h.text(h.overlay.ui.body), errorText, "port loss does not add a second error");
  check.dispatch("click");
  await settle();

  assert.equal(h.overlay.selection.run?.run_id, "run-a");
  assert.match(h.text(h.overlay.ui.body), /Natural 1/);
  assert.doesNotMatch(h.text(h.overlay.ui.body), /Translating|connection closed/);
  assert.equal(h.calls.filter((message) => message.type === "manga:poll").length, 2);
  assert.equal(h.calls.filter((message) => message.type === "manga:analyze").length, 1);
  assert.equal(h.calls.filter((message) => message.type === "manga:retry").length, 0);
  h.overlay.close();
});

test("port loss during healthy polling keeps the pending card quiet and retrieves completion", async () => {
  let completed = false;
  const h = harness((message) => {
    if (message.type === "manga:poll")
      return {
        ok: true,
        job: completed ? { status: "completed", result: run() } : { status: "running" },
      };
  });
  h.start();
  h.select();
  await settle();
  const card = h.overlay.ui.card;
  const pendingText = h.text(card);
  h.ports[0].disconnect();
  assert.equal(h.text(card), pendingText);
  completed = true;
  h.fire(1000);
  await settle();

  assert.equal(h.overlay.ui.card, card);
  assert.equal(h.overlay.selection.run?.run_id, "run-a");
  assert.equal(h.calls.filter((message) => message.type === "manga:poll").length, 2);
  assert.equal(h.calls.filter((message) => message.type === "manga:analyze").length, 1);
  assert.equal(h.calls.filter((message) => message.type === "manga:retry").length, 0);
  h.overlay.close();
});
