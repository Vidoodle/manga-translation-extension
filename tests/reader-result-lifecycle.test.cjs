"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, run, settle } = require("./reader-harness.cjs");

test("a failed older restart cannot replace the answer opened by a newer activation", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const env = harness((message) => (message.type === "manga:restart" ? pending : undefined));
  env.start({ history: { result: run(), imageDataUrl: "fixture:page" } });
  const restarting = env.overlay.restart();
  await settle();
  const newer = run();
  newer.analysis.regions[0].translation = "The newer answer must remain visible.";
  env.start({
    sessionId: "newer-session",
    history: { result: newer, imageDataUrl: "fixture:page" },
  });
  release({ ok: false, error: "The old restart failed." });
  await restarting;
  await settle();

  assert.match(env.text(env.overlay.ui.body), /The newer answer must remain visible/);
  assert.doesNotMatch(env.text(env.overlay.ui.body), /old restart failed/);
  env.overlay.close();
});

test("a completed no-text answer can still compare the original crop with another model", async () => {
  const result = run();
  result.analysis = { summary: "No readable text found.", warnings: [], regions: [] };
  const env = harness((message) =>
    message.type === "manga:models"
      ? { ok: true, catalog: { models: [{ id: "other/model", name: "Another model" }] } }
      : undefined,
  );
  env.start({ history: { result, imageDataUrl: "fixture:page" } });
  await settle();

  const compare = env.overlay.ui.body
    .querySelectorAll("button")
    .find((button) => button.attributes["aria-label"] === "Change model");
  assert.ok(compare, "a model's empty answer must not remove comparison for this saved crop");
  assert.equal(env.calls.filter((message) => message.type === "manga:analyze").length, 0);
  compare.dispatch("click");
  await settle();
  const select = env.overlay.ui.body.querySelector("select");
  select.value = "other/model";
  select.dispatch("change");
  assert.equal(env.calls.filter((message) => message.type === "manga:analyze").length, 0);
  env.overlay.ui.body
    .querySelectorAll("button")
    .find((button) => button.textContent === "Translate with selected model")
    .dispatch("click");
  await settle();
  const submissions = env.calls.filter((message) => message.type === "manga:analyze");
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].sourceRunId, result.run_id);
  assert.equal(submissions[0].model, "other/model");
  env.overlay.close();
});

test("the result shows the whole selection with word help, one translation, and grammar without generated commentary", async () => {
  const result = run();
  result.model = "google/gemini-3-flash-preview";
  result.analysis.summary = "Unwanted summary";
  result.analysis.warnings = ["Unwanted warning"];
  result.analysis.regions[0].notes = ["Unwanted interpretation note"];
  result.analysis.regions[0].grammar = [{ pattern: "First pattern", explanation: "First grammar" }];
  result.analysis.regions[1].grammar = [
    { pattern: "Second pattern", explanation: "Second grammar" },
  ];
  const env = harness();
  env.start({ history: { result, imageDataUrl: "fixture:page" } });
  await settle();
  const paragraphs = env.overlay.ui.body.querySelectorAll("p");
  const japanese = paragraphs.filter((node) => node.className === "japanese");
  const translations = paragraphs.filter((node) => node.className === "translation natural");
  assert.equal(japanese.length, 2);
  assert.ok(japanese.every((node) => node.querySelector("button")));
  assert.equal(translations.length, 1);
  assert.equal(translations[0].textContent, "Natural 1\n\nNatural 2");
  assert.match(env.text(env.overlay.ui.grammarRoot), /First grammar.*Second grammar/);
  assert.doesNotMatch(
    env.text(env.overlay.ui.card),
    /Unwanted|Try another model|Select another area/,
  );
  assert.equal(env.overlay.ui.body.querySelector("select"), undefined);
  assert.equal(env.overlay.ui.changeModelButton.attributes["aria-label"], "Change model");
  assert.equal(env.overlay.ui.changeModelButton.textContent, "");
  assert.equal(env.overlay.ui.card.attributes["aria-label"], "Translation");
  assert.match(env.text(env.overlay.ui.body), /Gemini 3 Flash \(Preview\)/);
  assert.match(env.text(env.overlay.ui.body), /Saved translation/);
  assert.doesNotMatch(env.text(env.overlay.ui.body), /google\/|Cached|Manga study/);
  assert.equal(env.overlay.ui.body.querySelector("img").src, "fixture:page");
  assert.deepEqual(env.calls, []);
  env.overlay.ui.cardHeader
    .querySelectorAll("button")
    .find((button) => button.attributes["aria-label"] === "Close card")
    .dispatch("click");
  assert.equal(env.overlay.ui.host, null);
});

test("the model icon toggles its picker without losing the chosen model or exposing floating-point prices", async () => {
  let release;
  const catalog = new Promise((resolve) => {
    release = resolve;
  });
  const env = harness((message) => (message.type === "manga:models" ? catalog : undefined));
  env.start({ history: { result: run(), imageDataUrl: "fixture:page" } });
  const button = env.overlay.ui.changeModelButton;
  assert.equal(button.attributes["aria-expanded"], "false");
  button.dispatch("click");
  assert.equal(button.attributes["aria-expanded"], "true");
  button.dispatch("click");
  assert.equal(button.attributes["aria-expanded"], "false");
  release({
    ok: true,
    catalog: {
      models: [
        {
          id: "other/model",
          name: "Another model",
          prompt_per_million: 0.0000001 * 1e6,
          completion_per_million: 0.123456789,
        },
      ],
    },
  });
  await settle();
  const select = env.overlay.ui.body.querySelector("select");
  assert.equal(select.parent.hidden, true, "a late catalog response must not reopen the picker");
  assert.match(select.children[1].textContent, /\$0\.1 in \/ \$0\.123457 out per 1M/);
  button.dispatch("click");
  select.value = "other/model";
  select.dispatch("change");
  button.dispatch("click");
  assert.equal(select.parent.hidden, true);
  button.dispatch("click");
  assert.equal(button.attributes["aria-expanded"], "true");
  assert.equal(select.parent.hidden, false);
  assert.equal(env.overlay.ui.body.querySelector("select"), select);
  assert.equal(select.value, "other/model");
  assert.equal(env.calls.filter((message) => message.type === "manga:models").length, 1);
  assert.equal(env.calls.filter((message) => message.type === "manga:analyze").length, 0);
  env.overlay.close();
});
