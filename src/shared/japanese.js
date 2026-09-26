/* Local word help from the saved model response. Optional mining uses the authenticated background connection. */
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
    constructor({ doc, portal, viewport, mine }) {
      this.mine = mine;
      this.mining = new Map();
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

    icon(pathData) {
      const svg = this.doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      const path = this.doc.createElementNS("http://www.w3.org/2000/svg", "path");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      path.setAttribute("d", pathData);
      svg.append(path);
      return svg;
    }

    render(japanese, words = [], context = null) {
      const paragraph = this.node("p", "japanese");
      for (const part of segments(japanese, words)) {
        if (!part.word) {
          paragraph.append(this.node("span", "jp-text", part.text));
          continue;
        }
        const button = this.node("button", "jp-word", part.text);
        button.type = "button";
        button.setAttribute("aria-label", `${part.text}: reading and meaning`);
        const show = (event, pin = false) => {
          if (event.isTrusted)
            this.show(
              button,
              part.word,
              context && { ...context, wordIndex: words.indexOf(part.word) },
              pin,
            );
        };
        button.addEventListener("pointerenter", show);
        button.addEventListener("focus", show);
        button.addEventListener("click", (event) => show(event, true));
        button.addEventListener("pointerleave", () => this.hideSoon());
        button.addEventListener("blur", () => this.hideSoon());
        paragraph.append(button);
      }
      return paragraph;
    }

    show(anchor, word, context, pin = false) {
      // Passive hover/focus must not replace a word the reader has chosen.
      if (this.pinned && !pin) return;
      clearTimeout(this.hideTimer);
      if (this.anchor === anchor && this.tip) {
        if (pin) this.pin();
        return;
      }
      this.clear();
      this.anchor = anchor;
      if (pin) this.pin();
      this.tip = this.node("div", "jp-gloss");
      this.tip.id = `manga-word-help-${++nextId}`;
      this.tip.setAttribute("role", "tooltip");
      anchor.setAttribute("aria-describedby", this.tip.id);
      const preview = {
        word: this.node("strong", "jp-surface", word.surface),
        reading: this.node("span", "jp-reading", word.reading || ""),
        meaning: this.node("p", "jp-meaning", word.meaning || ""),
      };
      this.tip.append(...Object.values(preview));
      if (context && this.mine) this.miningControls(word, context, preview);
      this.tip.addEventListener("focusin", () => clearTimeout(this.hideTimer));
      this.tip.addEventListener("focusout", () => this.hideSoon());
      this.tip.addEventListener("pointerenter", () => clearTimeout(this.hideTimer));
      this.tip.addEventListener("pointerleave", () => this.hideSoon());
      this.position();
    }

    pin() {
      this.pinned = true;
      this.anchor?.setAttribute("data-pinned", "");
    }

    position() {
      const anchor = this.anchor;
      const view = this.viewport(),
        width = Math.max(0, Math.min(280, view.width - 24));
      Object.assign(this.tip.style, {
        width: `${width}px`,
        maxHeight: `${Math.max(0, view.height - 24)}px`,
      });
      if (!this.tip.isConnected) this.portal.append(this.tip);
      const box = anchor.getBoundingClientRect(),
        height = this.tip.getBoundingClientRect().height,
        below = box.y + box.height + 8,
        top = below + height <= view.height - 12 ? below : box.y - height - 8;
      Object.assign(this.tip.style, {
        left: `${Math.max(12, Math.min(box.x, view.width - width - 12))}px`,
        top: `${Math.max(12, Math.min(top, view.height - height - 12))}px`,
      });
    }

    miningControls(word, context, preview) {
      const tip = this.tip;
      tip.setAttribute("role", "dialog");
      tip.setAttribute("aria-label", `${word.surface}: word help and Anki`);
      const identity = JSON.stringify([context.runId, context.regionIndex, context.wordIndex]);
      let state = this.mining.get(identity);
      if (!state) {
        state = {
          values: {
            word: word.surface,
            reading: word.reading || "",
            meaning: word.meaning || "",
            japanese: context.japanese,
            translation: context.translation,
          },
        };
        this.mining.set(identity, state);
      }
      const actions = this.node("div", "jp-actions");
      const add = this.node("button", "jp-action");
      add.type = "button";
      add.title = "Add to Anki";
      add.setAttribute("aria-label", "Add to Anki");
      const edit = this.node("button", "jp-action");
      edit.type = "button";
      edit.append(this.icon("m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"));
      edit.title = "Edit Anki note";
      edit.setAttribute("aria-label", edit.title);
      const status = this.node("p", "jp-status", "");
      status.setAttribute("role", "status");
      const editor = this.node("div", "jp-editor");
      editor.id = `${tip.id}-editor`;
      editor.hidden = true;
      edit.setAttribute("aria-controls", editor.id);
      const inputs = [];
      const paint = () => {
        if (state.added) editor.hidden = true;
        for (const [name, node] of Object.entries(preview)) node.textContent = state.values[name];
        edit.hidden = !editor.hidden || !!state.added;
        edit.setAttribute("aria-expanded", String(!editor.hidden));
        add.disabled = !!(state.pending || state.added || state.unknown || state.duplicate);
        edit.disabled = !!(state.pending || state.added || state.unknown || state.duplicate);
        for (const [, input] of inputs) input.disabled = edit.disabled;
        add.className = editor.hidden ? "jp-action" : "jp-action jp-action-label";
        add.replaceChildren(
          editor.hidden
            ? this.icon(state.added ? "m5 12 4 4L19 6" : "M12 5v14M5 12h14")
            : this.node("span", "", state.pending ? "Adding…" : "Add to Anki"),
        );
        add.setAttribute(
          "aria-label",
          state.added ? "Added to Anki" : state.pending ? "Adding to Anki" : "Add to Anki",
        );
        add.title = state.added ? "Added to Anki" : "Add to Anki";
        status.textContent = state.message || "";
      };
      edit.addEventListener("click", (event) => {
        if (!event.isTrusted || edit.disabled || edit.hidden) return;
        this.pin();
        if (!inputs.length) {
          for (const [name, label] of Object.entries({
            word: "Word",
            reading: "Reading",
            meaning: "Meaning",
            japanese: "Japanese context",
            translation: "Full translation",
          })) {
            const wrapper = this.node("label", "jp-edit-label", label);
            const input = this.node(
              name === "word" || name === "reading" ? "input" : "textarea",
              "jp-edit-input",
            );
            input.value = state.values[name];
            input.maxLength = 20000;
            input.addEventListener("input", () => {
              state.values[name] = input.value;
            });
            wrapper.append(input);
            editor.append(wrapper);
            inputs.push([name, input]);
          }
        }
        editor.hidden = false;
        paint();
        this.position();
        inputs[0][1].focus({ preventScroll: true });
      });
      add.addEventListener("click", async (event) => {
        if (!event.isTrusted || add.disabled) return;
        state.pending = true;
        state.message = "Adding to Anki…";
        this.pin();
        paint();
        try {
          const response = await this.mine(
            {
              runId: context.runId,
              regionIndex: context.regionIndex,
              wordIndex: context.wordIndex,
            },
            state.values,
          );
          state.added = true;
          state.message = `Added to ${response.deck}.`;
        } catch (error) {
          state.message = error.message;
          state.unknown = error.code === "anki-unknown";
          state.duplicate = error.code === "anki-duplicate";
        } finally {
          state.pending = false;
          state.update?.();
        }
      });
      actions.append(add, edit);
      tip.append(editor, actions, status);
      state.update = () => {
        if (this.tip === tip) {
          paint();
          this.position();
        }
      };
      paint();
    }

    hideSoon() {
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        const focused = this.portal.activeElement || this.doc.activeElement;
        if (!this.tip?.contains(focused) && !this.pinned) this.clear();
      }, 150);
    }

    clear() {
      clearTimeout(this.hideTimer);
      this.anchor?.removeAttribute?.("aria-describedby");
      this.anchor?.removeAttribute?.("data-pinned");
      this.tip?.remove();
      this.tip = this.anchor = null;
      this.pinned = false;
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
