const test = require("node:test");
const assert = require("node:assert/strict");
const { provider, analysis, PNG } = require("./core-helpers.cjs");

function stream(events, chunkSize = 11) {
  const source = events
    .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\r\n\r\n`)
    .join("");
  const bytes = new TextEncoder().encode(source);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let index = 0; index < bytes.length; index += chunkSize)
          controller.enqueue(bytes.slice(index, index + chunkSize));
        controller.close();
      },
    }),
  );
}

function translation() {
  const { japanese, translation, words, grammar } = analysis().regions[0];
  return { japanese, translation, words, grammar };
}

function completeEvents(value = translation()) {
  return [
    {
      id: "generation-test",
      choices: [{ delta: { content: JSON.stringify(value) }, finish_reason: null }],
    },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 123, completion_tokens: 45, cost: 0.0002 } },
    "[DONE]",
  ];
}

test("SSE parsing survives arbitrary UTF-8 and CRLF boundaries and retains final usage", async () => {
  const progress = [];
  const result = await provider.streamResult(stream(completeEvents(), 1), (value) =>
    progress.push(value),
  );

  assert.equal(result.value.japanese, "もう帰らなきゃ。");
  assert.equal(result.usage.cost_usd, 0.0002);
  assert.equal(result.usage.reasoning_tokens, null);
  assert.equal(result.generation_id, "generation-test");
  assert.ok(progress.some((value) => value.receivedCharacters > 0));
});

test("missing DONE or finish marker is an unknown outcome, never an accepted partial answer", async () => {
  for (const events of [completeEvents().slice(0, -1), [completeEvents()[0], "[DONE]"]]) {
    await assert.rejects(
      provider.streamResult(stream(events)),
      (error) => error.uncertain === true && error.code === "interrupted",
    );
  }
});

test("malformed and provider-error events are interrupted; truncated structured output is rejected", async () => {
  await assert.rejects(
    provider.streamResult(stream(["{broken", "[DONE]"])),
    (error) => error.uncertain,
  );
  await assert.rejects(
    provider.streamResult(stream([{ error: { message: "upstream failure" } }, "[DONE]"])),
    (error) => error.uncertain,
  );
  await assert.rejects(
    provider.streamResult(
      stream([{ choices: [{ delta: { content: "{broken" }, finish_reason: "length" }] }, "[DONE]"]),
    ),
    (error) => error.code === "invalid-output",
  );
});

test("missing cost stays unknown and malformed JSON is rejected after a complete stream", async () => {
  const events = completeEvents();
  events[2] = { choices: [], usage: {} };
  const result = await provider.streamResult(stream(events));
  assert.equal(result.usage.cost_usd, null);

  events[0].choices[0].delta.content = "{broken";
  await assert.rejects(
    provider.streamResult(stream(events)),
    (error) => error.code === "invalid-output",
  );
});

test("requests use only the selected image, exact model and fixed endpoint with no provider fallback", async () => {
  const calls = [];
  const job = {
    id: "job",
    resultId: "run",
    kind: "translation",
    model: "vendor/cheap",
    input: { imageDataUrl: PNG, context: "Speaker is leaving" },
  };
  const result = await provider.complete(job, "secret-key", {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return stream(completeEvents());
    },
  });
  const body = JSON.parse(calls[0].options.body);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(body.model, "vendor/cheap");
  assert.equal(body.models, undefined);
  assert.equal(body.reasoning, undefined);
  assert.equal(body.messages[1].content[1].image_url.url, PNG);
  assert.equal(result.model, "vendor/cheap");
  assert.equal(result.prompt_version, "manga-extension-selection-v4");
  assert.equal(result.analysis.regions[0].id, "selection");
  assert.equal(result.analysis.regions[0].translation, "I'd better head home.");
  assert.deepEqual(result.analysis.regions[0].words, analysis().regions[0].words);
  assert.deepEqual(result.analysis.regions[0].grammar, analysis().regions[0].grammar);
  assert.equal(result.analysis.regions[0].close_translation, undefined);
  assert.equal(result.analysis.regions[0].natural_translation, undefined);
  assert.equal(JSON.stringify(result).includes("secret-key"), false);
  assert.equal(result.analysis.regions[0].bbox, undefined);
});

test("reading models send only their supported reasoning controls and record the actual request", async () => {
  const configurations = [
    ["google/gemini-3.1-flash-lite", { effort: "minimal" }],
    ["openai/gpt-6-luna", { effort: "low" }],
    ["qwen/qwen3.8-flash", { max_tokens: 1024 }],
    ["google/gemini-3-flash-preview", { effort: "low" }],
    ["google/gemini-3.1-pro-preview", { effort: "low" }],
    ["google/gemini-3.8-flash", { effort: "low" }],
    ["deepseek/deepseek-v4.1-flash", { effort: "low" }],
    ["anthropic/claude-sonnet-5", { effort: "low" }],
    ["z-ai/glm-5.3-flash", { effort: "low" }],
  ];
  for (const [model, reasoning] of configurations) {
    let calls = 0;
    const result = await provider.complete(
      { kind: "translation", model, input: { imageDataUrl: PNG, context: "" } },
      "test-key",
      {
        fetcher: async (_url, options) => {
          calls++;
          const body = JSON.parse(options.body);
          assert.equal(body.model, model);
          assert.deepEqual(body.reasoning, reasoning, model);
          assert.equal(body.reasoning_effort, undefined);
          assert.equal(body.thinking_budget, undefined);
          assert.deepEqual(body.provider, { require_parameters: true });
          assert.equal(body.response_format.json_schema.strict, true);
          assert.equal(body.max_tokens, 8192);
          return stream(completeEvents());
        },
      },
    );
    assert.equal(calls, 1);
    assert.deepEqual(result.reasoning, {
      requested: true,
      ...reasoning,
      profile: provider.PROFILE,
    });
    assert.deepEqual(
      provider.payload({ kind: "study", model, input: { source: {} } }).reasoning,
      reasoning,
    );
  }
});

test("models without an explicit reasoning profile keep provider settings and payload mutation cannot change later requests", () => {
  for (const model of [
    "vendor/cheap",
    "openai/future-model",
    "qwen/qwen3.8-flash:free",
    "anthropic/claude-haiku-4.5",
    "minimax/minimax-m3",
    "mistralai/mistral-small-2603",
  ]) {
    assert.equal(provider.payload({ kind: "translation", model, input: {} }).reasoning, undefined);
  }
  const job = { kind: "translation", model: "openai/gpt-6-luna", input: {} };
  provider.payload(job).reasoning.effort = "high";
  assert.deepEqual(provider.payload(job).reasoning, { effort: "low" });
});

test("Qwen array-shaped answers remain invalid and never cause a second paid request", async () => {
  for (const value of [[], [translation()]]) {
    let calls = 0;
    await assert.rejects(
      provider.complete(
        {
          kind: "translation",
          model: "qwen/qwen3.8-flash",
          input: { imageDataUrl: PNG, context: "" },
        },
        "fixture-key",
        {
          fetcher: async () => {
            calls++;
            return stream(completeEvents(value));
          },
        },
      ),
      (error) => error.code === "invalid-output",
    );
    assert.equal(calls, 1);
  }
});

test("an upstream shared-pool rate limit identifies provider capacity without exposing raw diagnostics", async () => {
  let calls = 0;
  await assert.rejects(
    provider.complete(
      {
        kind: "translation",
        model: "qwen/qwen3.8-flash",
        input: { imageDataUrl: PNG, context: "" },
      },
      "fixture-key",
      {
        fetcher: async () => {
          calls++;
          return Response.json(
            {
              error: {
                code: 429,
                message: "Provider returned error",
                metadata: {
                  provider_name: "Alibaba",
                  limit_source: "upstream_provider_shared_pool",
                  raw: "private upstream response fixture-key",
                },
              },
            },
            { status: 429 },
          );
        },
      },
    ),
    (error) => {
      assert.equal(error.code, "http-429");
      assert.equal(error.uncertain, false);
      assert.match(error.message, /shared provider capacity/);
      assert.match(error.message, /provider: Alibaba/);
      assert.doesNotMatch(
        error.message,
        /account limit|free-model quota|private upstream|fixture-key/,
      );
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("transport failure is marked uncertain and is not retried", async () => {
  let calls = 0;
  const job = {
    kind: "translation",
    model: "test/cheap",
    input: { imageDataUrl: PNG, context: "" },
  };
  await assert.rejects(
    provider.complete(job, "secret-key", {
      fetcher: async () => {
        calls++;
        throw new TypeError("Network failed with private details");
      },
    }),
    (error) => error.uncertain && !error.message.includes("private details"),
  );
  assert.equal(calls, 1);
});

test("HTTP 429 explains possible capacity or account limits without retries or raw errors", async () => {
  for (const model of ["qwen/qwen3.8-27b:free", "vendor/paid"]) {
    const calls = [];
    await assert.rejects(
      provider.complete(
        { kind: "translation", model, input: { imageDataUrl: PNG, context: "" } },
        "secret-test-key",
        {
          fetcher: async (url, options) => {
            calls.push(JSON.parse(options.body));
            return {
              ok: false,
              status: 429,
              async json() {
                assert.fail("Raw provider errors must not be read or exposed");
              },
              async text() {
                assert.fail("Raw provider errors must not be read or exposed");
              },
            };
          },
        },
      ),
      (error) => {
        assert.equal(error.code, "http-429");
        assert.equal(error.retryable, true);
        assert.match(error.message, /may be provider capacity.*HTTP 429/);
        assert.match(
          error.message,
          /Check your OpenRouter limits.*try again later.*choose another model/,
        );
        if (model.endsWith(":free")) assert.match(error.message, /OpenRouter free-model quota/);
        else {
          assert.match(error.message, /OpenRouter account limit/);
          assert.doesNotMatch(error.message, /free-model quota/);
        }
        assert.doesNotMatch(error.message, /secret-test-key/);
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, model);
    assert.equal(calls[0].models, undefined);
  }
});

test("HTTP failures report the actual status with safe actionable guidance", async () => {
  const expected = new Map([
    [400, /format or parameters/],
    [404, /model or endpoint was not found/],
    [408, /timed out/],
    [413, /too large/],
    [422, /could not process/],
    [500, /server error/],
    [502, /unsuccessful response from the model provider/],
    [503, /No model provider was available/],
    [418, /could not complete/],
  ]);
  for (const [status, guidance] of expected) {
    let calls = 0;
    await assert.rejects(
      provider.complete(
        {
          kind: "translation",
          model: "google/gemini-3-flash-preview",
          input: { imageDataUrl: PNG },
        },
        "secret-test-key",
        {
          fetcher: async () => {
            calls++;
            return new Response("private upstream details secret-test-key", { status });
          },
        },
      ),
      (error) => {
        assert.equal(error.code, "http-" + status);
        assert.equal(error.uncertain, status >= 500);
        assert.match(error.message, new RegExp("HTTP " + status));
        assert.match(error.message, guidance);
        assert.match(error.message, /No automatic retry/);
        assert.doesNotMatch(error.message, /private|secret-test-key/);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test("structured error categories are safe and bounded; arbitrary provider details stay private", async () => {
  const detail = {
    code: 503,
    message: "private prompt and secret-test-key",
    metadata: {
      error_type: "image_too_large",
      provider_name: "Google",
      raw: "private prompt and secret-test-key",
    },
  };
  const request = (response) =>
    provider.complete(
      { kind: "translation", model: "google/gemini-3-flash-preview", input: { imageDataUrl: PNG } },
      "secret-test-key",
      { fetcher: async () => response },
    );
  await assert.rejects(request(Response.json({ error: detail }, { status: 400 })), (error) => {
    assert.equal(
      error.code,
      "http-400",
      "the real HTTP status wins over an inconsistent body code",
    );
    assert.match(error.message, /HTTP 400; image_too_large; provider: Google/);
    assert.match(error.message, /Select a smaller area/);
    assert.doesNotMatch(error.message, /private|secret-test-key|503/);
    return true;
  });
  detail.metadata.error_type = "provider_overloaded";
  await assert.rejects(request(Response.json({ error: detail }, { status: 429 })), (error) => {
    assert.equal(error.code, "http-429");
    assert.match(error.message, /reported that it is overloaded.*HTTP 429; provider_overloaded/);
    assert.doesNotMatch(
      error.message,
      /may be provider capacity|account limit|private|secret-test-key/,
    );
    return true;
  });
  detail.metadata.error_type = "secret-test-key";
  detail.metadata.provider_name = "private prompt";
  await assert.rejects(request(Response.json({ error: detail }, { status: 400 })), (error) => {
    assert.match(error.message, /format or parameters.*HTTP 400/);
    assert.doesNotMatch(error.message, /private|secret-test-key|provider:/);
    return true;
  });
  let cancelled = false;
  const oversized = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(32769));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { status: 502 },
  );
  await assert.rejects(request(oversized), (error) => error.code === "http-502");
  assert.equal(cancelled, true);
});

test("an error in an HTTP 200 stream preserves its safe code and category without resubmitting", async () => {
  let calls = 0;
  await assert.rejects(
    provider.complete(
      { kind: "translation", model: "qwen/qwen3.8-27b:free", input: { imageDataUrl: PNG } },
      "secret-test-key",
      {
        fetcher: async () => {
          calls++;
          return stream([
            completeEvents()[0],
            {
              provider: "Google",
              error: {
                code: 429,
                message: "private secret-test-key",
                metadata: { error_type: "rate_limit_exceeded" },
              },
            },
            "[DONE]",
          ]);
        },
      },
    ),
    (error) => {
      assert.equal(error.code, "stream-429");
      assert.equal(error.uncertain, true);
      assert.match(error.message, /error 429; rate_limit_exceeded; provider: Google/);
      assert.match(error.message, /free-model quota/);
      assert.match(error.message, /may have been charged/);
      assert.doesNotMatch(error.message, /private|secret-test-key|HTTP 429/);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("Google HTTP 400 retains its structured reason with bounded, redacted plain text", async () => {
  const apiKey = "actual-private-key-for-this-request";
  const googleKey = "AIza" + "a".repeat(35);
  const schemaError = "The schema has too many states for serving. Please simplify it.";
  const privateMessage = `${schemaError}\n${apiKey} ${apiKey} ${PNG} Bearer secret-token ${googleKey} https://example.test/?key=private-token\u202e`;
  const request = (raw, options = {}) =>
    provider.complete(
      { kind: "translation", model: "google/gemini-3-flash-preview", input: { imageDataUrl: PNG } },
      apiKey,
      {
        fetcher: async () =>
          Response.json(
            {
              error: {
                code: 400,
                message: "Provider returned error",
                metadata: { provider_name: "Google AI Studio", raw, ...options.metadata },
              },
            },
            { status: options.status || 400 },
          ),
      },
    );
  for (const raw of [
    { error: { message: privateMessage }, request: { secret: "never-show-entire-raw-body" } },
    JSON.stringify({
      error: { message: privateMessage },
      request: { secret: "never-show-entire-raw-body" },
    }),
  ]) {
    await assert.rejects(request(raw), (error) => {
      assert.equal(error.code, "http-400");
      assert.match(error.message, /Provider detail: The schema has too many states/);
      assert.match(error.message, /HTTP 400; provider: Google AI Studio/);
      for (const secret of [
        apiKey,
        googleKey,
        PNG,
        "secret-token",
        "private-token",
        "never-show-entire-raw-body",
      ])
        assert.equal(error.message.includes(secret), false, secret);
      assert.doesNotMatch(error.message, /[\u0000-\u001f\u202e]/);
      return true;
    });
  }
  await assert.rejects(request({ error: { message: "x".repeat(1200) } }), (error) => {
    const extracted = error.message.split("Provider detail: ")[1].split(" (HTTP")[0];
    assert.equal(extracted.length, 500);
    assert.ok(extracted.endsWith("…"));
    return true;
  });
  for (const [raw, options] of [
    ["not structured private raw text", {}],
    [{ message: "unrecognized raw private text" }, {}],
    [{ error: { message: schemaError } }, { status: 500 }],
    [{ error: { message: schemaError } }, { metadata: { provider_name: "Unknown" } }],
  ]) {
    await assert.rejects(request(raw, options), (error) => {
      assert.doesNotMatch(
        error.message,
        /Provider detail:|private raw|unrecognized raw|too many states/,
      );
      return true;
    });
  }
});

