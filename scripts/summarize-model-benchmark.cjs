"use strict";
// Offline only; never reads credentials or makes requests.
// node scripts/summarize-model-benchmark.cjs --run-name casual-japanese-v1
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { MODELS, SUPPORTED_MODELS } = require("./benchmark-models.cjs");

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const knownNumber = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const normalize = (value) => Array.from(value.normalize("NFKC").replace(/\s/gu, ""));

function characterErrors(reference, actual) {
  const expected = normalize(reference),
    received = normalize(actual);
  let row = Array.from({ length: received.length + 1 }, (_, index) => index);
  for (let index = 0; index < expected.length; index++) {
    const next = [index + 1];
    for (let column = 0; column < received.length; column++) {
      next.push(
        Math.min(
          next[column] + 1,
          row[column + 1] + 1,
          row[column] + (expected[index] === received[column] ? 0 : 1),
        ),
      );
    }
    row = next;
  }
  return { errors: row[received.length], reference_characters: expected.length };
}

function stats(values) {
  const sorted = values.filter(knownNumber).sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    median: sorted.length
      ? sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2
      : null,
    min: sorted.length ? sorted[0] : null,
    max: sorted.length ? sorted.at(-1) : null,
  };
}

function answer(event) {
  const accepted = event?.status === "accepted";
  const regions = accepted ? event.result?.analysis?.regions : [];
  if (
    !Array.isArray(regions) ||
    regions.some(
      (region) =>
        !region ||
        typeof region.japanese !== "string" ||
        typeof region.translation !== "string" ||
        !Array.isArray(region.words) ||
        !Array.isArray(region.grammar) ||
        region.words.some((word) =>
          ["surface", "reading", "meaning"].some((key) => typeof word?.[key] !== "string"),
        ) ||
        region.grammar.some((point) =>
          ["pattern", "explanation"].some((key) => typeof point?.[key] !== "string"),
        ),
    )
  )
    throw new Error("An accepted record does not contain a valid delivered answer.");
  // Explicit allowlist: never copy IDs, raw rejected responses, reasoning or provider metadata.
  return {
    accepted,
    japanese: regions.map((region) => region.japanese).join("\n"),
    translation: regions.map((region) => region.translation).join("\n"),
    words: regions.flatMap((region) =>
      region.words.map(({ surface, reading, meaning }) => ({ surface, reading, meaning })),
    ),
    grammar: regions.flatMap((region) =>
      region.grammar.map(({ pattern, explanation }) => ({ pattern, explanation })),
    ),
  };
}

