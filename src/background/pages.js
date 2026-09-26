/* Local reference views and spatial associations, scoped to the reader document. */
(() => {
  "use strict";

  const MAX_IMAGE_LENGTH = 28 * 1024 * 1024;

  function image(value) {
    if (
      typeof value !== "string" ||
      value.length > MAX_IMAGE_LENGTH ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value)
    )
      throw new Error("The selected image is invalid or too large. Select a smaller area.");
    return value;
  }

  class PageService {
    constructor(store, geometry, identifiers) {
      this.store = store;
      this.geometry = geometry;
      this.identifiers = identifiers;
    }

    async list(scope) {
      const [pages, regions] = await Promise.all([
        this.store.all("pages"),
        this.store.all("regions"),
      ]);
      const counts = new Map();
      for (const region of regions) counts.set(region.pageId, (counts.get(region.pageId) || 0) + 1);
      return pages
        .filter((page) => page.scope === scope)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((page) => {
          const { imageDataUrl, ...metadata } = page;
          return { ...metadata, regionCount: counts.get(page.id) || 0 };
        });
    }

    async get(scope, id, { includeReference = true } = {}) {
      const result = await this.store.page(id);
      if (!result.page || result.page.scope !== scope)
        throw new Error("This page reference belongs to another reading document or has expired.");
      if (!includeReference) {
        const { imageDataUrl, ...metadata } = result.page;
        return { ...result, page: metadata };
      }
      return result;
    }

    async save(scope, value) {
      if (!value || typeof value !== "object") throw new Error("The page reference is invalid.");
      const viewport = this.geometry.viewport(value.viewport);
      if (!viewport) throw new Error("The page reference has an invalid viewport.");
      image(value.imageDataUrl);
      if (
        !value.descriptor ||
        typeof value.descriptor !== "object" ||
        JSON.stringify(value.descriptor).length > 200000
      )
        throw new Error("The page fingerprint is invalid or too large.");
      const surface = value.surface
        ? this.geometry.rectangle(value.surface, viewport, 1)
        : undefined;
      if (value.surface && !surface) throw new Error("The page surface lies outside the viewport.");
      if (surface) {
        if (
          !["canvas", "img", "iframe", "viewport", "spread"].includes(value.surface.kind) ||
          typeof value.surface.complete !== "boolean"
        ) {
          throw new Error("The page surface has invalid recognition metadata.");
        }

        surface.kind = value.surface.kind;
        surface.complete = value.surface.complete;
      }
      let previous;
      if (value.id) previous = (await this.get(scope, value.id)).page;
      if (value.logicalPageId) await this.get(scope, value.logicalPageId);
      const page = {
        id: previous?.id || this.identifiers.id(),
        scope,
        imageDataUrl: value.imageDataUrl,
        descriptor: value.descriptor,
        viewport,
        ...(surface ? { surface } : {}),
        createdAt: previous?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      for (const field of ["bookKey", "pageKey", "logicalPageId"])
        if (typeof value[field] === "string" && value[field].length <= 500)
          page[field] = value[field];
      await this.store.savePage(page);
      await this.store.prune();
      if (!(await this.store.get("pages", page.id)))
        throw new Error(
          "The page-reference cache is full. You can still translate without saved page placement.",
        );
      return page.id;
    }

    async association(scope, value) {
      const viewport = this.geometry.viewport(value.viewport);
      const rect = this.geometry.rectangle(value.rect, viewport);
      if (!viewport || !rect) throw new Error("Select a rectangle inside the visible page.");
      if (value.pageId) await this.get(scope, value.pageId);
      return {
        id: await this.identifiers.digest(
          JSON.stringify([value.pageId || "", rect, viewport, value.imageDataUrl]),
        ),
        ...(value.pageId ? { pageId: value.pageId } : {}),
        rect,
        viewport,
      };
    }
  }

  globalThis.MangaPages = { PageService, image };
  if (typeof module !== "undefined" && module.exports) module.exports = globalThis.MangaPages;
})();
