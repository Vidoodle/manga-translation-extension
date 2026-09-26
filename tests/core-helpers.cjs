const { IDBFactory } = require("fake-indexeddb");

const storage = require("../src/background/store.js");
const provider = require("../src/background/provider.js");
const settings = require("../src/background/settings.js");
const jobs = require("../src/background/jobs.js");
const reader = require("../src/background/reader-session.js");
require("../src/background/anki.js");
const background = require("../src/background/background.js");

const PNG = "data:image/png;base64,dGVzdA==";
const viewport = { width: 1200, height: 800 };
const rect = { x: 10, y: 20, width: 100, height: 120 };

function analysis() {
  return {
    summary: "A speaker needs to leave.",
    warnings: [],
    regions: [
      {
        id: "bubble-1",
        order: 1,
        japanese: "もう帰らなきゃ。",
        translation: "I'd better head home.",
        notes: [],
        words: [
          { surface: "もう", reading: "もう", meaning: "already; now" },
          { surface: "帰らなきゃ", reading: "かえらなきゃ", meaning: "have to go home" },
        ],
        grammar: [{ pattern: "なきゃ", explanation: "A casual contraction expressing necessity." }],
      },
    ],
  };
}

function result(job) {
  const common = { model: job.model, usage: { cost_usd: null } };

  if (job.kind === "study") {
    return {
      ...common,
      run_id: job.input.runId,
      study_id: job.resultId,
      region_id: job.input.regionId,
      study: { notes: [], words: [], grammar: [] },
    };
  }

  return {
    ...common,
    run_id: job.resultId,
    capture_id: job.id,
    context: job.input.context,
    analysis: analysis(),
  };
}

async function settle(service) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (!service.active.size) return;
    await new Promise((resolve) => setImmediate(resolve));
  }

  throw new Error("The simulated request did not settle.");
}

async function serviceHarness(t, options = {}) {
  const factory = options.factory || new IDBFactory();
  const store = new storage.MangaStore(factory, options.name || "test-reader");
  await store.open();

  const calls = [];
  const providerMock = {
    ...provider,
    async complete(job, key, controls) {
      calls.push({ job, key });
      if (options.complete) return options.complete(job, key, controls);
      return result(job);
    },
  };
  const preferences = {
    async requireNetwork() {},
    async setup(config) {
      if (!config.key_configured)
        return { code: "setup-key", message: "Save your OpenRouter key before translating." };
      if (!provider.validModel(config.model))
        return { code: "setup-model", message: "Choose a model before translating." };
      await this.requireNetwork();
      return null;
    },
    async key() {
      return "private-test-key";
    },
    async ensureModel(model) {
      return model;
    },
    ...options.settings,
  };
  const service = new jobs.RequestService({ store, provider: providerMock, settings: preferences });

  t.after(async () => {
    await settle(service);
    store.db?.close();
  });

  return { store, service, calls, preferences, factory };
}

const selection = (overrides = {}) => ({
  model: "test/cheap",
  imageDataUrl: PNG,
  context: "",
  ...overrides,
});

// Synthetic pre-inline-learning requests, used only to verify retained request recovery.
async function legacyStudy(service, runId, regionId, retryJobId) {
  const source = await service.source(runId);
  const run = source?.result;
  const selected = run?.analysis?.regions?.find((region) => region.id === regionId);
  if (!selected) throw new Error("The selected text is no longer in the saved translation.");
  return service.submit(
    {
      kind: "study",
      model: run.model,
      input: {
        runId,
        regionId,
        captureId: run.capture_id,
        source: {
          context: run.context || "",
          selection_transcript: run.analysis.regions.map((region) => ({
            id: region.id,
            japanese: region.japanese,
          })),
          selected: {
            id: selected.id,
            japanese: selected.japanese,
            translation: selected.translation,
          },
        },
      },
    },
    retryJobId,
  );
}

module.exports = {
  legacyStudy,
  storage,
  provider,
  settings,
  jobs,
  reader,
  background,
  IDBFactory,
  PNG,
  viewport,
  rect,
  analysis,
  result,
  settle,
  serviceHarness,
  selection,
};
