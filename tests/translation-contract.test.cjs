"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { provider, jobs, selection, serviceHarness } = require("./core-helpers.cjs");
const { harness, run, settle } = require("./reader-harness.cjs");

function answer() {
  return {
    japanese: "もう帰らなきゃ。\nえ、まだ雨だよ。",
    translation: "I'd better head home.\nHuh? It's still raining.",
    words: [
      { surface: "帰らなきゃ", reading: "かえらなきゃ", meaning: "have to go home" },
      { surface: "雨", reading: "あめ", meaning: "rain" },
    ],
    grammar: [{ pattern: "なきゃ", explanation: "A casual contraction expressing necessity." }],
  };
}

test("the wire response is shallow and asks only for whole-selection text, translation, vocabulary and grammar", () => {
  const body = provider.payload({ kind: "translation", ...selection(), input: selection() });
  const schema = body.response_format.json_schema.schema;
  assert.deepEqual(schema.required, ["japanese", "translation", "words", "grammar"]);
  assert.deepEqual(Object.keys(schema.properties), schema.required);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.japanese.type, "string");
  assert.equal(schema.properties.translation.type, "string");
  assert.deepEqual(schema.properties.words.items.required, ["surface", "reading", "meaning"]);
  assert.deepEqual(schema.properties.grammar.items.required, ["pattern", "explanation"]);
  assert.match(body.messages[0].content, /one translation in natural English/);
  assert.match(body.messages[0].content, /Translate the entire transcription/);
  assert.match(body.messages[0].content, /Do not add summaries, layout descriptions/);
  for (const name of ["summary", "warnings", "notes", "regions", "order", "id"])
    assert.equal(schema.properties[name], undefined);
});

test("whole-selection output preserves all lines and exact word sources without retaining commentary", () => {
  const input = answer();
  const normalized = provider.validateTranslation({
    ...input,
    summary: "Irrelevant summary",
    warnings: ["Vertical text"],
    notes: ["Guessed speaker"],
  });
  assert.deepEqual(normalized, { regions: [{ id: "selection", order: 1, ...input }] });
  const invalid = answer();
  invalid.words[0].surface = "帰る";
  assert.throws(() => provider.validateTranslation(invalid), /did not match/);
  assert.throws(
    () => provider.validateTranslation({ regions: normalized.regions }),
    /invalid Japanese transcription/,
  );
});

test("a saved whole-selection answer displays its Japanese, translation and grammar without another request", async () => {
  const saved = run();
  saved.analysis = provider.validateTranslation(answer());
  const env = harness();
  env.start({ history: { result: saved, imageDataUrl: "fixture:page" } });
  await settle();
  const text = env.text(env.overlay.ui.body);
  const sourceText = (node) => node.textContent + node.children.map(sourceText).join("");
  const japanese = env.overlay.ui.body
    .querySelectorAll("p")
    .find((node) => node.className === "japanese");
  assert.equal(sourceText(japanese), answer().japanese);
  assert.match(text, /I'd better head home./);
  assert.match(text, /Huh\? It's still raining./);
  assert.match(text, /A casual contraction expressing necessity/);
  assert.equal(
    env.overlay.ui.body.querySelectorAll("button").filter((node) => node.className === "jp-word")
      .length,
    2,
  );
  assert.equal(
    env.calls.filter((message) => ["manga:analyze", "manga:study"].includes(message.type)).length,
    0,
  );
  env.overlay.close();
});

test("the simplified response has a new request identity without discarding a failed request", async (t) => {
  const h = await serviceHarness(t);
  const oldService = new jobs.RequestService({
    store: h.store,
    settings: h.preferences,
    provider: { ...provider, TRANSLATION_VERSION: "manga-extension-selection-v3" },
  });
  const input = { imageDataUrl: selection().imageDataUrl, context: "" };
  const oldKey = await oldService.key("translation", "test/cheap", input);
  const newKey = await h.service.key("translation", "test/cheap", input);
  assert.notEqual(newKey, oldKey);
  const original = h.service.candidate(
    { kind: "translation", model: "test/cheap", input, associations: [] },
    oldKey,
  );
  await h.store.claim(original);
  await h.store.finish(original.id, {
    status: "failed",
    code: "http-400",
    error: "Original provider rejection (HTTP 400).",
    retryable: true,
  });
  const history = await h.service.history(original.id);
  assert.equal(history.job.code, "http-400");
  assert.deepEqual((await h.store.get("jobs", original.id)).input, input);
  assert.equal(h.calls.length, 0);
});
