/* One screenshot per explicit selection. Saved answers are browsed in the in-page library. */
(() => {
  "use strict";
  const { pixelCrop } =
    typeof module !== "undefined" && module.exports
      ? require("./vision.js")
      : globalThis.MangaVision;

  class SelectionCapture {
    constructor(reader) {
      this.reader = reader;
      this.captureQueue = Promise.resolve();
    }

    frame() {
      return new Promise((resolve) => this.reader.win.requestAnimationFrame(resolve));
    }

    capture(generation, viewport) {
      const operation = this.captureQueue
        .catch(() => {})
        .then(async () => {
          if (!this.reader.valid(generation) || this.reader.captureError) return null;
          const host = this.reader.ui.host;
          host.style.visibility = "hidden";
          try {
            await this.frame();
            await this.frame();
            if (!this.reader.valid(generation)) return null;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const screenshot = await this.reader.send("capture", { viewport });
                return screenshot.imageDataUrl;
              } catch (error) {
                if (error.code !== "capture-throttled" || attempt === 2) throw error;
                host.style.visibility = "visible";
                await new Promise((resolve) =>
                  this.reader.win.setTimeout(
                    resolve,
                    Math.min(1500, Math.max(100, error.retryAfterMs || 1100)),
                  ),
                );
                if (!this.reader.valid(generation)) return null;
                host.style.visibility = "hidden";
                await this.frame();
                await this.frame();
              }
            }
          } finally {
            if (host.isConnected) host.style.visibility = "visible";
          }
        });
      this.captureQueue = operation;
      return operation;
    }

    async cropScreenshot(dataUrl, rect, viewport) {
      const image = await new Promise((resolve, reject) => {
        const image = new this.reader.win.Image();
        image.onload = () => resolve(image);
        image.onerror = () => {
          const error = new Error(
            "The captured screenshot could not be read. Error code: screenshot-read.",
          );
          error.code = "screenshot-read";
          reject(error);
        };
        image.src = dataUrl;
      });
      const pixels = pixelCrop(rect, viewport, {
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
      const canvas = this.reader.doc.createElement("canvas");
      canvas.width = pixels.width;
      canvas.height = pixels.height;
      try {
        // Draw the original screenshot Image. Firefox can make a canvas copied
        // from another selectively readable canvas write-only.
        canvas
          .getContext("2d")
          .drawImage(
            image,
            pixels.x,
            pixels.y,
            pixels.width,
            pixels.height,
            0,
            0,
            pixels.width,
            pixels.height,
          );
        return canvas.toDataURL("image/png");
      } catch (cause) {
        if (cause?.name !== "SecurityError" && cause?.code !== 18) throw cause;
        const error = new Error(
          "The extension could not prepare the selected screenshot for translation. Error code: screenshot-crop.",
          { cause },
        );
        error.code = "screenshot-crop";
        throw error;
      }
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = SelectionCapture;
  else globalThis.SelectionCapture = SelectionCapture;
})();
