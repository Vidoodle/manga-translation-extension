const test = require("node:test");
const assert = require("node:assert/strict");
const {
  storage,
  legacyStudy,
  provider,
  jobs,
  PNG,
  viewport,
  rect,
  analysis,
  result,
  settle,
  serviceHarness,
  selection,
} = require("./core-helpers.cjs");

test("saved failures expose their retained HTTP status without another provider request", async (t) => {
  const oldMessage = "OpenRouter could not complete this request. No automatic retry was made.";
  const h = await serviceHarness(t, {
    complete: async () => {
      throw new provider.ProviderError(oldMessage, "http-400");
    },
  });
  const submitted = await h.service.translation(selection());
  await settle(h.service);
  const saved = await h.store.get("jobs", submitted.jobId);
  assert.equal(saved.error, oldMessage);
  const restarted = new jobs.RequestService({
    store: h.store,
    settings: h.preferences,
    provider: {
      ...provider,
      complete: async () => assert.fail("Reading a failure must not resubmit it"),
    },
  });
  for (const job of [await restarted.poll(saved.id), (await restarted.history(saved.id)).job]) {
    assert.equal(job.error, oldMessage + " (HTTP 400)");
    assert.equal(job.status, "failed");
    assert.equal(job.code, "http-400");
  }
  assert.equal(
    restarted.failureMessage({ ...saved, error: "Failure (HTTP 400)." }),
    "Failure (HTTP 400).",
  );
  assert.equal(h.calls.length, 1);
});

test("concurrent duplicate selections share one durable request", async (t) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const h = await serviceHarness(t, {
    complete: async (job) => {
      await pending;
      return result(job);
    },
  });

  const replies = await Promise.all([
    h.service.translation(selection()),
    h.service.translation(selection()),
  ]);
  assert.equal(replies[0].jobId, replies[1].jobId);
  assert.equal(h.calls.length, 1);
  assert.equal((await h.store.get("jobs", replies[0].jobId)).status, "running");

  release();
  await settle(h.service);

  assert.equal((await h.service.poll(replies[0].jobId)).status, "completed");
});

test("completed answers and study notes reopen offline without another provider request", async (t) => {
  const h = await serviceHarness(t);
  const submitted = await h.service.translation(selection());
  await settle(h.service);
  const run = (await h.service.poll(submitted.jobId)).result;
  const study = await legacyStudy(h.service, run.run_id, "bubble-1");
  await settle(h.service);

  h.preferences.requireNetwork = async () => {
    throw new Error("Offline");
  };
  h.preferences.key = async () => "";
  const cached = await h.service.translation(selection());
  const cachedStudy = await legacyStudy(h.service, run.run_id, "bubble-1");
  const reopened = await h.service.reopen(run.run_id);

  assert.equal(cached.cached, true);
  assert.equal(cachedStudy.jobId, study.jobId);
  assert.ok(reopened.result.studies["bubble-1"]);
  assert.equal(h.calls.length, 2);
});

test("one translation request preserves vocabulary and grammar across cache reuse and restart", async (t) => {
  const h = await serviceHarness(t);
  const submitted = await h.service.translation(selection());
  await settle(h.service);
  const completed = await h.service.poll(submitted.jobId);
  const expected = analysis().regions[0];
  assert.deepEqual(completed.result.analysis.regions[0].words, expected.words);
  assert.deepEqual(completed.result.analysis.regions[0].grammar, expected.grammar);

  h.preferences.key = async () => "";
  h.preferences.requireNetwork = async () => {
    throw new Error("Offline");
  };
  const restarted = new jobs.RequestService({
    store: h.store,
    settings: h.preferences,
    provider: {
      ...provider,
      async complete() {
        assert.fail("Cached language details must never need a second provider request");
      },
    },
  });
  const cached = await restarted.translation(selection());
  const reopened = await restarted.reopen(completed.result.run_id);
  const history = await restarted.history(submitted.jobId);
  assert.equal(cached.cached, true);
  assert.equal(cached.jobId, submitted.jobId);
  for (const saved of [reopened.result, history.result]) {
    assert.deepEqual(saved.analysis.regions[0].words, expected.words);
    assert.deepEqual(saved.analysis.regions[0].grammar, expected.grammar);
    assert.deepEqual(saved.studies, {});
  }
  assert.equal((await h.store.all("jobs")).length, 1);
  assert.equal(h.calls.length, 1);
});

