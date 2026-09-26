"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  IDBFactory,
  storage,
  jobs,
  provider,
  result,
  PNG,
  viewport,
  rect,
} = require("./core-helpers.cjs");

async function seedVersionOne(factory, name, records) {
  const db = await new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("jobs", { keyPath: "id" }).createIndex("runId", "runId", {
        unique: true,
      });
      db.createObjectStore("claims", { keyPath: "key" });
      db.createObjectStore("pages", { keyPath: "id" });
      db.createObjectStore("regions", { keyPath: "id" }).createIndex("pageId", "pageId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["jobs", "claims", "pages", "regions"], "readwrite");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    for (const job of records) {
      tx.objectStore("jobs").put(job);
      tx.objectStore("claims").put({ key: job.key, jobId: job.id });
    }
    tx.objectStore("claims").put({ key: "orphan-claim", jobId: "missing-job" });
    tx.objectStore("pages").put({ id: "legacy-page", imageDataUrl: PNG, viewport });
    tx.objectStore("regions").put({
      id: "legacy-region",
      pageId: "legacy-page",
      runId: "legacy-run",
      rect,
    });
  });
  db.close();
}

function completed(id) {
  return {
    id,
    key: "key-" + id,
    kind: "translation",
    status: "completed",
    runId: "run-" + id,
    resultId: "run-" + id,
    model: "test/cheap",
    createdAt: 1,
    input: { imageDataUrl: PNG, context: "saved context" },
    associations: [{ id: id + "-area", pageId: "legacy-page", rect, viewport }],
    result: {
      run_id: "run-" + id,
      analysis: {
        regions: [
          { id: "bubble-1", japanese: "昔", close_translation: "old", natural_translation: "old" },
        ],
      },
    },
  };
}

test("v1 migration removes completed cache once while preserving request intent and required source runs", async (t) => {
  const factory = new IDBFactory();
  const name = "migration";
  const records = [completed("obsolete")];
  records.push({
    id: "obsolete-no-run",
    key: "key-obsolete-no-run",
    kind: "translation",
    status: "completed",
  });
  records.push({
    id: "obsolete-study",
    key: "key-obsolete-study",
    kind: "study",
    status: "completed",
    input: { runId: "run-obsolete", regionId: "bubble-1" },
    result: { study: { notes: ["old"] } },
  });
  for (const status of ["running", "interrupted", "queued", "failed"]) {
    records.push(completed("source-" + status));
    records.push({
      id: status,
      key: "key-" + status,
      kind: "study",
      status,
      model: "test/cheap",
      createdAt: 2,
      input: {
        runId: "run-source-" + status,
        regionId: "bubble-1",
        source: { selected: { japanese: "昔" } },
      },
      code: "http-400",
      error: "Saved provider diagnostics (HTTP 400).",
      retryable: true,
    });
  }
  const failedGemini = {
    id: "gemini-failure",
    key: "key-gemini-failure",
    kind: "translation",
    status: "failed",
    model: "google/gemini-3-flash-preview",
    createdAt: 3,
    input: { imageDataUrl: PNG, context: "original failed selection" },
    code: "http-400",
    error: "Google rejected the schema (HTTP 400; provider: Google AI Studio).",
    retryable: true,
  };
  records.push(failedGemini);
  await seedVersionOne(factory, name, records);
  let store = new storage.MangaStore(factory, name);
  t.after(() => store.db?.close());
  await store.open();

  assert.equal(store.db.version, 2);
  assert.equal(await store.get("jobs", "obsolete"), undefined);
  assert.equal(await store.get("jobs", "obsolete-study"), undefined);
  assert.equal(await store.get("jobs", "obsolete-no-run"), undefined);
  assert.equal(await store.lookup("key-obsolete"), undefined);
  assert.equal(await store.lookup("orphan-claim"), undefined);
  assert.deepEqual(await store.all("pages"), []);
  assert.deepEqual(await store.all("regions"), []);
  assert.deepEqual(await store.get("jobs", failedGemini.id), failedGemini);
  for (const status of ["running", "interrupted", "queued", "failed"]) {
    const saved = await store.lookup("key-" + status);
    assert.deepEqual(saved.input, records.find((job) => job.id === status).input);
    assert.equal(saved.status, status === "running" ? "interrupted" : status);
    if (status === "running") assert.match(saved.error, /may already have been charged/);
    else assert.equal(saved.error, "Saved provider diagnostics (HTTP 400).");
    assert.ok(await store.run(saved.input.runId));
  }
  const service = new jobs.RequestService({
    store,
    provider: {
      ...provider,
      complete: async () => assert.fail("Migration/history must not submit a request"),
    },
    settings: { key: async () => assert.fail("Migration/history must not read credentials") },
  });
  assert.equal((await service.history("gemini-failure")).job.code, "http-400");
  assert.equal((await service.history("interrupted")).studyJob.status, "interrupted");

  const current = { ...completed("current"), status: "running" };
  delete current.result;
  delete current.runId;
  current.associations[0].pageId = "current-page";
  await store.savePage({ id: "current-page", imageDataUrl: PNG, viewport });
  await store.claim(current);
  await store.finish(current.id, { status: "completed", result: result(current) });
  store.db.close();
  store = new storage.MangaStore(factory, name);
  await store.open();
  assert.equal((await store.lookup(current.key)).status, "completed");
  assert.equal(
    (await store.run(current.resultId)).result.analysis.regions[0].translation,
    "I'd better head home.",
  );
  assert.ok(await store.get("pages", "current-page"));
  assert.equal((await store.page("current-page")).regions.length, 1);
  assert.deepEqual(await store.get("jobs", failedGemini.id), failedGemini);
});

test("a fresh v2 cache keeps completed results after reopening", async (t) => {
  const factory = new IDBFactory();
  let store = new storage.MangaStore(factory, "fresh");
  t.after(() => store.db?.close());
  await store.open();
  assert.equal(store.db.version, 2);
  const job = { ...completed("fresh-answer"), status: "running" };
  delete job.result;
  await store.claim(job);
  await store.finish(job.id, { status: "completed", result: result(job) });
  store.db.close();
  store = new storage.MangaStore(factory, "fresh");
  await store.open();
  assert.equal((await store.lookup(job.key)).status, "completed");
});
