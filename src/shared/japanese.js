/* Local word help from the saved model response. Never requests network data. */
(() => {
  "use strict";
  let nextId = 0;

  function segments(japanese, words = []) {
    const source = String(japanese || ""),
      vocabulary = words
        .filter(
          (word) =>
            typeof word?.surface === "string" && word.surface && source.includes(word.surface),
        )
        .sort((a, b) => b.surface.length - a.surface.length),
      result = [];
    let plain = "";
    for (let offset = 0; offset < source.length;) {
      const word = vocabulary.find((item) => source.startsWith(item.surface, offset));
      if (word) {
        if (plain) result.push({ text: plain });
        plain = "";
        result.push({ text: word.surface, word });
        offset += word.surface.length;
      } else plain += source[offset++];
    }
    if (plain) result.push({ text: plain });
    return result;
  }

  class WordHelp {
    constructor({ doc, portal, viewport }) {
      this.doc = doc;
      this.portal = portal;
      this.viewport =
        viewport ||
        (() => ({ width: doc.defaultView.innerWidth, height: doc.defaultView.innerHeight }));
      this.onOutside = (event) => {
        if (!event.isTrusted || !this.tip) return;
        // A closed ShadowRoot hides its internal path from document listeners.
        // Its own listener below handles those clicks with the actual target.
        if (this.portal.host && event.target === this.portal.host) return;
        const path = event.composedPath?.() || [];
        if (
          !path.includes(this.anchor) &&
          !path.includes(this.tip) &&
          !this.tip.contains(event.target)
        )
          this.clear();
      };
      this.onKey = (event) => {
        if (event.isTrusted && event.key === "Escape" && this.tip) {
          this.clear();
          event.preventDefault();
          event.stopImmediatePropagation?.();
        }
      };
      this.onScroll = (event) => {
        if (this.tip && event.target !== this.tip && !this.tip.contains(event.target)) this.clear();
      };
      doc.addEventListener("pointerdown", this.onOutside, true);
      doc.addEventListener("keydown", this.onKey, true);
      doc.addEventListener("scroll", this.onScroll, true);
      portal.addEventListener("pointerdown", this.onOutside, true);
      portal.addEventListener("scroll", this.onScroll, true);
    }

    node(tag, className, text) {
      const node = this.doc.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    render(japanese, words = []) {
      const paragraph = this.node("p", "japanese");
      for (const part of segments(japanese, words)) {
        if (!part.word) {
          paragraph.append(this.node("span", "jp-text", part.text));
          continue;
        }
        const button = this.node("button", "jp-word", part.text);
        button.type = "button";
        button.setAttribute("aria-label", `${part.text}: reading and meaning`);
        const show = (event) => {
          if (event.isTrusted) this.show(button, part.word);
        };
        button.addEventListener("pointerenter", show);
        button.addEventListener("focus", show);
        button.addEventListener("click", show);
        button.addEventListener("pointerleave", () => this.hideSoon());
        button.addEventListener("blur", () => this.hideSoon());
        paragraph.append(button);
      }
      return paragraph;
    }

    show(anchor, word) {
      clearTimeout(this.hideTimer);
      if (this.anchor === anchor && this.tip) return;
      this.clear();
      this.anchor = anchor;
      this.tip = this.node("div", "jp-gloss");
      this.tip.id = `manga-word-help-${++nextId}`;
      this.tip.setAttribute("role", "tooltip");
      anchor.setAttribute("aria-describedby", this.tip.id);
      this.tip.append(
        this.node("strong", "jp-surface", word.surface),
        this.node("span", "jp-reading", word.reading || ""),
        this.node("p", "jp-meaning", word.meaning || ""),
      );
      this.tip.addEventListener("pointerenter", () => clearTimeout(this.hideTimer));
      this.tip.addEventListener("pointerleave", () => this.hideSoon());
      const view = this.viewport(),
        width = Math.max(0, Math.min(280, view.width - 24));
      Object.assign(this.tip.style, {
        width: `${width}px`,
        maxHeight: `${Math.max(0, view.height - 24)}px`,
      });
      this.portal.append(this.tip);
      const box = anchor.getBoundingClientRect(),
        height = this.tip.getBoundingClientRect().height,
        below = box.y + box.height + 8,
        top = below + height <= view.height - 12 ? below : box.y - height - 8;
      Object.assign(this.tip.style, {
        left: `${Math.max(12, Math.min(box.x, view.width - width - 12))}px`,
        top: `${Math.max(12, Math.min(top, view.height - height - 12))}px`,
      });
    }

    hideSoon() {
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => this.clear(), 150);
    }

    clear() {
      clearTimeout(this.hideTimer);
      this.anchor?.removeAttribute?.("aria-describedby");
      this.tip?.remove();
      this.tip = this.anchor = null;
    }

    destroy() {
      this.clear();
      this.doc.removeEventListener("pointerdown", this.onOutside, true);
      this.doc.removeEventListener("keydown", this.onKey, true);
      this.doc.removeEventListener("scroll", this.onScroll, true);
      this.portal.removeEventListener("pointerdown", this.onOutside, true);
      this.portal.removeEventListener("scroll", this.onScroll, true);
    }
  }
  const api = { segments, WordHelp };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.MangaJapanese = api;
})();