test("study notes belong to their source run even when two crops produce identical text", async (t) => {
  const h = await serviceHarness(t);
  const runIds = [];
  const studyIds = [];
  for (const imageDataUrl of [PNG, "data:image/png;base64,b3RoZXI="]) {
    const translated = await h.service.translation(selection({ imageDataUrl }));
    await settle(h.service);
    const runId = (await h.service.poll(translated.jobId)).result.run_id;
    runIds.push(runId);
    const study = await legacyStudy(h.service, runId, "bubble-1");
    await settle(h.service);
    studyIds.push(study.jobId);
    assert.equal((await h.service.poll(study.jobId)).result.run_id, runId);
  }

  assert.notEqual(studyIds[0], studyIds[1]);
  h.preferences.requireNetwork = async () => {
    throw new Error("Offline");
  };
  for (let index = 0; index < runIds.length; index++) {
    const reopened = await h.service.reopen(runIds[index]);
    assert.equal(reopened.result.studies["bubble-1"].run_id, runIds[index]);
    const cached = await legacyStudy(h.service, runIds[index], "bubble-1");
    assert.equal(cached.jobId, studyIds[index]);
    assert.equal(cached.cached, true);
  }
  assert.equal(h.calls.length, 4);
});

test("context and explicitly selected model are part of answer identity", async (t) => {
  const h = await serviceHarness(t);
  const first = await h.service.translation(selection());
  await settle(h.service);
  const changedContext = await h.service.translation(selection({ context: "A different speaker" }));
  const changedModel = await h.service.translation(selection({ model: "test/another" }));
  await settle(h.service);

  assert.equal(new Set([first.jobId, changedContext.jobId, changedModel.jobId]).size, 3);
  assert.equal(h.calls.length, 3);
  assert.equal((await h.service.poll(first.jobId)).result.model, "test/cheap");
});

test("new reasoning profiles do not reuse old requests, while saved translations still reopen", async (t) => {
  const h = await serviceHarness(t);
  const input = selection({ model: "google/gemini-3-flash-preview" });
  h.service.provider.PROFILE = "provider-default-v1";
  const old = await h.service.translation(input);
  await settle(h.service);
  const saved = (await h.service.poll(old.jobId)).result;

  h.service.provider.PROFILE = provider.PROFILE;
  const current = await h.service.translation(input);
  await settle(h.service);
  assert.notEqual(current.jobId, old.jobId);
  assert.equal((await h.service.translation(input)).jobId, current.jobId);
  assert.equal((await h.service.reopen(saved.run_id)).result.run_id, saved.run_id);
  assert.equal(h.calls.length, 2);
});

test("unknown provider outcome stays interrupted until an explicit retry, which concurrent callers share", async (t) => {
  let fail = true;
  const h = await serviceHarness(t, {
    complete: async (job) => {
      if (fail)
        throw new provider.ProviderError(
          "Connection lost; this may have been charged.",
          "interrupted",
          true,
        );
      return result(job);
    },
  });
  const original = await h.service.translation(selection());
  await settle(h.service);

  assert.equal((await h.service.poll(original.jobId)).status, "interrupted");
  await assert.rejects(
    h.service.translation(selection()),
    (error) => error.code === "interrupted" && error.jobId === original.jobId,
  );
  assert.equal(h.calls.length, 1);

  fail = false;
  const retries = await Promise.all([
    h.service.retry(original.jobId),
    h.service.retry(original.jobId),
  ]);
  await settle(h.service);
  assert.equal(retries[0].jobId, retries[1].jobId);
  assert.equal(h.calls.length, 2);
  assert.equal((await h.store.get("jobs", original.jobId)).supersededBy, retries[0].jobId);
});

