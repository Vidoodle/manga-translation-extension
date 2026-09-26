/* Safe Shadow DOM presentation. Reader is the controller; no remote HTML is inserted. */
(() => {
  "use strict";
  const vision =
    typeof module !== "undefined" && module.exports
      ? require("./vision.js")
      : globalThis.MangaVision;
  const { clamp, placeCard } = vision;
  const japanese =
    typeof module !== "undefined" && module.exports
      ? require("../shared/japanese.js")
      : globalThis.MangaJapanese;
  const models =
    typeof module !== "undefined" && module.exports
      ? require("../shared/models.js")
      : globalThis.MangaModels;

  class ReaderView {
    /** @param {SelectionOverlay} reader Session controller shared with this component. */
    constructor(reader) {
      this.reader = reader;
      this.cardCleanups = [];
    }

    mount(css) {
      // Reloading an extension can leave its old closed shadow tree in the page
      // after the content script and its event handlers have been invalidated.
      for (const host of this.reader.doc.querySelectorAll("[data-manga-selection-host]"))
        host.remove();
      this.host = this.node("div");
      this.host.setAttribute("data-manga-selection-host", "");
      Object.assign(this.host.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483647",
        pointerEvents: "none",
        margin: "0",
        padding: "0",
        border: "0",
      });
      this.shadow = this.host.attachShadow({ mode: "closed" });
      this.shadow.append(this.node("style", "", css));
      (this.reader.doc.fullscreenElement || this.reader.doc.documentElement).append(this.host);
      this.wordHelp = new japanese.WordHelp({
        doc: this.reader.doc,
        portal: this.shadow,
        viewport: () => this.reader.viewport,
      });
    }

    destroy() {
      this.wordHelp?.destroy();
      this.wordHelp = null;
      this.removeCard();
      this.host?.remove();
      for (const name of [
        "host",
        "shadow",
        "shield",
        "selection",
        "card",
        "cardHeader",
        "body",
        "instruction",
        "progress",
        "studyRoot",
        "setupNotice",
        "changeModelButton",
        "placementNotice",
      ])
        this[name] = null;
    }

    beginSelection() {
      this.wordHelp?.clear();
      this.removeCard();
      this.shield?.remove();
      this.selection?.remove();
      this.card = this.body = this.progress = this.studyRoot = null;
      this.shield = this.node("div", "shield");
      this.instruction = this.node(
        "div",
        "instruction",
        [
          "Drag over text to translate",
          this.reader.shortcut && `${this.reader.shortcut} for saved translations`,
          "Esc to cancel",
        ]
          .filter(Boolean)
          .join(" · "),
      );
      this.instruction.setAttribute("role", "status");
      this.selection = this.node("div", "selection dragging");
      this.selection.hidden = true;
      this.shield.append(this.instruction, this.selection);
      this.shadow.append(this.shield);
      for (const event of ["click", "dblclick", "contextmenu"])
        this.reader.listen(this.shield, event, (event) => this.reader.stopSelectionEvent(event));
      this.reader.listen(this.shield, "pointerdown", (event) => this.reader.beginDrag(event));
      this.reader.listen(this.shield, "pointermove", (event) => this.reader.updateDrag(event));
      this.reader.listen(this.shield, "pointerup", (event) => this.reader.finishDrag(event));
      this.reader.listen(this.shield, "pointercancel", () => this.reader.close());
    }

    node(tag, className, text) {
      const element = this.reader.doc.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = String(text);
      return element;
    }

    button(text, action, className = "") {
      const button = this.node("button", className, text);
      button.type = "button";
      button.addEventListener("pointerdown", (event) => {
        // Mouse actions should not make a reading page react to a focus change.
        // Keyboard focus and activation remain native.
        if (event.isTrusted && event.isPrimary !== false && event.button === 0)
          event.preventDefault();
      });
      button.addEventListener("click", (event) => {
        if (event.isTrusted) action(event);
      });
      return button;
    }

    icon(pathData) {
      const icon = this.reader.doc.createElementNS("http://www.w3.org/2000/svg", "svg"),
        path = this.reader.doc.createElementNS("http://www.w3.org/2000/svg", "path");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      icon.setAttribute("focusable", "false");
      path.setAttribute("d", pathData);
      icon.append(path);
      return icon;
    }

    requestButton(text, action, className = "") {
      const button = this.button(text, action, className);
      button.disabled = this.reader.setupRequired;
      return button;
    }

    updateSelection(rect) {
      Object.assign(this.selection.style, {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    }

    showSelectionCard() {
      this.shield?.remove();
      this.shield = null;
      this.selection?.remove();
      this.selection = null;
      this.makeCard();
    }

    listenCard(target, event, handler, options) {
      target.addEventListener(event, handler, options);
      this.cardCleanups.push(() => target.removeEventListener(event, handler, options));
    }

    removeCard() {
      this.cancelCardDrag();
      for (const cleanup of this.cardCleanups.splice(0)) cleanup();
      this.card?.remove();
      this.card = this.cardHeader = null;
    }

    makeCard({ title = "Translation", focus = true, library = false } = {}) {
      this.wordHelp?.clear();
      this.removeCard();
      this.card = this.node("section", "card");
      this.card.setAttribute("role", "region");
      this.card.setAttribute("aria-label", title);
      this.card.tabIndex = -1;
      for (const event of [
        "pointerdown",
        "pointerup",
        "pointermove",
        "mousedown",
        "mouseup",
        "mousemove",
        "click",
        "dblclick",
        "contextmenu",
        "keydown",
        "keyup",
        "touchstart",
        "touchmove",
        "touchend",
        "wheel",
      ])
        this.listenCard(this.card, event, (e) => e.stopPropagation(), { passive: true });
      this.positionCard();
      const header = this.node("div", "header"),
        actions = this.node("div", "header-actions"),
        close = this.button("", () => this.reader.close(), "close");
      this.cardHeader = header;
      header.setAttribute("title", "Drag to move");
      close.setAttribute("aria-label", "Close card");
      close.setAttribute("title", "Close card");
      close.append(this.icon("M6 6l12 12M6 18 18 6"));
      if (!library) {
        const saved = this.button("", () => this.reader.openLibrary(), "library-open");
        saved.setAttribute("aria-label", "Saved translations");
        saved.setAttribute("title", "Saved translations");
        saved.append(this.icon("M6 4h12v17l-6-4-6 4V4Z"));
        actions.append(saved);
      }
      actions.append(close);
      header.append(this.node("span", "title", title), actions);
      this.listenCard(header, "pointerdown", (event) => this.startCardDrag(event));
      this.listenCard(header, "pointermove", (event) => this.moveCardDrag(event));
      this.listenCard(header, "pointerup", (event) => this.finishCardDrag(event));
      this.listenCard(header, "pointercancel", (event) => this.cancelCardDrag(event));
      this.listenCard(header, "lostpointercapture", (event) => this.cancelCardDrag(event));
      this.setupNotice = this.node("p", "note");
      this.setupNotice.setAttribute("role", "status");
      this.placementNotice = this.node("p", "note");
      this.placementNotice.setAttribute("role", "status");
      this.body = this.node("div", "body");
      this.changeModelButton = null;
      this.card.append(header, this.setupNotice, this.placementNotice, this.body);
      this.updateSetup();
      this.updatePlacement();
      this.shadow.append(this.card);
      if (focus) this.card.focus({ preventScroll: true });
    }

    showLibrary(library) {
      this.shield?.remove();
      this.selection?.remove();
      this.shield = this.selection = null;
      this.makeCard({ title: "Saved translations", focus: false, library: true });
      this.renderLibrary(library);
    }

    renderLibrary(library) {
      this.wordHelp?.clear();
      this.body.replaceChildren();
      if (library.loading || library.opening) {
        const status = this.node(
          "p",
          "hint",
          library.loading ? "Loading saved translations…" : "Opening saved translation…",
        );
        status.setAttribute("role", "status");
        this.body.append(status);
      }
      if (library.error) {
        const error = this.node("p", "error", library.error);
        error.setAttribute("role", "alert");
        this.body.append(error);
      }
      if (!library.loading && !library.entries.length)
        this.body.append(
          library.error
            ? this.button("Try again", () => this.reader.openLibrary())
            : this.node(
                "p",
                "hint",
                "No saved translations yet. Close this list and select text to translate.",
              ),
        );
      const list = this.node("ol", "library-list");
      for (const entry of library.entries) {
        const item = this.node("li"),
          button = this.button("", () => this.reader.openHistory(entry.id), "library-entry"),
          preview = this.node(
            "span",
            "library-preview",
            String(
              entry.japanese ||
                (entry.status === "completed" ? "Saved translation" : "Unfinished translation"),
            ).slice(0, 150),
          );
        if (entry.japanese) preview.lang = "ja";
        button.disabled = !!library.opening;
        const state =
          {
            completed: "Saved",
            queued: "Queued",
            running: "Translating",
            interrupted: "Interrupted",
            failed: "Failed",
          }[entry.status] || "Unavailable";
        const date = new Date(entry.createdAt),
          when = Number.isFinite(date.getTime())
            ? date.toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : "Date unavailable";
        button.append(
          preview,
          this.node("span", "library-details", `${state} · ${when}`),
          this.node(
            "span",
            "library-details",
            `${models.modelName(entry.model)} · ${this.cost(entry)}`,
          ),
        );
        item.append(button);
        list.append(item);
      }
      if (library.entries.length) this.body.append(list);
    }

    positionCard() {
      if (!this.card) return;
      this.wordHelp?.clear();
      const place = placeCard(this.reader.cardPosition, this.reader.viewport);
      Object.assign(this.card.style, {
        left: `${place.x}px`,
        top: `${place.y}px`,
        transform: `translate(-${place.translateX}%, -${place.translateY}%)`,
        width: `${place.width}px`,
        maxHeight: `${place.maxHeight}px`,
      });
    }

    startCardDrag(event) {
      if (
        !event.isTrusted ||
        event.button !== 0 ||
        event.isPrimary === false ||
        event.target?.closest?.("button") ||
        this.cardDrag ||
        !this.card
      )
        return;
      this.reader.stopSelectionEvent(event);
      this.cardDrag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        dx: 0,
        dy: 0,
        box: this.card.getBoundingClientRect(),
        position: { ...this.reader.cardPosition },
        moved: false,
      };
      this.cardHeader.className = "header dragging";
      this.cardHeader.setPointerCapture(event.pointerId);
    }

    moveCardDrag(event) {
      const drag = this.cardDrag;
      if (!event.isTrusted || !drag || event.pointerId !== drag.pointerId) return;
      this.reader.stopSelectionEvent(event);
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      drag.moved = true;
      drag.dx = dx;
      drag.dy = dy;
      this.positionDraggedCard();
    }

    positionDraggedCard() {
      const drag = this.cardDrag;
      if (!drag || !this.card) return;
      const box = this.card.getBoundingClientRect(),
        { width, height } = this.reader.viewport,
        availableX = Math.max(0, width - box.width - 24),
        availableY = Math.max(0, height - box.height - 24);
      // New content can resize the card during a drag. Keep the same header offset.
      this.reader.cardPosition = {
        x: availableX ? clamp((drag.box.x + drag.dx - 12) / availableX, 0, 1) : drag.position.x,
        y: availableY ? clamp((drag.box.y + drag.dy - 12) / availableY, 0, 1) : drag.position.y,
      };
      this.positionCard();
    }

    finishCardDrag(event) {
      const drag = this.cardDrag;
      if (!event.isTrusted || !drag || event.pointerId !== drag.pointerId) return;
      this.moveCardDrag(event);
      this.cardDrag = null;
      this.cardHeader.className = "header";
      if (this.cardHeader.hasPointerCapture?.(event.pointerId))
        this.cardHeader.releasePointerCapture(event.pointerId);
      if (!drag.moved) return;
      const card = this.card;
      this.reader
        .send("save-card-position", { position: { ...this.reader.cardPosition } })
        .catch(() => {
          if (this.card === card && card.isConnected)
            this.body.append(
              this.node("p", "error", "Couldn’t save the card position. Drag it again to retry."),
            );
        });
    }

    cancelCardDrag(event) {
      const drag = this.cardDrag;
      if (!drag || (event && (!event.isTrusted || event.pointerId !== drag.pointerId))) return;
      this.cardDrag = null;
      this.reader.cardPosition = drag.position;
      this.cardHeader.className = "header";
      if (this.cardHeader.hasPointerCapture?.(drag.pointerId))
        this.cardHeader.releasePointerCapture(drag.pointerId);
      this.positionCard();
    }

    updatePlacement() {
      if (this.placementNotice) {
        this.placementNotice.hidden = !this.reader.selection.detachedMessage;
        this.placementNotice.textContent = this.reader.selection.detachedMessage;
      }
    }

    updateSetup() {
      if (this.setupNotice) {
        this.setupNotice.hidden = !this.reader.setupRequired;
        this.setupNotice.textContent = this.reader.setupWarning;
      }
      if (this.changeModelButton) this.changeModelButton.disabled = this.reader.setupRequired;
    }

    showSetupRequired() {
      this.shield?.remove();
      this.selection?.remove();
      this.shield = this.selection = null;
      this.makeCard();
      this.body.append(this.node("p", "hint", "Use the bookmark to read your saved translations."));
    }

    showCaptureError(message) {
      this.shield?.remove();
      this.selection?.remove();
      this.shield = this.selection = null;
      this.makeCard({ title: "Couldn’t read this page" });
      this.card.className = "card capture-error";
      this.host.style.visibility = "visible";
      this.showError(message);
      this.body.append(this.button("Close message", () => this.reader.close()));
    }

    thumbnail() {
      if (this.reader.selection.cropData) {
        const thumbnail = this.node("img", "thumbnail");
        thumbnail.src = this.reader.selection.cropData;
        thumbnail.alt = "Original selected manga area";
        this.body.append(thumbnail);
      }
    }

    showPending(text) {
      this.wordHelp?.clear();
      this.body.replaceChildren();
      this.thumbnail();
      const selection = this.reader.selection;
      selection.startedAt ??= Date.now();
      const pending = this.node("p", "pending"),
        elapsed = this.node("span", "elapsed");
      this.progress = this.node(
        "span",
        "request-status",
        text === "Translating selection…" ? "Translating…" : text,
      );
      this.progress.setAttribute("role", "status");
      elapsed.setAttribute("aria-hidden", "true");
      pending.append(this.progress, elapsed);
      this.body.append(pending);
      const generation = this.reader.generation;
      const tick = () => {
        if (
          !this.reader.valid(generation) ||
          this.reader.selection !== selection ||
          !elapsed.isConnected
        )
          return;
        elapsed.textContent = ` · ${Math.max(0, Math.floor((Date.now() - selection.startedAt) / 1000))}s`;
        this.reader.later(tick, 1000);
      };
      tick();
    }

    showError(message, check) {
      this.wordHelp?.clear();
      this.body.replaceChildren();
      this.thumbnail();
      const error = this.node("p", "error", message);
      error.setAttribute("role", "alert");
      this.body.append(error);
      if (check) {
        this.body.append(
          this.button("Check again", check),
          this.node(
            "p",
            "hint",
            "Checks the existing request without submitting another translation.",
          ),
        );
      }
    }

    showJobError(message, job) {
      this.showError(
        message,
        !job && this.reader.selection.translationJob ? () => this.reader.resumeTranslation() : null,
      );
      if (
        job &&
        this.reader.selection.translationJob &&
        (job.retryable !== false || job.status === "interrupted")
      ) {
        this.body.append(
          this.node(
            "p",
            "note",
            "The previous request may already have been charged. Retrying starts another request and may charge again.",
          ),
          this.requestButton(
            "Retry · may charge again",
            () => this.reader.retryTranslation(),
            "primary",
          ),
        );
      }
    }

    cost(result) {
      const cost = result?.usage?.cost_usd ?? result?.cost_usd;
      return typeof cost === "number" && Number.isFinite(cost)
        ? `$${cost.toFixed(5)} reported cost`
        : "Cost not reported";
    }

    renderTranslation() {
      if (!this.body || !this.reader.selection.run) return;
      this.wordHelp?.clear();
      this.body.replaceChildren();
      this.updatePlacement();
      this.thumbnail();
      if (this.reader.selection.cached)
        this.body.append(this.node("p", "saved-label", "Saved translation"));
      if (this.reader.selection.run.unsaved || this.reader.selection.run.storage_warning)
        this.body.append(
          this.node(
            "p",
            "error",
            this.reader.selection.run.storage_warning ||
              "This answer could not be saved. Keep it open; it will not be requested again automatically.",
          ),
        );
      const regions = this.reader.selection.run.analysis?.regions || [];
      if (!regions.length) {
        this.body.append(
          this.node("p", "hint", "No readable Japanese was found in this selection."),
        );
      } else {
        this.body.append(this.node("p", "eyebrow", "Japanese"));
        for (const region of regions)
          this.body.append(this.wordHelp.render(region.japanese, region.words));
        const translation = this.node("div", "section");
        translation.append(
          this.node("p", "eyebrow", "Translation"),
          this.node(
            "p",
            "translation natural",
            regions.map((region) => region.translation).join("\n\n"),
          ),
        );
        this.body.append(translation);
        this.studyRoot = this.node("div", "study");
        this.body.append(this.studyRoot);
        this.renderStudy();
      }
      this.renderModelInfo();
      this.positionDraggedCard();
    }

    renderModelInfo() {
      const result = this.reader.selection.run;
      const metadata = this.node("div", "model-info"),
        row = this.node("div", "model-row"),
        compareRoot = this.node("div", "compare");
      compareRoot.hidden = true;
      this.changeModelButton = this.requestButton(
        "",
        () => {
          compareRoot.hidden = !compareRoot.hidden;
          this.changeModelButton.setAttribute("aria-expanded", String(!compareRoot.hidden));
          if (!compareRoot.hidden && !compareRoot.children.length)
            this.showModelPicker(compareRoot);
        },
        "model-change",
      );
      this.changeModelButton.setAttribute("aria-label", "Change model");
      this.changeModelButton.setAttribute("title", "Change model");
      this.changeModelButton.setAttribute("aria-expanded", "false");
      this.changeModelButton.append(this.icon("M4 7h14m-4-4 4 4-4 4M20 17H6m4-4-4 4 4 4"));
      row.append(
        this.node("span", "model-name", models.modelName(result.model || this.reader.model)),
        this.changeModelButton,
      );
      const seconds = result.latency_ms ? `${(result.latency_ms / 1000).toFixed(1)}s · ` : "";
      metadata.append(row, this.node("p", "meta", `${seconds}${this.cost(result)}`));
      this.body.append(metadata, compareRoot);
    }

    async showModelPicker(root) {
      if (this.reader.setupRequired) return;
      const generation = this.reader.generation;
      root.replaceChildren(this.node("p", "hint", "Loading compatible models…"));
      try {
        const response = await this.reader.send("models");
        if (!this.reader.valid(generation) || !root.isConnected || this.reader.setupRequired)
          return;
        const catalog = response.catalog || {},
          select = this.node("select", "model-select");
        const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }),
          rate = (value) => (Number.isFinite(value) ? `$${formatter.format(value)}` : "unknown");
        select.setAttribute("aria-label", "Model for an alternative translation");
        select.append(this.node("option", "", "Choose a model"));
        select.children[0].value = "";
        for (const model of catalog.models || []) {
          const option = this.node(
            "option",
            "",
            `${model.name || models.modelName(model.id)} · ${rate(model.prompt_per_million)} in / ${rate(model.completion_per_million)} out per 1M`,
          );
          option.value = model.id;
          select.append(option);
        }
        const submit = this.button(
          "Translate with selected model",
          () => {
            if (select.value) this.reader.compareModel(select.value);
          },
          "primary",
        );
        submit.disabled = true;
        select.addEventListener("change", () => {
          submit.disabled = !select.value;
        });
        root.replaceChildren(
          select,
          this.node(
            "p",
            "hint",
            "Starts a separate paid translation; keeps the original in history. Token rates do not predict a selection's final cost.",
          ),
          submit,
        );
        if (catalog.source === "cached" || catalog.warning)
          root.append(
            this.node("p", "hint", catalog.warning || "Saved catalog; prices may have changed."),
          );
      } catch (error) {
        if (root.isConnected) root.replaceChildren(this.node("p", "error", error.message));
      }
    }

    renderStudy() {
      if (!this.studyRoot || !this.reader.selection.run) return;
      const grammar = this.reader.selection.run.analysis.regions.flatMap(
        (region) => region.grammar,
      );
      this.studyRoot.replaceChildren();
      this.studyRoot.hidden = !grammar.length;
      if (grammar.length) this.studyRoot.append(this.node("p", "eyebrow", "Grammar"));
      for (const item of grammar)
        this.studyRoot.append(
          this.node("h3", "section", item.pattern),
          this.node("p", "", item.explanation),
        );
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = ReaderView;
  else globalThis.ReaderView = ReaderView;
})();
