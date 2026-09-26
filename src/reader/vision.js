/* Pure geometry for selection, screenshot cropping and card placement. */
(() => {
  "use strict";
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function normalizeRect(start, end, viewport) {
    const left = clamp(Math.min(start.x, end.x), 0, viewport.width);
    const top = clamp(Math.min(start.y, end.y), 0, viewport.height);
    const right = clamp(Math.max(start.x, end.x), 0, viewport.width);
    const bottom = clamp(Math.max(start.y, end.y), 0, viewport.height);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function pixelCrop(rect, viewport, image) {
    if (
      ![viewport.width, viewport.height, image.width, image.height].every(
        (n) => Number.isFinite(n) && n > 0,
      )
    )
      throw new Error("The captured viewport has invalid dimensions.");
    const sx = image.width / viewport.width,
      sy = image.height / viewport.height;
    // Device pixels mapped to CSS coordinates and back can land a few floating
    // point bits outside an integer. Remove only that arithmetic noise before
    // rounding outward; real fractional selections still include every pixel.
    const edge = (value) => {
      const integer = Math.round(value);
      return Math.abs(value - integer) <= Number.EPSILON * Math.max(1, Math.abs(value)) * 4
        ? integer
        : value;
    };
    const left = clamp(Math.floor(edge(rect.x * sx)), 0, image.width);
    const top = clamp(Math.floor(edge(rect.y * sy)), 0, image.height);
    const right = clamp(Math.ceil(edge((rect.x + rect.width) * sx)), 0, image.width);
    const bottom = clamp(Math.ceil(edge((rect.y + rect.height) * sy)), 0, image.height);
    if (right <= left || bottom <= top) throw new Error("Select a larger area.");
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function placeCard(position, viewport, preferredWidth = 384) {
    const margin = 12,
      width = Math.min(preferredWidth, Math.max(0, viewport.width - margin * 2)),
      x = Number.isFinite(position?.x) ? clamp(position.x, 0, 1) : 1,
      y = Number.isFinite(position?.y) ? clamp(position.y, 0, 1) : 1;
    // Anchor the same fraction of the card and viewport together. The card can
    // grow as a result arrives without leaving the viewport or needing remeasurement.
    return {
      x: margin + Math.max(0, viewport.width - margin * 2) * x,
      y: margin + Math.max(0, viewport.height - margin * 2) * y,
      width,
      maxHeight: Math.max(0, viewport.height - margin * 2),
      translateX: x * 100,
      translateY: y * 100,
    };
  }

  const api = { clamp, normalizeRect, pixelCrop, placeCard };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.MangaVision = api;
})();
