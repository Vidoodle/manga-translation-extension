"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  pages,
  reader,
  jobs,
  serviceHarness,
  selection,
  viewport,
  rect,
  PNG,
  settle: settleJobs,
} = require("./core-helpers.cjs");

test("region metadata and lightweight page reads retain actual completed crops and document scope", async (t) => {
  const h = await serviceHarness(t);
  const service = new pages.PageService(h.store, reader, jobs);
  const scope = "https://reader.example/book";
  const pageId = await service.save(scope, {
    imageDataUrl: PNG,
    viewport,
    descriptor: { version: 1 },
  });
  assert.equal((await service.list(scope))[0].regionCount, 0);
  await h.service.translation(selection({ association: { id: "saved", pageId, rect, viewport } }));
  await settleJobs(h.service);

  const listed = await service.list(scope);
  const read = await service.get(scope, pageId, { includeReference: false });

  assert.equal(listed[0].regionCount, 1);
  assert.equal(read.page.imageDataUrl, undefined);
  assert.equal(read.regions[0].imageDataUrl, PNG);
  assert.equal((await service.get(scope, pageId)).page.imageDataUrl, PNG);
  await assert.rejects(
    service.get("https://reader.example/another", pageId, { includeReference: false }),
    /another reading document/,
  );
});

test("protected older page references remain discoverable beyond the ordinary page budget", async () => {
  const scope = "https://reader.example/book";
  const references = Array.from({ length: 151 }, (_, index) => ({
    id: `page-${index}`,
    scope,
    updatedAt: index,
    imageDataUrl: PNG,
  }));
  const service = new pages.PageService(
    {
      all: async (name) =>
        name === "pages"
          ? [...references, { id: "other-book", scope: "other", updatedAt: 1000 }]
          : [{ pageId: "page-0", runId: "protected-answer" }],
    },
    reader,
    jobs,
  );
  const listed = await service.list(scope);
  assert.equal(listed.length, 151, "retention, not listing, owns the ordinary page limit");
  assert.equal(listed.at(-1).id, "page-0");
  assert.equal(listed.at(-1).regionCount, 1);
  assert.equal(listed.at(-1).imageDataUrl, undefined);
  assert.equal(
    listed.some((page) => page.id === "other-book"),
    false,
  );
});
