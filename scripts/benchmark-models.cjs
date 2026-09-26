"use strict";
// Dry-run is offline. Explicit --run uses the production request/validator, never retries,
// and records an intent before each paid call so interrupted runs cannot resubmit it.
// Example: node scripts/benchmark-models.cjs --run-name pilot --sample 01-contractions
// Add --run to execute; repeat the same run name without filters to finish remaining pairs.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const provider = require("../src/background/provider.js");

const MODELS = [
  "google/gemini-3.1-flash-lite",
  "openai/gpt-6-luna",
  "qwen/qwen3.8-flash",
  "google/gemini-3-flash-preview",
  "google/gemini-3.8-flash",
];
// Offline planning snapshot only, reviewed 2026-09-25 on the OpenRouter model pages.
// Each --run verifies fresh image/schema capabilities and pricing before any paid call.
const SNAPSHOT = [
  [0.25, 1.5, 0.08333],
  [0.1, 0.5, 0.125],
  [0.15, 0.47, 0.2],
  [0.5, 3, 0.08333],
  [0.75, 3.75, 0.04167],
];
// These broader comparisons require an explicit --model filter; defaults stay fixed.
const ADDITIONAL_MODELS = {
  "deepseek/deepseek-v4.1-flash": [0.15, 0.6, 0],
  "anthropic/claude-haiku-4.5": [1, 5, 1.25],
  "anthropic/claude-sonnet-5": [2, 10, 2.5],
  "z-ai/glm-5.3-flash": [0.045, 0.14, 0],
  "minimax/minimax-m3": [0.3, 1.2, 0],
  "mistralai/mistral-small-2603": [0.15, 0.6, 0],
};
const SUPPORTED_MODELS = [...MODELS, ...Object.keys(ADDITIONAL_MODELS)];
const INPUT_BOUND = 10000;
const BUDGET = 1;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const dollars = (value) => "$" + value.toFixed(6);
const knownCost = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

function options(argv) {
  const value = {
    run: false,
    reserveRateLimits: false,
    name: "casual-japanese-v1",
    samples: [],
    models: [],
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--run") value.run = true;
    else if (flag === "--reserve-rate-limits") value.reserveRateLimits = true;
    else if (["--run-name", "--sample", "--model"].includes(flag)) {
      const next = argv[++index];
      if (!next || next.startsWith("--"))
        throw new Error("A benchmark option is missing its value.");
      if (flag === "--run-name") value.name = next;
      else value[flag === "--sample" ? "samples" : "models"].push(...next.split(","));
    } else
      throw new Error(
        "Use --run, --reserve-rate-limits, --run-name NAME, --sample ID, or --model MODEL_ID.",
      );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.name))
    throw new Error("Run names must contain 1–64 letters, numbers, hyphens, or underscores.");
  if (value.models.some((model) => !SUPPORTED_MODELS.includes(model)))
    throw new Error("The model filter must use an explicitly supported benchmark model ID.");
  return value;
}