test("catalog filters incompatible models and preserves unknown prices without a premium default", () => {
  const compatible = {
    id: "vendor/cheap",
    name: "Cheap",
    architecture: { input_modalities: ["image", "text"], output_modalities: ["text"] },
    supported_parameters: ["structured_outputs"],
    pricing: { prompt: "0.0000001", completion: null },
  };
  const catalog = provider.filterModels({
    data: [
      compatible,
      { ...compatible, id: "vendor/no-schema", supported_parameters: [] },
      {
        ...compatible,
        id: "vendor/no-image",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      },
      { ...compatible, id: "vendor/batch:batch" },
    ],
  });

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].id, "vendor/cheap");
  assert.ok(Math.abs(catalog[0].prompt_per_million - 0.1) < 1e-12);
  assert.equal(catalog[0].completion_per_million, null);
});

test("a no-text response is cacheable only when it has no invented translation or language help", () => {
  const noText = { japanese: "", translation: "", words: [], grammar: [] };
  assert.deepEqual(provider.validateTranslation(noText), { regions: [] });
  for (const extra of [
    { translation: "Invented dialogue" },
    { words: [{ surface: "word", reading: "word", meaning: "invented" }] },
    { grammar: [{ pattern: "です", explanation: "Invented grammar" }] },
  ])
    assert.throws(
      () => provider.validateTranslation({ ...noText, ...extra }),
      (error) => error.code === "invalid-output",
    );
  assert.throws(
    () => provider.validateTranslation({ regions: [] }),
    /invalid Japanese transcription/,
  );
});

