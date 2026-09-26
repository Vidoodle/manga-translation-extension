"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require("../scripts/summarize-model-benchmark.cjs");

const cases = Array.from({ length: 8 }, (_, index) => ({
  id: "case-" + index,
  japanese: "猫。",
  reference: "Cat.",
  words: { 猫: ["ねこ"] },
  grammar: "None",
}));
const roster = ["anthropic/claude-sonnet-5", "deepseek/deepseek-v4.1-flash"];
const preflight = {
  type: "preflight",
  models: Object.fromEntries(roster.map((model) => [model, {}])),
};
const started = { type: "started", model: roster[0], sample: cases[0].id, request_id: "one" };
const finished = {
  ...started,
  type: "finished",
  status: "accepted",
  latency_ms: 1000,
  usage: { cost_usd: 0.001 },
  result: {
    analysis: { regions: [{ japanese: "猫。", translation: "Cat.", words: [], grammar: [] }] },
  },
};

test("broader summaries retain the declared cohort and stable blind labels across a pilot", () => {
  const pilot = summarize(cases, [preflight, started], "broader-fixture");
  const completed = summarize(cases, [preflight, started, finished], "broader-fixture");
  const narrowedResume = summarize(
    cases,
    [preflight, started, finished, { type: "preflight", models: { [roster[0]]: {} } }],
    "broader-fixture",
  );
  assert.deepEqual(narrowedResume.blindingKey, pilot.blindingKey);
  assert.deepEqual(narrowedResume.metrics.models, completed.metrics.models);
  assert.deepEqual(completed.blindingKey, pilot.blindingKey);
  assert.deepEqual(
    completed.metrics.models.map((item) => item.model),
    roster,
  );
  assert.equal(completed.metrics.models[0].accepted, 1);
  assert.equal(completed.metrics.models[0].exact_ocr, 1);
  assert.equal(completed.metrics.models[1].attempts, 0);
  assert.equal(completed.metrics.models[1].pooled_cer, null);
  const exported = JSON.stringify(completed.firstHalf);
  for (const privateDetail of [...roster, "cost_usd", "latency_ms", "request_id"])
    assert.equal(exported.includes(privateDetail), false);
});

test("a later expanded cohort cannot silently reassign existing anonymous grades", () => {
  assert.throws(
    () =>
      summarize(
        cases,
        [
          preflight,
          started,
          finished,
          { type: "preflight", models: { [roster[0]]: {}, "z-ai/glm-5.3-flash": {} } },
        ],
        "broader-fixture",
      ),
    /expanded the original cohort.*existing blind labels/,
  );
});

test("quality denominators include rejected and unfinished attempts but exclude unattempted cases", () => {
  const failedStart = { ...started, sample: cases[1].id, request_id: "failed" };
  const failed = {
    ...failedStart,
    type: "finished",
    status: "error",
    latency_ms: 200,
    usage: { cost_usd: 0.002 },
  };
  const unfinished = { ...started, sample: cases[2].id, request_id: "unfinished" };
  const result = summarize(
    cases,
    [preflight, started, finished, failedStart, failed, unfinished],
    "denominator-fixture",
  );
  const model = result.metrics.models[0];
  assert.equal(model.attempts, 3);
  assert.equal(model.accepted, 1);
  assert.equal(model.rejected, 1);
  assert.equal(model.unfinished, 1);
  assert.equal(model.unattempted, 5);
  assert.equal(model.reference_characters, 6);
  assert.equal(model.character_errors, 4);
  assert.equal(model.pooled_cer, 2 / 3);
  assert.ok(Math.abs(model.ocr_score_out_of_25 - 25 / 3) < 1e-12);
  assert.equal(model.actual_cost_usd, 0.003);
  assert.equal(model.missing_cost_attempts, 1);
  assert.equal(model.completion_latency_ms.median, 600);
  assert.equal(model.accepted_completion_latency_ms.median, 1000);
  const label = Object.keys(result.blindingKey.labels).find(
    (key) => result.blindingKey.labels[key] === roster[0],
  );
  assert.deepEqual(
    result.firstHalf.cases.map((sample) => [
      sample.answers[label].attempted,
      sample.answers[label].japanese,
    ]),
    [
      [true, "猫。"],
      [true, ""],
      [true, ""],
      [false, ""],
    ],
  );
});

test("summaries reject undeclared models and duplicate attempts instead of hiding failures", () => {
  assert.throws(
    () => summarize(cases, [preflight, { ...started, model: "vendor/unknown" }], "test"),
    /unknown model/,
  );
  assert.throws(
    () =>
      summarize(cases, [preflight, started, finished, { ...started, request_id: "retry" }], "test"),
    /Multiple attempts/,
  );
});