function summarize(cases, events, runName) {
  if (
    !Array.isArray(cases) ||
    cases.length !== 8 ||
    new Set(cases.map((sample) => sample.id)).size !== 8 ||
    cases.some(
      (sample) => typeof sample.japanese !== "string" || !normalize(sample.japanese).length,
    )
  )
    throw new Error("Expected the eight unique benchmark cases with nonempty Japanese references.");
  const caseIds = new Set(cases.map((sample) => sample.id));
  // The preflight declares the cohort before answers arrive. Retain unattempted
  // models and stable labels when a pilot is resumed with narrower filters.
  const preflights = events.filter((event) => event.type === "preflight");
  const roster = preflights.length ? Object.keys(preflights[0].models || {}) : MODELS;
  if (
    !roster.length ||
    preflights.some((event) =>
      Object.keys(event.models || {}).some((model) => !roster.includes(model)),
    )
  )
    throw new Error(
      "A later preflight expanded the original cohort. Use a separate run for additional models; existing blind labels must not change.",
    );
  if (roster.some((model) => !SUPPORTED_MODELS.includes(model)))
    throw new Error("The preflight contains an unknown benchmark model.");
  const attempts = new Map();
  const requests = new Map();
  for (const event of events) {
    if (!["started", "finished"].includes(event.type)) continue;
    if (
      !roster.includes(event.model) ||
      !caseIds.has(event.sample) ||
      typeof event.request_id !== "string" ||
      !event.request_id
    )
      throw new Error("An attempt has an unknown model/case or a missing request ID.");
    const pair = event.model + "\n" + event.sample;
    if (requests.has(event.request_id) && requests.get(event.request_id) !== pair)
      throw new Error("A request ID is attached to more than one model/case.");
    requests.set(event.request_id, pair);
    const attempt = attempts.get(pair) || {
      requestId: event.request_id,
      started: false,
      finished: null,
    };
    if (attempt.requestId !== event.request_id)
      throw new Error("Multiple attempts exist for one model/case. Review them before scoring.");
    if (event.type === "started") {
      if (attempt.started || attempt.finished)
        throw new Error("An attempt contains a duplicate or out-of-order start record.");
      attempt.started = true;
    } else {
      if (attempt.finished) throw new Error("An attempt contains duplicate finished records.");
      if (!["accepted", "error"].includes(event.status))
        throw new Error("A finished record has an unknown status.");
      attempt.finished = event;
    }
    attempts.set(pair, attempt);
  }

  const shuffled = [...roster].sort((left, right) =>
    hash(`blind-v1\n${runName}\n${left}`).localeCompare(hash(`blind-v1\n${runName}\n${right}`)),
  );
  const key = Object.fromEntries(
    shuffled.map((model, index) => [String.fromCharCode(65 + index), model]),
  );
  const models = roster.map((model) => {
    const samples = cases.flatMap((sample) => {
      const attempt = attempts.get(model + "\n" + sample.id);
      if (!attempt) return [];
      const event = attempt.finished;
      const delivered = answer(event);
      const ocr = characterErrors(sample.japanese, delivered.japanese);
      return [
        {
          sample: sample.id,
          status: event?.status || "unfinished",
          accepted: delivered.accepted,
          exact_ocr: delivered.accepted && ocr.errors === 0,
          ...ocr,
          latency_ms: knownNumber(event?.latency_ms) ? event.latency_ms : null,
          time_to_first_content_ms: knownNumber(event?.time_to_first_content_ms)
            ? event.time_to_first_content_ms
            : null,
          cost_usd: knownNumber(event?.usage?.cost_usd) ? event.usage.cost_usd : null,
          provider: typeof event?.provider === "string" ? event.provider : null,
        },
      ];
    });
    const errors = samples.reduce((sum, sample) => sum + sample.errors, 0);
    const characters = samples.reduce((sum, sample) => sum + sample.reference_characters, 0);
    const cer = characters ? errors / characters : null;
    return {
      model,
      attempts: samples.length,
      finished: samples.filter((sample) => sample.status !== "unfinished").length,
      accepted: samples.filter((sample) => sample.accepted).length,
      rejected: samples.filter((sample) => sample.status === "error").length,
      unfinished: samples.filter((sample) => sample.status === "unfinished").length,
      unattempted: cases.length - samples.length,
      exact_ocr: samples.filter((sample) => sample.exact_ocr).length,
      character_errors: errors,
      reference_characters: characters,
      pooled_cer: cer,
      ocr_score_out_of_25: cer === null ? null : 25 * Math.max(0, 1 - cer),
      completion_latency_ms: stats(samples.map((sample) => sample.latency_ms)),
      accepted_completion_latency_ms: stats(
        samples.filter((sample) => sample.accepted).map((sample) => sample.latency_ms),
      ),
      time_to_first_content_ms: stats(samples.map((sample) => sample.time_to_first_content_ms)),
      actual_cost_usd: Number(
        samples.reduce((sum, sample) => sum + (sample.cost_usd ?? 0), 0).toPrecision(15),
      ),
      missing_cost_attempts: samples.filter((sample) => sample.cost_usd === null).length,
      samples,
    };
  });
  const review = (selected) => ({
    instructions: [
      "Grade without opening metrics.json or blinding-key.json. Labels are stable across both halves and reruns.",
      "English: 0–5 per attempted answer. Readings: credit correctly covered reference targets, accepting listed alternatives and adjacent entries jointly. Grammar: 0–2 per attempted answer.",
      "Use references as semantic guides, allowing valid alternative wording and segmentation. Flag material translation, reading, definition or grammar errors separately.",
      "Rejected or unfinished attempts have empty answers and receive zero quality credit. Unattempted cases are not scored in a partial run.",
    ],
    cases: selected.map((sample) => ({
      id: sample.id,
      reference: {
        japanese: sample.japanese,
        english: sample.reference,
        words: sample.words,
        grammar: sample.grammar,
      },
      answers: Object.fromEntries(
        Object.entries(key).map(([label, model]) => {
          const attempt = attempts.get(model + "\n" + sample.id);
          return [label, { attempted: Boolean(attempt), ...answer(attempt?.finished) }];
        }),
      ),
    })),
  });
  return {
    metrics: {
      run: runName,
      normalization:
        "NFKC, remove whitespace, retain punctuation and order; Unicode code-point Levenshtein distance",
      denominator:
        "Attempted cases only; rejected and unfinished attempts count as empty transcripts. Completion latency includes all finished attempts with known latency; accepted-only latency is also reported.",
      models,
    },
    blindingKey: { labels: key },
    firstHalf: review(cases.slice(0, 4)),
    secondHalf: review(cases.slice(4)),
  };
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--help") {
    console.log("Offline usage: node scripts/summarize-model-benchmark.cjs --run-name NAME");
    return;
  }
  if (argv.length && (argv.length !== 2 || argv[0] !== "--run-name"))
    throw new Error("Use --run-name NAME. This summarizer is always offline.");
  const name = argv[1] || "casual-japanese-v1";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name))
    throw new Error("Run names must contain 1–64 letters, numbers, hyphens, or underscores.");
  const root = path.resolve(__dirname, "..");
  const directory = path.join(root, "test-results", "model-benchmark", name);
  const source = fs.readFileSync(path.join(directory, "events.jsonl"), "utf8");
  if (source && !source.endsWith("\n"))
    throw new Error(
      "The event log ends with an incomplete record. Summarize after that write completes.",
    );
  const events = source
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid event JSON at record ${index + 1}.`);
      }
    });
  const caseSource = fs.readFileSync(
    path.join(root, "benchmarks", "casual-japanese", "cases.json"),
    "utf8",
  );
  if (events.some((event) => event.type === "preflight" && event.cases_sha256 !== hash(caseSource)))
    throw new Error(
      "The case references have changed since this run's preflight; do not score against different references.",
    );
  const result = summarize(JSON.parse(caseSource), events, name);
  for (const [file, content] of [
    ["metrics.json", result.metrics],
    ["review-first-half.json", result.firstHalf],
    ["review-second-half.json", result.secondHalf],
    ["blinding-key.json", result.blindingKey],
  ])
    fs.writeFileSync(path.join(directory, file), JSON.stringify(content, null, 2) + "\n");
  console.log(
    `Wrote metrics and both blinded review files in ${directory}. Model labels are kept in blinding-key.json; do not open it before grading.`,
  );
}

module.exports = { main, summarize, characterErrors, stats };
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || "Could not summarize the benchmark.");
    process.exitCode = 1;
  }
}