test("retry after a prompt upgrade resolves the original intent and shares the new request", async (t) => {
  const h = await serviceHarness(t);
  const previous = new jobs.RequestService({
    store: h.store,
    settings: h.preferences,
    provider: { ...provider, TRANSLATION_VERSION: "manga-extension-selection-v2" },
  });
  const specification = {
    kind: "translation",
    model: "test/cheap",
    input: { imageDataUrl: PNG, context: "" },
    associations: [],
  };
  const key = await previous.key(specification.kind, specification.model, specification.input);
  const original = h.service.candidate(specification, key);
  await h.store.claim(original);
  await h.store.finish(original.id, { status: "interrupted", retryable: true });

  const retries = await Promise.all([h.service.retry(original.id), h.service.retry(original.id)]);
  await settle(h.service);
  assert.equal(retries[0].jobId, retries[1].jobId);
  assert.equal(h.calls.length, 1);
  assert.equal((await h.store.get("jobs", original.id)).supersededBy, retries[0].jobId);
  assert.equal((await h.store.stats()).unresolved, 0);
  assert.equal((await h.service.translation(selection())).jobId, retries[0].jobId);
});

test("a prompt-upgrade retry can replace one of fifty unresolved intents", async (t) => {
  const h = await serviceHarness(t);
  const specification = {
    kind: "translation",
    model: "test/cheap",
    input: { imageDataUrl: PNG, context: "" },
    associations: [],
  };
  for (let index = 0; index < 50; index++) {
    const job = h.service.candidate(specification, "old-version-" + index);
    job.id = "interrupted-" + index;
    job.status = "interrupted";
    await h.store.claim(job);
  }
  const retry = await h.service.retry("interrupted-0");
  await settle(h.service);
  assert.equal((await h.service.poll(retry.jobId)).status, "completed");
  assert.equal((await h.store.stats()).unresolved, 49);
  assert.equal(h.calls.length, 1);
});

test("restart recovers persisted intent as interrupted without submitting it again", async (t) => {
  const h = await serviceHarness(t);
  const key = await h.service.key("translation", "test/cheap", { imageDataUrl: PNG, context: "" });
  await h.store.claim({
    id: "lost",
    key,
    kind: "translation",
    model: "test/cheap",
    status: "running",
    input: { imageDataUrl: PNG, context: "" },
    createdAt: Date.now(),
  });
  h.store.db.close();
  h.store.db = null;
  await h.store.open();

  await assert.rejects(h.service.translation(selection()), (error) => error.code === "interrupted");
  assert.equal(h.calls.length, 0);
  assert.equal((await h.service.poll("lost")).status, "interrupted");
});

test("failure to persist submission intent prevents every provider call", async (t) => {
  const h = await serviceHarness(t);
  h.store.claim = async () => {
    throw new storage.StoreError("Disk is full");
  };

  await assert.rejects(h.service.translation(selection()), /Disk is full/);
  assert.equal(h.calls.length, 0);
});

test("completion save failure retains the visible answer and suppresses duplicate charges", async (t) => {
  const h = await serviceHarness(t);
  const finish = h.store.finish.bind(h.store);
  h.store.finish = async (id, changes) => {
    if (changes.status === "completed") throw new storage.StoreError("Disk is full");
    return finish(id, changes);
  };
  const submitted = await h.service.translation(selection());
  await settle(h.service);
  const poll = await h.service.poll(submitted.jobId);
  const duplicate = await h.service.translation(selection());

  assert.equal(poll.status, "completed");
  assert.match(poll.result.storage_warning, /could not be saved/);
  assert.equal(duplicate.cached, true);
  assert.equal(h.calls.length, 1);
  assert.equal((await h.store.get("jobs", submitted.jobId)).status, "running");
});

test("failed outcome persistence blocks retries until storage recovers, without automatic resubmission", async (t) => {
  for (const uncertain of [false, true]) {
    const status = uncertain ? "interrupted" : "failed";
    let failProvider = true;
    const h = await serviceHarness(t, {
      complete: async (job) => {
        if (failProvider) throw new provider.ProviderError("Request failed", "provider", uncertain);
        return result(job);
      },
    });
    const finish = h.store.finish.bind(h.store);
    h.store.finish = async () => {
      throw new storage.StoreError("Temporary storage failure");
    };
    const submitted = await h.service.translation(selection());
    await settle(h.service);

    assert.equal((await h.store.get("jobs", submitted.jobId)).status, "running");
    assert.equal((await h.service.poll(submitted.jobId)).status, status);
    await assert.rejects(h.service.retry(submitted.jobId), (error) => error.code === "storage");
    await assert.rejects(h.service.translation(selection()), (error) => error.code === status);
    assert.equal(h.calls.length, 1);

    h.store.finish = finish;
    failProvider = false;
    await assert.rejects(h.service.translation(selection()), (error) => error.code === status);
    assert.equal(h.calls.length, 1);
    const retried = await h.service.retry(submitted.jobId);
    await settle(h.service);
    assert.equal((await h.service.poll(retried.jobId)).status, "completed");
    assert.equal(h.calls.length, 2);
  }
});

