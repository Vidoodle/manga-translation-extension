"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { main, MODELS, SUPPORTED_MODELS } = require("../scripts/benchmark-models.cjs");
const provider = require("../src/background/provider.js");
const ADDITIONAL_MODELS = [
  "deepseek/deepseek-v4.1-flash",
  "anthropic/claude-haiku-4.5",
  "anthropic/claude-sonnet-5",
  "z-ai/glm-5.3-flash",
  "minimax/minimax-m3",
  "mistralai/mistral-small-2603",
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manga-benchmark-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, "benchmarks", "casual-japanese");
  fs.mkdirSync(path.join(folder, "images"), { recursive: true });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK2kAAAAASUVORK5CYII=",
    "base64",
  );
  for (const id of ["one", "two"]) fs.writeFileSync(path.join(folder, "images", id + ".png"), png);
  fs.writeFileSync(
    path.join(folder, "cases.json"),
    JSON.stringify(
      ["one", "two"].map((id) => ({
        id,
        image: `images/${id}.png`,
        japanese: "gold transcript must not be sent",
        reference: "gold translation must not be sent",
        words: [],
        grammar: [],
      })),
    ),
  );
  const logs = [];
  const key = "sk-or-v1-synthetic-benchmark-secret";
  const dependencies = { root, env: { OPENROUTER_API_KEY: key }, log: (value) => logs.push(value) };
  const output = path.join(root, "test-results", "model-benchmark", "offline", "events.jsonl");
  const records = () =>
    fs.existsSync(output) ? fs.readFileSync(output, "utf8").trim().split("\n").map(JSON.parse) : [];
  return { root, logs, key, dependencies, output, records };
}