test("study vocabulary must match the actual selected Japanese", () => {
  assert.throws(
    () =>
      provider.validateStudy(
        {
          notes: [],
          words: [{ surface: "帰る", reading: "かえる", meaning: "go home" }],
          grammar: [],
        },
        "もう帰らなきゃ。",
      ),
    /did not match/,
  );
  assert.equal(
    provider.validateStudy(
      {
        notes: [],
        words: [{ surface: "帰らなきゃ", reading: "かえらなきゃ", meaning: "must go home" }],
        grammar: [],
      },
      "もう帰らなきゃ。",
    ).words.length,
    1,
  );
});

test("the initial translation requires bounded vocabulary and major grammar from the same text", () => {
  const response = translation();
  const schema = provider.payload({
    kind: "translation",
    model: "test/cheap",
    input: { imageDataUrl: PNG, context: "" },
  }).response_format.json_schema.schema;
  assert.ok(schema.required.includes("words"));
  assert.ok(schema.required.includes("grammar"));
  assert.equal(schema.properties.words.maxItems, 60);
  assert.equal(schema.properties.grammar.maxItems, 3);
  assert.deepEqual(schema.properties.words.items.required, ["surface", "reading", "meaning"]);
  assert.deepEqual(schema.properties.grammar.items.required, ["pattern", "explanation"]);
  assert.deepEqual(provider.validateTranslation(response), {
    regions: [{ id: "selection", order: 1, ...response }],
  });

  for (const [field, value, error] of [
    ["words", undefined, /invalid vocabulary list/],
    ["grammar", undefined, /invalid grammar list/],
    ["words", [{ surface: "帰る", reading: "かえる", meaning: "go home" }], /did not match/],
    ["words", [{ surface: "", reading: "", meaning: "" }], /did not match/],
    ["words", [{ surface: "もう", reading: 123, meaning: "already" }], /invalid reading/],
    ["grammar", [{ pattern: "なきゃ", explanation: null }], /invalid grammar explanation/],
    ["words", Array(61).fill(response.words[0]), /invalid vocabulary list/],
    ["grammar", Array(4).fill(response.grammar[0]), /invalid grammar list/],
  ]) {
    const invalid = translation();
    invalid[field] = value;
    assert.throws(() => provider.validateTranslation(invalid), error);
  }

  const unsupported = { ...translation(), japanese: "[illegible]", words: [], grammar: [] };
  assert.deepEqual(provider.validateTranslation(unsupported), {
    regions: [{ id: "selection", order: 1, ...unsupported }],
  });
});