test("late concurrent reconciliation cannot overwrite a superseded attempt or duplicate its retry", async (t) => {
  let fail = true;
  const h = await serviceHarness(t, {
    complete: async (job) => {
      if (fail) throw new provider.ProviderError("Lost connection", "interrupted", true);
      return result(job);
    },
  });
  const finish = h.store.finish.bind(h.store);
  h.store.finish = async () => {
    throw new storage.StoreError("Temporary storage failure");
  };
  const submitted = await h.service.translation(selection());
  await settle(h.service);

  let releaseLate;
  const delayed = new Promise((resolve) => {
    releaseLate = resolve;
  });
  let notifyLate;
  const startedLate = new Promise((resolve) => {
    notifyLate = resolve;
  });
  let reconciliations = 0;
  h.store.finish = async (id, changes) => {
    if (id === submitted.jobId && ++reconciliations === 2) {
      notifyLate();
      await delayed;
    }
    return finish(id, changes);
  };
  fail = false;
  const first = h.service.retry(submitted.jobId);
  const second = h.service.retry(submitted.jobId);
  await startedLate;
  const retried = await first;
  releaseLate();
  assert.equal((await second).jobId, retried.jobId);
  await settle(h.service);

  const original = await h.store.get("jobs", submitted.jobId);
  assert.equal(original.supersededBy, retried.jobId);
  assert.equal(original.retryable, false);
  assert.equal(h.calls.length, 2);
});

test("protected storage above the ordinary budget cannot evict a new paid answer", async (t) => {
  const h = await serviceHarness(t);
  const imageDataUrl = "data:image/png;base64," + "A".repeat(21 * 1024 * 1024);
  for (let index = 0; index < 3; index++) {
    await h.store.claim({
      id: "interrupted-" + index,
      key: "interrupted-" + index,
      kind: "translation",
      model: "test/cheap",
      status: "interrupted",
      input: { imageDataUrl, context: "" },
      createdAt: 1,
    });
  }
  assert.ok((await h.store.stats()).bytes > 120 * 1024 * 1024);

  const submitted = await h.service.translation(selection());
  await settle(h.service);
  await h.store.prune();
  const completed = await h.service.poll(submitted.jobId);
  assert.equal(completed.status, "completed");
  assert.equal((await h.service.translation(selection())).jobId, submitted.jobId);
  assert.equal(h.calls.length, 1);

  await h.store.prune(true);
  assert.equal(await h.store.get("jobs", submitted.jobId), undefined);
  assert.equal((await h.store.stats()).unresolved, 3);
});

test("ordinary cache count stays bounded beside protected unresolved requests", async (t) => {
  const h = await serviceHarness(t);
  await h.store.claim({
    id: "unresolved",
    key: "unresolved",
    kind: "translation",
    model: "test/cheap",
    status: "interrupted",
    input: { imageDataUrl: PNG, context: "" },
    createdAt: 1,
  });
  await h.store.transaction(["jobs", "claims"], "readwrite", (tx) => {
    for (let index = 0; index < 205; index++) {
      const job = {
        id: "completed-" + index,
        key: "completed-" + index,
        kind: "translation",
        status: "completed",
        input: { imageDataUrl: PNG, context: "" },
        createdAt: index + 2,
      };
      tx.objectStore("jobs").put(job);
      tx.objectStore("claims").put({ key: job.key, jobId: job.id });
    }
  });
  await h.store.prune();
  const records = await h.store.all("jobs");
  assert.equal(records.filter((job) => job.status === "completed").length, 200);
  assert.equal(records.filter((job) => job.status === "interrupted").length, 1);
  assert.equal(await h.store.get("jobs", "completed-0"), undefined);
  assert.ok(await h.store.get("jobs", "completed-204"));
  assert.equal((await h.store.all("claims")).length, 201);
});