function catalog(price = "0.000001", { models = MODELS, pricing = {} } = {}) {
  return new Response(
    JSON.stringify({
      data: models.map((id) => ({
        id,
        architecture: { input_modalities: ["image"], output_modalities: ["text"] },
        supported_parameters: ["structured_outputs"],
        pricing: {
          prompt: price,
          completion: price,
          web_search: "0.01",
          audio: "1",
          input_audio_cache: "1",
          input_cache_write: "0.000001",
          ...pricing,
        },
      })),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

function completion({
  cost = 0.001,
  invalid = false,
  finishReason = "stop",
  malformedJson = false,
  done = true,
} = {}) {
  const value = {
    japanese: "もう帰らなきゃ。",
    translation: "I have to go home.",
    words: invalid ? [{ surface: "not in the transcription", reading: "", meaning: "" }] : [],
    grammar: [],
  };
  return new Response(
    [
      {
        id: "generation-offline",
        provider: "Fixture Provider",
        choices: [
          {
            delta: {
              content: malformedJson ? "{unfinished JSON" : JSON.stringify(value),
              reasoning: "PRIVATE_REASONING_SENTINEL",
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: finishReason }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 30,
          completion_tokens_details: { reasoning_tokens: 10 },
          ...(cost === null ? {} : { cost }),
        },
      },
      ...(done ? ["[DONE]"] : []),
    ]
      .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`)
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

test("benchmark dry-run reads no key, makes no network calls, writes nothing, and rotates the plan", async (t) => {
  const h = fixture(t);
  const result = await main(["--run-name", "offline"], {
    ...h.dependencies,
    env: {},
    fetcher: () => assert.fail("Dry-run must not use the network"),
    loadEnvFile: () => assert.fail("Dry-run must not load a key"),
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.remaining, 10);
  assert.equal(MODELS.length, 5, "Adding supported models must not expand default paid work");
  assert.ok(result.estimated < 1);
  assert.equal(fs.existsSync(path.dirname(h.output)), false);
  const summary = JSON.parse(h.logs[0]);
  assert.deepEqual(
    summary.requests.slice(0, 5).map((request) => request.model),
    MODELS,
  );
  assert.deepEqual(
    summary.requests.slice(5).map((request) => request.model),
    [...MODELS.slice(1), MODELS[0]],
  );
  assert.deepEqual(summary.requests[0].reasoning, { effort: "minimal" });
  assert.equal(summary.requests[0].max_tokens, 8192);
});

test("additional models require an explicit filter and keep production payload identities and resume behavior", async (t) => {
  const h = fixture(t);
  assert.deepEqual(SUPPORTED_MODELS, [...MODELS, ...ADDITIONAL_MODELS]);
  const filter = ["--run-name", "offline", "--model", ADDITIONAL_MODELS.join(",")];
  await main(filter, {
    ...h.dependencies,
    fetcher: () => assert.fail("Planning additional models remains offline"),
  });
  const summary = JSON.parse(h.logs[0]);
  assert.equal(summary.selected, 12);
  assert.ok(Number.isFinite(summary.estimated_remaining_bound_usd));
  assert.deepEqual(
    summary.requests.slice(0, 6).map((item) => item.model),
    ADDITIONAL_MODELS,
  );
  assert.deepEqual(
    summary.requests.slice(6).map((item) => item.model),
    [...ADDITIONAL_MODELS.slice(1), ADDITIONAL_MODELS[0]],
  );
  let submits = 0;
  const deps = {
    ...h.dependencies,
    fetcher: async (url, request) => {
      if (url.endsWith("/models")) return catalog(undefined, { models: ADDITIONAL_MODELS });
      submits++;
      const body = JSON.parse(request.body);
      assert.ok(ADDITIONAL_MODELS.includes(body.model));
      assert.deepEqual(
        body,
        provider.payload({
          kind: "translation",
          model: body.model,
          input: { imageDataUrl: body.messages[1].content[1].image_url.url, context: "" },
        }),
      );
      return completion();
    },
  };
  const flags = ["--run", ...filter, "--sample", "one"];
  assert.equal((await main(flags, deps)).completed, 6);
  const attempts = h.records().filter((event) => event.type === "started");
  assert.deepEqual(
    attempts.map((event) => event.request_id),
    summary.requests.slice(0, 6).map((event) => event.request_id),
  );
  assert.equal((await main(flags, deps)).completed, 0);
  assert.equal(submits, 6);
  await assert.rejects(main(["--model", "vendor/not-reviewed"], deps), /supported benchmark model/);
});

test("live pricing uses each component's maximum override and the highest cache-write duration", async (t) => {
  const h = fixture(t);
  const model = ADDITIONAL_MODELS[0];
  await main(["--run", "--run-name", "offline", "--model", model, "--sample", "one"], {
    ...h.dependencies,
    fetcher: async (url) =>
      url.endsWith("/models")
        ? catalog(undefined, {
            models: [model],
            pricing: {
              input_cache_write: "0.000003",
              input_cache_write_1h: "0.000002",
              image: "0.001",
              request: "0.004",
              overrides: [
                {
                  utc_days: ["sunday"],
                  prompt: "0.000002",
                  completion: "0.0000005",
                  input_cache_write: "0.000001",
                  input_cache_write_1h: "0.000004",
                  image: "0.0005",
                  request: "0.003",
                },
                {
                  min_prompt_tokens: 272000,
                  completion: "0.000004",
                  image: "0.003",
                  request: "0.002",
                },
              ],
            },
          })
        : completion(),
  });
  const preflight = h.records().find((event) => event.type === "preflight");
  assert.deepEqual(preflight.models[model], {
    prompt: 0.000002,
    completion: 0.000004,
    input_cache_write: 0.000004,
    image: 0.003,
    request: 0.004,
  });
  assert.ok(Math.abs(preflight.remaining_bound_usd - 0.099768) < 1e-12);
});

test("higher override prices and one-hour cache writes block an over-budget plan before any paid call", async (t) => {
  for (const [key, value] of Object.entries({
    prompt: "0.0001",
    completion: "0.000125",
    input_cache_write: "0.0001",
    input_cache_write_1h: "0.0001",
    image: "1",
    request: "1",
  })) {
    const h = fixture(t);
    await assert.rejects(
      main(["--run", "--run-name", "offline", "--model", ADDITIONAL_MODELS[0], "--sample", "one"], {
        ...h.dependencies,
        fetcher: async (url) => {
          assert.ok(url.endsWith("/models"), `${key} must block before a paid request`);
          return catalog(undefined, {
            models: [ADDITIONAL_MODELS[0]],
            pricing: { overrides: [{ [key]: value }] },
          });
        },
      }),
      /exceeds.*budget/,
    );
    assert.equal(h.records().length, 0);
  }
});

test("live mode uses the production payload, records attempts before sending, and resumes without repeating pairs", async (t) => {
  const h = fixture(t);
  const calls = [];
  const deps = {
    ...h.dependencies,
    fetcher: async (url, request) => {
      calls.push(url);
      if (url === provider.API + "/models") {
        assert.equal(request.headers, undefined, "Catalog preflight is public");
        return catalog();
      }
      assert.equal(url, provider.API + "/chat/completions");
      assert.equal(h.records().at(-1).type, "started");
      const payload = JSON.parse(request.body);
      assert.deepEqual(
        payload,
        provider.payload({
          kind: "translation",
          model: MODELS[0],
          input: { imageDataUrl: payload.messages[1].content[1].image_url.url, context: "" },
        }),
      );
      assert.equal(request.headers.Authorization, "Bearer " + h.key);
      assert.doesNotMatch(request.body, /gold transcript|gold translation/);
      return completion();
    },
  };
  const flags = ["--run", "--run-name", "offline", "--model", MODELS[0]];
  assert.equal((await main([...flags, "--sample", "one"], deps)).completed, 1);
  assert.equal((await main(flags, deps)).completed, 1);
  const before = calls.length;
  assert.equal((await main(flags, deps)).completed, 0);
  assert.equal(calls.length, before);
  const finished = h.records().filter((event) => event.type === "finished");
  assert.equal(finished.length, 2);
  assert.ok(
    finished.every((event) => event.status === "accepted" && event.time_to_first_content_ms >= 0),
  );
  assert.equal(finished[0].provider, "Fixture Provider");
  assert.equal(finished[0].usage.reasoning_tokens, 10);
  assert.equal(finished[0].result.analysis.regions[0].translation, "I have to go home.");
  assert.equal(h.logs.join("\n").includes(h.key), false);
  assert.equal(fs.readFileSync(h.output, "utf8").includes(h.key), false);
});

test("a changed payload cannot resubmit an attempted model/sample under the same run name", async (t) => {
  const h = fixture(t);
  fs.mkdirSync(path.dirname(h.output), { recursive: true });
  const identity = {
    request_id: "previous-prompt-or-reasoning-profile",
    sample: "one",
    model: MODELS[0],
  };
  fs.writeFileSync(
    h.output,
    [
      { ...identity, type: "started", estimated_bound_usd: 0.01 },
      { ...identity, type: "finished", status: "accepted", usage: { cost_usd: 0.001 } },
    ]
      .map((event) => JSON.stringify(event) + "\n")
      .join(""),
  );
  const deps = {
    ...h.dependencies,
    env: {},
    loadEnvFile: () => assert.fail("Payload mismatch must stop before loading any key"),
    fetcher: () => assert.fail("Payload mismatch must stop before any network request"),
  };
  await assert.rejects(
    main(["--run", "--run-name", "offline", "--model", MODELS[0], "--sample", "one"], deps),
    /different request payload.*fresh run name/,
  );
  assert.equal(h.records().length, 2);
  const fresh = await main(["--run-name", "fresh", "--model", MODELS[0], "--sample", "one"], deps);
  assert.equal(fresh.remaining, 1);
});

test("changed references and an expanded cohort stop before key loading or further requests", async (t) => {
  for (const change of ["references", "cohort"]) {
    const h = fixture(t);
    await main(["--run", "--run-name", "offline", "--model", MODELS[0], "--sample", "one"], {
      ...h.dependencies,
      fetcher: async (url) => (url.endsWith("/models") ? catalog() : completion()),
    });
    const originalLog = fs.readFileSync(h.output, "utf8");
    if (change === "references") {
      const file = path.join(h.root, "benchmarks", "casual-japanese", "cases.json");
      const cases = JSON.parse(fs.readFileSync(file, "utf8"));
      cases[0].reference = "A revised reference with the same image and request payload";
      fs.writeFileSync(file, JSON.stringify(cases));
    }
    await assert.rejects(
      main(
        [
          "--run",
          "--run-name",
          "offline",
          "--model",
          change === "cohort" ? [MODELS[0], ADDITIONAL_MODELS[0]].join(",") : MODELS[0],
        ],
        {
          ...h.dependencies,
          env: {},
          loadEnvFile: () => assert.fail("Resume guards must stop before key loading"),
          fetcher: () => assert.fail("Resume guards must stop before networking"),
        },
      ),
      change === "references"
        ? /cases have changed.*fresh run name/
        : /expand.*original cohort.*fresh run name/,
    );
    assert.equal(fs.readFileSync(h.output, "utf8"), originalLog);
  }
});

test("validation failures retain the same response's raw JSON and cost and are never retried", async (t) => {
  const h = fixture(t);
  let submits = 0;
  const deps = {
    ...h.dependencies,
    fetcher: async (url) =>
      url.endsWith("/models") ? catalog() : (++submits, completion({ invalid: true })),
  };
  const flags = ["--run", "--run-name", "offline", "--model", MODELS[0], "--sample", "one"];
  assert.equal((await main(flags, deps)).completed, 1);
  const event = h.records().at(-1);
  assert.equal(event.status, "error");
  assert.equal(event.error.code, "invalid-output");
  assert.equal(event.usage.cost_usd, 0.001);
  assert.equal(event.raw_answer.words[0].surface, "not in the transcription");
  assert.equal((await main(flags, deps)).completed, 0);
  assert.equal(submits, 1);
});

test("terminal length and JSON failures retain charged usage without accepting or retrying the answer", async (t) => {
  for (const responseOptions of [{ finishReason: "length" }, { malformedJson: true }]) {
    const h = fixture(t);
    let submits = 0;
    const deps = {
      ...h.dependencies,
      fetcher: async (url) =>
        url.endsWith("/models") ? catalog() : (++submits, completion(responseOptions)),
    };
    const flags = ["--run", "--run-name", "offline", "--model", MODELS[0], "--sample", "one"];
    const result = await main(flags, deps);
    assert.equal(result.completed, 1);
    assert.equal(result.spent, 0.001);
    const event = h.records().at(-1);
    assert.equal(event.status, "error");
    assert.equal(event.error.code, "invalid-output");
    assert.equal(event.result, null, "Observed metadata must never bypass production validation");
    assert.equal(event.usage.cost_usd, 0.001);
    assert.equal(event.usage.reasoning_tokens, 10);
    assert.equal(event.provider, "Fixture Provider");
    assert.equal(event.generation_id, "generation-offline");
    assert.equal(event.finish_reason, responseOptions.finishReason || "stop");
    assert.equal(fs.readFileSync(h.output, "utf8").includes("PRIVATE_REASONING_SENTINEL"), false);
    assert.equal((await main(flags, deps)).completed, 0);
    assert.equal(submits, 1);
  }
});

test("an unfinished stream cannot promote intermediate usage to a known final charge", async (t) => {
  const h = fixture(t);
  const result = await main(
    ["--run", "--run-name", "offline", "--model", MODELS[0], "--sample", "one"],
    {
      ...h.dependencies,
      fetcher: async (url) => (url.endsWith("/models") ? catalog() : completion({ done: false })),
    },
  );
  assert.equal(result.stopped, "unknown-cost");
  const event = h.records().at(-1);
  assert.equal(event.status, "error");
  assert.equal(event.error.code, "interrupted");
  assert.equal(event.usage.cost_usd, null);
  assert.equal(event.generation_id, "generation-offline");
});

test("unknown cost stops before the next sample and blocks an automatic resume", async (t) => {
  const h = fixture(t);
  let submits = 0;
  const deps = {
    ...h.dependencies,
    fetcher: async (url) =>
      url.endsWith("/models") ? catalog() : (++submits, completion({ cost: null })),
  };
  const flags = ["--run", "--run-name", "offline", "--model", MODELS[0]];
  const result = await main(flags, deps);
  assert.equal(result.stopped, "unknown-cost");
  assert.equal(submits, 1);
  await assert.rejects(main(flags, deps), /unknown cost/);
  await assert.rejects(main([...flags, "--reserve-rate-limits"], deps), /unknown cost/);
  assert.equal(submits, 1);
});

test("explicit rate-limit reservation resumes remaining pairs without retrying or inventing a charge", async (t) => {
  const h = fixture(t);
  let submits = 0;
  const deps = {
    ...h.dependencies,
    fetcher: async (url) => {
      if (url.endsWith("/models")) return catalog();
      return ++submits === 1 ? new Response("Rate limited", { status: 429 }) : completion();
    },
  };
  const flags = ["--run", "--run-name", "offline", "--model", MODELS[0]];
  assert.equal((await main(flags, deps)).stopped, "unknown-cost");
  const intent = h.records().find((event) => event.type === "started");
  await assert.rejects(main(flags, deps), /unknown cost/);
  assert.equal(submits, 1);
  const result = await main([...flags, "--reserve-rate-limits"], deps);
  assert.equal(result.completed, 1);
  assert.equal(result.spent, 0.001);
  assert.equal(result.reserved_unknown_cost_usd, intent.estimated_bound_usd);
  assert.equal(submits, 2);
  const failed = h.records().find((event) => event.type === "finished" && event.status === "error");
  assert.equal(failed.error.code, "http-429");
  assert.equal(failed.error.uncertain, false);
  assert.equal(failed.usage.cost_usd, null);
  assert.equal((await main([...flags, "--reserve-rate-limits"], deps)).completed, 0);
  assert.equal(submits, 2);
});

test("explicit reservation can continue after a new HTTP 429 but still consumes the run budget", async (t) => {
  const h = fixture(t);
  let submits = 0;
  const flags = ["--run", "--run-name", "offline", "--model", MODELS[0], "--reserve-rate-limits"];
  const deps = {
    ...h.dependencies,
    fetcher: async (url) => {
      if (url.endsWith("/models")) return catalog();
      return ++submits === 1 ? new Response("Rate limited", { status: 429 }) : completion();
    },
  };
  const result = await main(flags, deps);
  assert.equal(result.completed, 2);
  assert.equal(result.stopped, undefined);
  assert.equal(result.spent, 0.001);
  assert.equal(
    result.reserved_unknown_cost_usd,
    h.records().find((event) => event.type === "started").estimated_bound_usd,
  );

  const budget = fixture(t);
  await main([...flags, "--sample", "one"], {
    ...budget.dependencies,
    fetcher: async (url) =>
      url.endsWith("/models") ? catalog() : new Response("Rate limited", { status: 429 }),
  });
  await assert.rejects(
    main(flags, {
      ...budget.dependencies,
      fetcher: async (url) => {
        assert.ok(
          url.endsWith("/models"),
          "The reserved unknown charge must block the next paid call",
        );
        return catalog("0.000054"); // One remaining bound fits $1 alone, but not with the prior reservation.
      },
    }),
    /exceeds.*budget/,
  );
});

test("rate-limit continuation never authorizes an interrupted attempt with no final outcome", async (t) => {
  const h = fixture(t);
  fs.mkdirSync(path.dirname(h.output), { recursive: true });
  fs.writeFileSync(
    h.output,
    JSON.stringify({ type: "started", request_id: "interrupted", estimated_bound_usd: 0.01 }) +
      "\n",
  );
  await assert.rejects(
    main(["--run", "--run-name", "offline", "--reserve-rate-limits"], {
      ...h.dependencies,
      fetcher: () => assert.fail("Interrupted attempts must stop before any network request"),
    }),
    /no final record/,
  );
});

test("account errors are redacted and the live budget preflight blocks an expensive plan", async (t) => {
  const h = fixture(t);
  let submits = 0;
  const flags = ["--run", "--run-name", "offline", "--model", MODELS[0]];
  await assert.rejects(
    main(flags, {
      ...h.dependencies,
      fetcher: async (url) => {
        assert.equal(url, provider.API + "/models");
        return catalog("1");
      },
    }),
    /exceeds.*budget/,
  );
  assert.equal(h.records().length, 0);
  const result = await main(flags, {
    ...h.dependencies,
    fetcher: async (url) => {
      if (url.endsWith("/models")) return catalog();
      submits++;
      return new Response(JSON.stringify({ error: { message: h.key } }), { status: 401 });
    },
  });
  assert.equal(result.stopped, "unknown-cost");
  assert.equal(submits, 1);
  assert.equal(h.records().at(-1).error.code, "http-401");
  assert.equal(fs.readFileSync(h.output, "utf8").includes(h.key), false);
  assert.equal(h.logs.join("\n").includes(h.key), false);
});