function redact(source, key = "") {
  if (key) {
    source = source.split(key).join("[redacted key]");
    source = source.split(JSON.stringify(key).slice(1, -1)).join("[redacted key]");
  }
  return source
    .replace(/\bBearer\s+[^\s"',;<>]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g, "[redacted key]");
}

function samples(root, selected) {
  const folder = path.join(root, "benchmarks", "casual-japanese");
  const source = fs.readFileSync(path.join(folder, "cases.json"), "utf8");
  const cases = JSON.parse(source);
  if (!Array.isArray(cases) || !cases.length)
    throw new Error("The benchmark needs a nonempty cases array.");
  const ids = new Set();
  const all = cases.map((sample, index) => {
    if (!sample || !/^[A-Za-z0-9_-]+$/.test(sample.id) || ids.has(sample.id))
      throw new Error(
        "Benchmark sample IDs must be unique letters, numbers, hyphens, or underscores.",
      );
    ids.add(sample.id);
    if (typeof sample.image !== "string") throw new Error("A benchmark sample has no image path.");
    const file = path.resolve(folder, sample.image);
    if (!file.startsWith(folder + path.sep) || path.extname(file) !== ".png")
      throw new Error("Benchmark images must be PNG files inside the cases directory.");
    const data = fs.readFileSync(file);
    if (data.length < 24 || data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
      throw new Error("A benchmark image is not a PNG.");
    const width = data.readUInt32BE(16),
      height = data.readUInt32BE(20);
    if (!width || !height || width > 760 || height > 600)
      throw new Error(
        "Benchmark images must fit 760×600 pixels for the 10,000-input-token planning bound.",
      );
    return {
      id: sample.id,
      index,
      image: sample.image,
      image_sha256: hash(data),
      width,
      height,
      imageDataUrl: "data:image/png;base64," + data.toString("base64"),
    };
  });
  if (selected.some((id) => !ids.has(id)))
    throw new Error("The sample filter contains an unknown sample ID.");
  return {
    cases_sha256: hash(source),
    items: all.filter((item) => !selected.length || selected.includes(item.id)),
  };
}

function plan(data, modelFilter) {
  const result = [];
  const order = modelFilter.some((id) => Object.hasOwn(ADDITIONAL_MODELS, id))
    ? SUPPORTED_MODELS.filter((id) => modelFilter.includes(id))
    : MODELS;
  for (const sample of data.items) {
    // Preserve the original five-model order; rotate explicit broader comparisons too.
    const rotated = order.map((_, index) => order[(index + sample.index) % order.length]);
    for (const model of rotated.filter((id) => !modelFilter.length || modelFilter.includes(id))) {
      const job = {
        kind: "translation",
        model,
        input: { imageDataUrl: sample.imageDataUrl, context: "" },
      };
      const payload = provider.payload(job);
      const requestId = hash(
        JSON.stringify({
          sample: sample.id,
          prompt_version: provider.TRANSLATION_VERSION,
          profile: provider.PROFILE,
          payload,
        }),
      );
      result.push({ sample, job, payload, requestId });
    }
  }
  return result;
}

function records(file) {
  if (!fs.existsSync(file)) return [];
  const source = fs.readFileSync(file, "utf8");
  if (source && !source.endsWith("\n"))
    throw new Error(
      "The result log ends in an incomplete record. Inspect it before resuming; no requests were made.",
    );
  return source
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function reservableRateLimit(error, usage, reserve) {
  return (
    error?.code === "http-429" &&
    error.uncertain === false &&
    usage?.cost_usd == null &&
    knownCost(reserve)
  );
}

function accounting(history, reserveRateLimits = false) {
  const attempts = new Map();
  const bounds = new Map();
  for (const event of history) {
    if (event.type === "started") {
      attempts.set(event.request_id, null);
      bounds.set(event.request_id, event.estimated_bound_usd);
    }
    if (event.type === "finished") attempts.set(event.request_id, event);
  }
  let spent = 0;
  let unresolved = 0;
  let reserved = 0;
  let unknownCosts = 0;
  for (const [id, event] of attempts) {
    if (event && knownCost(event.usage?.cost_usd)) spent += event.usage.cost_usd;
    else {
      unknownCosts++;
      const reserve = bounds.get(id);
      if (reserveRateLimits && event && reservableRateLimit(event.error, event.usage, reserve))
        reserved += reserve;
      else unresolved++;
    }
  }
  return { attempts, spent, reserved, unknownCosts, unresolved };
}

function prices(catalog, models) {
  const compatible = new Set(provider.filterModels(catalog).map((model) => model.id));
  return new Map(
    models.map((id) => {
      if (!compatible.has(id))
        throw new Error(
          "A selected model is missing image/structured-output support in the live catalog.",
        );
      const pricing = catalog.data.find((model) => model.id === id).pricing;
      const overrides = pricing?.overrides ?? [];
      if (
        !Array.isArray(overrides) ||
        overrides.some((value) => !value || typeof value !== "object" || Array.isArray(value))
      )
        throw new Error(
          "A selected model has unknown pricing overrides; no paid requests were made.",
        );
      const number = (key, required = false) => {
        return Math.max(
          ...[pricing, ...overrides].map((source, index) => {
            const value = source?.[key];
            if ((!required || index > 0) && (value === undefined || value === null)) return 0;
            if (
              (typeof value !== "string" && typeof value !== "number") ||
              String(value).trim() === "" ||
              !knownCost(Number(value))
            )
              throw new Error("A selected model has unknown pricing; no paid requests were made.");
            return Number(value);
          }),
        );
      };
      // No audio, search, tools, or generated images are requested. Reserve an entire
      // prompt's highest cache-write charge plus image/request fees. Each component
      // uses the maximum base/override price, without assuming dates or token tiers.
      return [
        id,
        {
          prompt: number("prompt", true),
          completion: number("completion", true),
          input_cache_write: Math.max(number("input_cache_write"), number("input_cache_write_1h")),
          image: number("image"),
          request: number("request"),
        },
      ];
    }),
  );
}

function bound(item, pricing) {
  return (
    INPUT_BOUND * (pricing.prompt + pricing.input_cache_write) +
    item.payload.max_tokens * pricing.completion +
    pricing.image +
    pricing.request
  );
}

// Diagnostic-only clone reader: production complete() remains the sole validator.
// Keep terminal usage even when the answer is rejected for length or invalid JSON.
async function observeResponse(response) {
  if (!response.body?.getReader) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    content = "",
    received = 0,
    done = false;
  let modelProvider = null,
    generationId = null,
    finishReason = null,
    usage = {};
  const event = (block) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (data.trim() === "[DONE]") {
      done = true;
      return;
    }
    let item;
    try {
      item = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof item?.id === "string") generationId = item.id.slice(0, 2000);
    if (typeof item?.provider === "string") modelProvider = item.provider.slice(0, 2000);
    if (item?.usage && typeof item.usage === "object") usage = item.usage;
    const choice = item?.choices?.[0];
    if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
    if (content !== null && typeof choice?.delta?.content === "string") {
      content += choice.delta.content;
      if (content.length > 256000) content = null;
    }
    // Reasoning fields are intentionally neither collected nor written to disk.
  };
  try {
    while (!done) {
      const part = await reader.read();
      if (part.done) {
        buffer += decoder.decode();
        break;
      }
      received += part.value.byteLength;
      if (received > 2 * 1024 * 1024) break;
      buffer += decoder.decode(part.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary;
      while (!done && (boundary = buffer.indexOf("\n\n")) !== -1) {
        event(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
    }
    if (buffer.trim() && !done && received <= 2 * 1024 * 1024) event(buffer);
  } catch {
    // An incomplete clone cannot establish a final charge.
  } finally {
    try {
      await reader.cancel();
    } catch {}
  }
  const metric = (value) => (knownCost(value) ? value : null);
  const completion = metric(usage.completion_tokens);
  const reasoning = metric(usage.completion_tokens_details?.reasoning_tokens);
  let value;
  if (done && finishReason && content !== null) {
    try {
      value = JSON.parse(content);
    } catch {}
  }
  return {
    provider: modelProvider,
    generation_id: generationId,
    finish_reason: finishReason,
    usage: {
      prompt_tokens: metric(usage.prompt_tokens),
      completion_tokens: completion,
      reasoning_tokens: reasoning,
      visible_completion_tokens:
        completion !== null && reasoning !== null && completion >= reasoning
          ? completion - reasoning
          : null,
      cost_usd: done && finishReason ? metric(usage.cost) : null,
    },
    ...(value !== undefined ? { value } : {}),
  };
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const root = dependencies.root || path.resolve(__dirname, "..");
  const fetcher = dependencies.fetcher || globalThis.fetch;
  const env = dependencies.env || process.env;
  const log = dependencies.log || console.log;
  const args = options(argv);
  const data = samples(root, args.samples);
  const planned = plan(data, args.models);
  const directory = path.join(root, "test-results", "model-benchmark", args.name);
  const output = path.join(directory, "events.jsonl");
  const history = records(output);
  const firstPreflight = history.find((event) => event.type === "preflight");
  if (
    history.some((event) => event.type === "preflight" && event.cases_sha256 !== data.cases_sha256)
  )
    throw new Error(
      "The benchmark cases have changed since this run began. Use a fresh run name; no requests were made.",
    );
  if (
    firstPreflight &&
    planned.some((item) => !Object.hasOwn(firstPreflight.models || {}, item.job.model))
  )
    throw new Error(
      "The selected models expand this run's original cohort. Use a fresh run name for additional models; no requests were made.",
    );
  if (
    planned.some((item) =>
      history.some(
        (event) =>
          ["started", "finished"].includes(event.type) &&
          event.sample === item.sample.id &&
          event.model === item.job.model &&
          event.request_id !== item.requestId,
      ),
    )
  )
    throw new Error(
      "This run already attempted a selected model/sample with a different request payload. Use a fresh run name; no requests were made.",
    );
  const prior = accounting(history, args.reserveRateLimits);
  const remaining = planned.filter((item) => !prior.attempts.has(item.requestId));
  const reviewed = new Map(
    [...MODELS.map((id, index) => [id, SNAPSHOT[index]]), ...Object.entries(ADDITIONAL_MODELS)].map(
      ([id, rates]) => [
        id,
        {
          prompt: rates[0] / 1e6,
          completion: rates[1] / 1e6,
          input_cache_write: rates[2] / 1e6,
          image: 0,
          request: 0,
        },
      ],
    ),
  );
  const estimated = remaining.reduce(
    (sum, item) => sum + bound(item, reviewed.get(item.job.model)),
    0,
  );
  log(
    JSON.stringify(
      {
        mode: args.run ? "run" : "dry-run (offline; reviewed price estimate only)",
        run: args.name,
        output,
        cases_sha256: data.cases_sha256,
        selected: planned.length,
        skipped_attempts: planned.length - remaining.length,
        remaining: remaining.length,
        spent_usd: prior.spent,
        reserved_unknown_cost_usd: prior.reserved,
        reserve_rate_limits: args.reserveRateLimits,
        unknown_cost_attempts: prior.unknownCosts,
        blocking_unknown_cost_attempts: prior.unresolved,
        budget_usd: BUDGET,
        estimated_remaining_bound_usd: estimated,
        input_token_bound: INPUT_BOUND,
        requests: remaining.map(({ sample, job, payload, requestId }) => ({
          request_id: requestId,
          sample: sample.id,
          image: sample.image,
          model: job.model,
          reasoning: payload.reasoning || null,
          max_tokens: payload.max_tokens,
        })),
      },
      null,
      2,
    ),
  );
  if (!args.run) return { dryRun: true, remaining: remaining.length, estimated };
  if (prior.unresolved)
    throw new Error(
      "A prior attempt has unknown cost or no final record. Inspect its OpenRouter charge before using a new run name; it will not be retried.",
    );
  if (!remaining.length)
    return {
      completed: 0,
      skipped: planned.length,
      spent: prior.spent,
      reserved_unknown_cost_usd: prior.reserved,
    };
  if (!env.OPENROUTER_API_KEY) {
    try {
      (dependencies.loadEnvFile || process.loadEnvFile)(path.join(root, ".env"));
    } catch {
      throw new Error("Set OPENROUTER_API_KEY or provide it in the ignored project .env file.");
    }
  }
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error("OPENROUTER_API_KEY is missing or empty.");
  const say = (message) => log(redact(message, key));
  fs.mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, "run.lock");
  let handle;
  try {
    handle = fs.openSync(lock, "wx");
  } catch {
    throw new Error(
      "This run is locked. Confirm no benchmark is running before removing its run.lock file.",
    );
  }
  const append = (event) =>
    fs.appendFileSync(output, redact(JSON.stringify(event), key) + "\n", {
      encoding: "utf8",
      flag: "a",
    });
  try {
    // Recheck after acquiring the lock in case another process finished during planning.
    if (accounting(records(output)).attempts.size !== prior.attempts.size)
      throw new Error(
        "The result log changed during planning. Run the same command again to resume safely.",
      );
    const response = await fetcher(provider.API + "/models", {
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error("The public catalog preflight failed; no paid requests were made.");
    const catalog = await response.json();
    const livePrices = prices(catalog, [...new Set(remaining.map((item) => item.job.model))]);
    const plannedBound = remaining.reduce(
      (sum, item) => sum + bound(item, livePrices.get(item.job.model)),
      0,
    );
    if (prior.spent + prior.reserved + plannedBound > BUDGET)
      throw new Error(
        "The live catalog planning bound exceeds this run's $1 budget. Narrow --sample or --model; no paid requests were made.",
      );
    append({
      type: "preflight",
      at: new Date().toISOString(),
      cases_sha256: data.cases_sha256,
      budget_usd: BUDGET,
      input_token_bound: INPUT_BOUND,
      remaining_bound_usd: plannedBound,
      spent_usd: prior.spent,
      reserved_unknown_cost_usd: prior.reserved,
      reserve_rate_limits: args.reserveRateLimits,
      models: Object.fromEntries(livePrices),
    });
    say(
      `Live preflight: ${remaining.length} requests, ${dollars(plannedBound)} remaining planning bound; ${dollars(prior.spent)} recorded cost, ${dollars(prior.reserved)} reserved for unknown rate-limit charges. Provider routing and tokenization may differ from this estimate.`,
    );
    let spent = prior.spent,
      reserved = prior.reserved,
      completed = 0;
    for (const item of remaining) {
      const reserve = bound(item, livePrices.get(item.job.model));
      if (spent + reserved + reserve > BUDGET) {
        say("Stopped before the next request: insufficient remaining budget.");
        return { completed, spent, reserved_unknown_cost_usd: reserved, stopped: "budget" };
      }
      const started = Date.now();
      let firstContent = null,
        observation = Promise.resolve(null),
        accepted = null,
        failure = null;
      const job = { ...item.job, id: crypto.randomUUID(), resultId: crypto.randomUUID() };
      append({
        type: "started",
        at: new Date(started).toISOString(),
        request_id: item.requestId,
        sample: item.sample.id,
        image: item.sample.image,
        image_sha256: item.sample.image_sha256,
        model: job.model,
        prompt_version: provider.TRANSLATION_VERSION,
        profile: provider.PROFILE,
        reasoning: item.payload.reasoning || null,
        max_tokens: item.payload.max_tokens,
        estimated_bound_usd: reserve,
      });
      try {
        accepted = await provider.complete(job, key, {
          fetcher: async (url, request) => {
            const result = await fetcher(url, request);
            if (result.ok) observation = observeResponse(result.clone()).catch(() => null);
            return result;
          },
          onProgress: ({ receivedCharacters }) => {
            if (firstContent === null && receivedCharacters > 0)
              firstContent = Date.now() - started;
          },
        });
      } catch (error) {
        failure =
          error instanceof provider.ProviderError
            ? { code: error.code, message: error.message, uncertain: error.uncertain }
            : {
                code: "benchmark",
                message: "The benchmark could not confirm this request's outcome.",
                uncertain: true,
              };
      }
      const parsed = await observation;
      const usage = accepted?.usage || parsed?.usage || { cost_usd: null };
      append({
        type: "finished",
        at: new Date().toISOString(),
        request_id: item.requestId,
        sample: item.sample.id,
        model: job.model,
        status: accepted ? "accepted" : "error",
        provider: accepted?.provider || parsed?.provider || null,
        generation_id: accepted?.generation_id || parsed?.generation_id || null,
        finish_reason: parsed?.finish_reason || null,
        latency_ms: Date.now() - started,
        time_to_first_content_ms: firstContent,
        usage,
        reasoning: item.payload.reasoning || null,
        result: accepted,
        error: failure,
        ...(!accepted && parsed ? { raw_answer: parsed.value } : {}),
      });
      completed++;
      const cost = usage.cost_usd;
      if (knownCost(cost)) spent += cost;
      const reserveRateLimit =
        args.reserveRateLimits && reservableRateLimit(failure, usage, reserve);
      if (reserveRateLimit) reserved += reserve;
      say(
        `${item.sample.id} · ${job.model} · ${accepted ? "accepted" : "error"} · ${knownCost(cost) ? dollars(cost) : "unknown cost"}`,
      );
      if (reserveRateLimit)
        say(
          `Reserved ${dollars(reserve)} for this rate-limit attempt's unknown charge; the attempt will not be retried.`,
        );
      if (
        (!knownCost(cost) && !reserveRateLimit) ||
        /^(http|stream)-(401|402|403)$/.test(failure?.code || "")
      )
        return {
          completed,
          spent,
          reserved_unknown_cost_usd: reserved,
          stopped: knownCost(cost) ? "account-error" : "unknown-cost",
        };
    }
    say(
      `Finished ${completed} attempts; recorded cost ${dollars(spent)}, reserved unknown cost ${dollars(reserved)}. Resume skips every attempted request, including failures.`,
    );
    return { completed, spent, reserved_unknown_cost_usd: reserved };
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(lock);
  }
}

module.exports = { main, options, MODELS, SUPPORTED_MODELS };
if (require.main === module)
  main()
    .then((result) => {
      if (result.stopped) process.exitCode = 2;
    })
    .catch((error) => {
      // Do not emit stacks, raw responses, environment values, or request headers.
      console.error(
        redact(error.message || "Benchmark failed.", process.env.OPENROUTER_API_KEY?.trim()),
      );
      process.exitCode = 1;
    });
