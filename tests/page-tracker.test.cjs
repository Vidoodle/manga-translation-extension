const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./reader-harness.cjs");

for (const scenario of [
  {
    name: "a nonzero selection offset",
    viewport: { width: 16, height: 12 },
    rect: { x: 2, y: 1, width: 5, height: 4 },
    expected: { x: 2, y: 1, width: 5, height: 4 },
  },
  {
    name: "a fractional selection at 2x resolution",
    viewport: { width: 8, height: 6 },
    rect: { x: 2.25, y: 1.25, width: 3, height: 2.25 },
    expected: { x: 4, y: 2, width: 7, height: 5 },
  },
]) {
  test(`one selected-size canvas exports exact pixels for ${scenario.name}`, async () => {
    const env = harness();
    const source = { width: 16, height: 12, data: new Uint8ClampedArray(16 * 12 * 4) };
    for (let y = 0; y < source.height; y++)
      for (let x = 0; x < source.width; x++)
        source.data.set([x * 13, y * 19, (x * 31 + y * 17) % 256, 255], (y * source.width + x) * 4);
    env.images.set("fixture:screenshot", source);
    const createElement = env.doc.createElement;
    const canvases = [];
    env.doc.createElement = (tag) => {
      const canvas = createElement(tag);
      if (tag !== "canvas") return canvas;
      canvases.push(canvas);
      const getContext = canvas.getContext;
      canvas.getContext = (...args) => {
        const context = getContext.apply(canvas, args);
        const drawImage = context.drawImage;
        context.drawImage = (image, ...coordinates) => {
          assert.ok(
            image instanceof env.win.Image,
            "crop directly from the screenshot Image, never a restricted canvas copy",
          );
          return drawImage.call(context, image, ...coordinates);
        };
        context.getImageData = () => {
          throw new Error("No screenshot pixels should be read into JavaScript");
        };
        return context;
      };
      return canvas;
    };
    const dataUrl = await env.overlay.tracker.cropScreenshot(
      "fixture:screenshot",
      scenario.rect,
      scenario.viewport,
    );
    const exported = env.images.get(dataUrl);
    const { x, y, width, height } = scenario.expected;
    assert.equal(canvases.length, 1);
    assert.equal(canvases[0].width, width);
    assert.equal(canvases[0].height, height);
    const expected = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++)
      for (let column = 0; column < width; column++) {
        const offset = ((y + row) * source.width + x + column) * 4;
        expected.set(source.data.subarray(offset, offset + 4), (row * width + column) * 4);
      }
    assert.deepEqual(exported.data, expected);
    assert.deepEqual(env.calls, []);
  });
}

test("an unreadable screenshot reports the read stage without allocating a canvas", async () => {
  const env = harness();
  const createElement = env.doc.createElement;
  env.doc.createElement = (tag) => {
    assert.notEqual(tag, "canvas");
    return createElement(tag);
  };
  await assert.rejects(
    env.overlay.tracker.cropScreenshot(
      "fixture:missing",
      { x: 0, y: 0, width: 20, height: 20 },
      { width: 600, height: 400 },
    ),
    { code: "screenshot-read" },
  );
});