test("ordinary image storage still evicts older answers at its byte budget", async (t) => {
  const h = await serviceHarness(t);
  const imageDataUrl = "data:image/png;base64," + "A".repeat(15 * 1024 * 1024);
  await h.store.transaction(["jobs", "claims"], "readwrite", (tx) => {
    for (let index = 0; index < 4; index++) {
      const job = {
        id: "large-" + index,
        key: "large-" + index,
        kind: "translation",
        status: "completed",
        input: { imageDataUrl, context: "" },
        createdAt: index + 1,
      };
      tx.objectStore("jobs").put(job);
      tx.objectStore("claims").put({ key: job.key, jobId: job.id });
    }
  });
  await h.store.prune();
  assert.equal(await h.store.get("jobs", "large-0"), undefined);
  assert.ok(await h.store.get("jobs", "large-3"));
  assert.equal((await h.store.stats()).entries, 3);
  assert.ok((await h.store.stats()).bytes < 120 * 1024 * 1024);
  assert.equal(await h.store.lookup("large-0"), undefined);
});

test("cache eviction between lookup and claim rechecks the key before any new request", async (t) => {
  const h = await serviceHarness(t);
  await h.service.translation(selection());
  await settle(h.service);

  const lookup = h.store.lookup.bind(h.store);
  let evict = true;
  h.store.lookup = async (key) => {
    const found = await lookup(key);
    if (evict) {
      evict = false;
      await h.store.prune(true);
    }
    return found;
  };
  h.preferences.key = async () => "";

  await assert.rejects(h.service.translation(selection()), /Save your OpenRouter key/);
  assert.equal(h.calls.length, 1);
  assert.equal((await h.store.all("jobs")).length, 0);
  assert.equal((await h.store.all("claims")).length, 0);
});

test("clear cache retains unresolved study, its source translation and retry input", async (t) => {
  const h = await serviceHarness(t, {
    complete: async (job) => {
      if (job.kind === "study") throw new provider.ProviderError("Uncertain", "interrupted", true);
      return result(job);
    },
  });
  const translated = await h.service.translation(selection());
  await settle(h.service);
  const run = (await h.service.poll(translated.jobId)).result;
  const study = await legacyStudy(h.service, run.run_id, "bubble-1");
  await settle(h.service);
  await h.store.prune(true);

  assert.ok(await h.store.run(run.run_id));
  assert.equal(
    (await h.store.get("jobs", study.jobId)).input.source.selected.japanese,
    "もう帰らなきゃ。",
  );
  const history = await h.service.history(study.jobId);
  assert.equal(history.result.run_id, run.run_id);
  assert.equal(history.studyJob.job_id, study.jobId);
  assert.equal(history.studyJob.regionId, "bubble-1");
});

test("concurrent durable claims cannot exceed the unresolved request limit", async (t) => {
  const h = await serviceHarness(t);
  const claims = await Promise.allSettled(
    Array.from({ length: 51 }, (_, index) =>
      h.store.claim({
        id: "request-" + index,
        key: "input-" + index,
        kind: "translation",
        model: "test/cheap",
        input: { imageDataUrl: PNG, context: "" },
        status: "running",
        createdAt: Date.now(),
      }),
    ),
  );

  assert.equal(claims.filter((claim) => claim.status === "fulfilled").length, 50);
  assert.equal(claims.filter((claim) => claim.status === "rejected").length, 1);
  await h.store.prune(true);
  assert.equal((await h.store.stats()).unresolved, 50);
  assert.equal(h.calls.length, 0);
});

test("history exposes an older unresolved request beyond 150 newer saved answers", async (t) => {
  const h = await serviceHarness(t);
  await h.store.transaction(["jobs"], "readwrite", (tx) => {
    for (let index = 0; index <= 150; index++) {
      tx.objectStore("jobs").put({
        id: "history-" + index,
        kind: "translation",
        status: index ? "completed" : "interrupted",
        model: "test/cheap",
        input: { imageDataUrl: PNG, context: "" },
        createdAt: index + 1,
      });
    }
  });
  await h.store.prune();
  const history = await h.store.history();
  assert.equal(history.length, 151);
  assert.equal(history.at(-1).jobId, "history-0");
  assert.equal(history.at(-1).status, "interrupted");
});
