"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vision = require("../src/reader/vision.js");
test("fractional display scales preserve pixel boundaries without clipping real fractions", () => {
  for (const scale of [1.25, 1.5, 1.75, 2.5]) {
    const viewport = { width: 1000, height: 800 };
    const screenshot = { width: 1000 * scale, height: 800 * scale };
    for (const rect of [
      { x: 11, y: 11, width: 32, height: 37 },
      { x: 10, y: 10, width: 97, height: 100 },
      { x: 76, y: 125, width: 161, height: 100 },
    ]) {
      const css = Object.fromEntries(
        Object.entries(rect).map(([key, value]) => [key, value / scale]),
      );
      assert.deepEqual(vision.pixelCrop(css, viewport, screenshot), rect);
    }
    assert.deepEqual(
      vision.pixelCrop(
        { x: 11 / scale, y: 11 / scale, width: 32.000001 / scale, height: 37.000001 / scale },
        viewport,
        screenshot,
      ),
      { x: 11, y: 11, width: 33, height: 38 },
    );
  }
});
