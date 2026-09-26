const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, settle, run } = require("./reader-harness.cjs");

test("the pending card is visible before screenshot decoding and cropping starts", async () => {
  const env = harness();
  const tracker = env.overlay.tracker;
  const crop = tracker.cropScreenshot.bind(tracker);
  let cropped = false;
  tracker.cropScreenshot = async (...args) => {
    cropped = true;
    assert.equal(env.overlay.ui.host.style.visibility, "visible");
    assert.ok(env.overlay.ui.card?.isConnected);
    assert.match(env.text(env.overlay.ui.body), /Preparing selection/);
    return crop(...args);
  };
  env.start();
  await settle();
  assert.equal(cropped, false);
  env.select();
  await settle();
  assert.equal(cropped, true);
  env.overlay.close();
});

test("an open answer card never captures or performs page matching in the background", async () => {
  const env = harness();
  env.start({ history: { result: run(), imageDataUrl: "fixture:page" } });
  const card = env.overlay.ui.card;
  for (let i = 0; i < 5; i++) {
    env.fire(3000);
    env.win.dispatch("scroll");
    await settle();
  }
  assert.equal(env.overlay.ui.card, card);
  assert.deepEqual(env.calls, []);
  env.overlay.close();
});
