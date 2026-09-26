/* Settings and catalog boundary. The API key is never returned to reader code. */
(() => {
  "use strict";

  const KEY = "openRouterApiKey";
  const CARD_POSITION = "readerCardPosition";
  const CATALOG = "mangaModelCatalog";
  const ORIGINS = ["https://openrouter.ai/*"];
  const CATALOG_TTL = 24 * 60 * 60 * 1000;

  function catalogError(message, cause) {
    const error = new Error(message, { cause });
    error.code = "catalog";
    return error;
  }

  function cardPosition(value) {
    return value &&
      !Array.isArray(value) &&
      [value.x, value.y].every(
        (coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1,
      )
      ? { x: value.x, y: value.y }
      : null;
  }

  class SettingsService {
    constructor(extension, provider, fetcher = globalThis.fetch.bind(globalThis)) {
      this.extension = extension;
      this.provider = provider;
      this.fetcher = fetcher;
      this.catalogRequest = null;
      this.setupWrite = Promise.resolve();
    }

    changeSetup(change) {
      // Popup closure does not cancel its background writes. Keep a later reset
      // behind earlier saves so an old validation result cannot undo it.
      const write = this.setupWrite.catch(() => {}).then(change);
      this.setupWrite = write;
      return write;
    }

    async local(operation, value) {
      try {
        return await this.extension.storage.local[operation](value);
      } catch (cause) {
        if (
          cause?.name !== "SecurityError" &&
          !/SecurityError|insecure/i.test(cause?.message || "")
        )
          throw cause;
        const action = operation === "get" ? "reading" : "saving";
        const error = new Error(
          `Firefox blocked ${action} extension settings. Restart Firefox, reopen the extension, and try again.`,
          { cause },
        );
        error.code = "settings-storage";
        throw error;
      }
    }

    async config() {
      const stored = await this.local("get", [
        KEY,
        "selectedModel",
        "ankiMining",
        "ankiSetupPending",
      ]);
      return {
        key_configured: Boolean(stored[KEY]),
        anki_enabled: Boolean(stored.ankiMining?.enabled),
        anki_setup_pending: Boolean(stored.ankiSetupPending),
        model: stored.selectedModel || "",
        shortcut: await this.shortcut(),
      };
    }

    async cardPosition() {
      const stored = await this.local("get", CARD_POSITION);
      return cardPosition(stored[CARD_POSITION]) || { x: 1, y: 1 };
    }

    async saveCardPosition(value) {
      const position = cardPosition(value);
      if (!position) throw new Error("Choose a valid card position within the reading window.");
      await this.local("set", { [CARD_POSITION]: position });
    }

    async setup(config) {
      config ||= await this.config();
      if (!config.key_configured)
        return {
          code: "setup-key",
          message: "Save your OpenRouter key in extension settings before translating.",
        };
      if (!this.provider.validModel(config.model))
        return {
          code: "setup-model",
          message: "Choose a model in extension settings before translating.",
        };
      if (!(await this.hasPermission()))
        return {
          code: "setup-access",
          message: "Allow OpenRouter access in extension settings before translating.",
        };
      return null;
    }

    async key() {
      return (await this.local("get", KEY))[KEY] || "";
    }

    async saveKey(value) {
      const key = typeof value === "string" ? value.trim() : "";
      if (key.length < 8 || key.length > 500 || !/^[\x21-\x7e]+$/.test(key))
        throw new Error("Enter a valid OpenRouter key without spaces or line breaks.");
      await this.changeSetup(() => this.local("set", { [KEY]: key }));
    }

    async removeKey() {
      await this.changeSetup(() => this.local("remove", KEY));
    }

    async resetSetup() {
      await this.changeSetup(() =>
        this.local("remove", [KEY, "selectedModel", "ankiSetupPending"]),
      );
    }

    async finishSetup() {
      await this.changeSetup(() => this.local("remove", "ankiSetupPending"));
    }

    async hasPermission() {
      return this.extension.permissions.contains({ origins: ORIGINS });
    }

    async requireNetwork() {
      if (!(await this.hasPermission())) {
        const error = new Error(
          "Open extension settings and allow access to OpenRouter before making a new request.",
        );
        error.code = "setup-access";
        throw error;
      }
    }

    async shortcut() {
      return (
        (await this.extension.commands.getAll()).find((command) => command.name === "select-manga")
          ?.shortcut || ""
      );
    }

    async changeShortcut(action, shortcut) {
      if (action === "reset") await this.extension.commands.reset("select-manga");
      else if (action === "disable")
        await this.extension.commands.update({ name: "select-manga", shortcut: "" });
      else if (
        action === "set" &&
        typeof shortcut === "string" &&
        shortcut.length <= 80 &&
        shortcut.trim()
      ) {
        // Firefox owns binding validation; failed updates preserve the old command.
        await this.extension.commands.update({ name: "select-manga", shortcut: shortcut.trim() });
      } else throw new Error("Choose a supported shortcut, reset it, or disable it.");
      const actual = await this.shortcut();
      await this.extension.action.setTitle({
        title: actual ? "Select manga text (" + actual + ")" : "Select manga text",
      });
      return actual;
    }

    async models(force = false) {
      const saved = (await this.local("get", CATALOG))[CATALOG];
      if (!force && saved?.models?.length && Date.now() - saved.fetchedAt < CATALOG_TTL)
        return { ...saved, source: "cached" };
      if (this.catalogRequest) return this.catalogRequest;
      this.catalogRequest = (async () => {
        let phase = "request";
        try {
          await this.requireNetwork();
          const response = await this.fetcher(this.provider.API + "/models", {
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok)
            throw catalogError(
              `OpenRouter could not provide the model list (HTTP ${response.status}). Try again later.`,
            );
          phase = "response";
          const models = this.provider.filterModels(await response.json());
          if (!models.length)
            throw catalogError(
              "OpenRouter currently lists no compatible image models with structured output. Try refreshing later.",
            );
          const catalog = { models, fetchedAt: Date.now(), source: "live" };
          phase = "cache";
          await this.local("set", { [CATALOG]: catalog });
          return catalog;
        } catch (error) {
          if (saved?.models?.length)
            return {
              ...saved,
              source: "cached",
              warning: "Live prices could not be refreshed. These cached prices may be stale.",
            };
          if (["setup-access", "settings-storage", "catalog"].includes(error.code)) throw error;
          let message;
          if (phase === "cache")
            message =
              error.name === "QuotaExceededError"
                ? "Firefox could not save the model list. Free some browser storage and try again."
                : "Firefox could not save the model list on this device. Try again.";
          else if (error.name === "TimeoutError" || error.name === "AbortError")
            message = "OpenRouter took too long to return the model list. Try again.";
          else if (phase === "response")
            message = "OpenRouter returned an unreadable model list. Try refreshing later.";
          else
            message =
              "Could not load the model list from OpenRouter. Check your connection and try again.";
          throw catalogError(message, error);
        } finally {
          this.catalogRequest = null;
        }
      })();
      return this.catalogRequest;
    }

    async ensureModel(model) {
      if (!this.provider.validModel(model))
        throw new Error("Choose a model in extension settings before translating.");
      const catalog = await this.models();
      if (!catalog.models.some((item) => item.id === model))
        throw new Error(
          "This model is not listed as compatible. Choose another model explicitly in settings.",
        );
      return model;
    }

    async saveModel(model) {
      await this.changeSetup(async () => {
        await this.ensureModel(model);
        const stored = await this.local("get", "selectedModel");
        await this.local("set", {
          selectedModel: model,
          ...(!stored.selectedModel ? { ankiSetupPending: true } : {}),
        });
      });
    }
  }

  globalThis.MangaSettings = { SettingsService };
  if (typeof module !== "undefined" && module.exports) module.exports = { SettingsService };
})();
