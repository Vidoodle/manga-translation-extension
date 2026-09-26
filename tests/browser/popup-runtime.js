/* Test-only browser API shim. In-memory fake data; no credentials or provider requests. */
(() => {
  "use strict";
  const scenario = new URLSearchParams(location.search).get("scenario") || "ready";
  const calls = [];
  const firstRun = ["setup", "setup-granted"].includes(scenario);
  const settingsKey = `popup-fixture-settings-${scenario}`;
  const settings = JSON.parse(sessionStorage.getItem(settingsKey) || "null") || {
    key_configured: !firstRun && scenario !== "key-removed",
    model: firstRun || scenario === "catalog-error" ? "" : "google/gemini-3-flash-preview",
    shortcut: "Alt+Q",
  };
  const persistSettings = () => sessionStorage.setItem(settingsKey, JSON.stringify(settings));
  let permission = !["setup", "permission-denied"].includes(scenario);
  const catalog = {
    source: scenario === "offline" ? "cached" : "live",
    fetchedAt: "2026-09-24T16:00:00Z",
    warning:
      scenario === "catalog-live"
        ? ""
        : scenario === "offline"
          ? "Fixture offline mode: showing the saved catalog."
          : "Test fixture: simulated catalog and requests.",
    models: [
      {
        id: "google/gemini-3.1-flash-lite",
        name: "Google: Gemini 3.1 Flash Lite",
        prompt_per_million: 0.25,
        completion_per_million: 1.5,
      },
      {
        id: "openai/gpt-6-luna",
        name: "OpenAI: GPT-6 Luna",
        prompt_per_million: 0.1,
        completion_per_million: 0.5,
      },
      {
        id: "qwen/qwen3.8-flash",
        name: "Qwen: Qwen3.8 Flash",
        prompt_per_million: 0.15,
        completion_per_million: 0.47,
      },
      {
        id: "google/gemini-3-flash-preview",
        name: "Google: Gemini 3 Flash Preview",
        prompt_per_million: 0.5,
        completion_per_million: 3,
      },
      {
        id: "google/gemini-3.1-pro-preview",
        name: "Google: Gemini 3.1 Pro Preview",
        prompt_per_million: 2,
        completion_per_million: 12,
      },
      {
        id: "anthropic/claude-opus-4.6",
        name: "Anthropic: Claude Opus 4.6",
        prompt_per_million: 5,
        completion_per_million: 25,
      },
      {
        id: "openai/gpt-5.6-sol",
        name: "OpenAI: GPT-5.6 Sol",
        prompt_per_million: 2,
        completion_per_million: 10,
      },
      {
        id: "fixture/quick-vision",
        name: "Fixture quick vision",
        prompt_per_million: 0.1,
        completion_per_million: 0.5,
      },
      {
        id: "fixture/balanced-vision",
        name: "Fixture balanced vision",
        prompt_per_million: 0.25,
        completion_per_million: 1.5,
      },
      {
        id: "fixture/detail-vision",
        name: "Fixture detailed vision",
        prompt_per_million: 2,
        completion_per_million: 10,
      },
      {
        id: "fixture/unknown-price",
        name: "Fixture unknown pricing",
        prompt_per_million: null,
        completion_per_million: null,
      },
    ],
  };
  let stats =
    firstRun || scenario === "empty"
      ? { entries: 0, pages: 0, bytes: 0, unresolved: 0 }
      : { entries: 8, pages: 3, bytes: 2400000, unresolved: 1 };

  function copy(value) {
    return structuredClone(value);
  }

  function changeShortcut(message) {
    if (message.action === "disable") settings.shortcut = "";
    else if (message.action === "reset") settings.shortcut = "Alt+Q";
    else if (/^(?:Alt|Ctrl)(?:\+Shift)?\+[A-Z0-9]$/.test(message.shortcut || ""))
      settings.shortcut = message.shortcut;
    else return { ok: false, error: "Fixture rejected this unsupported shortcut." };
    return { ok: true, shortcut: settings.shortcut };
  }

  async function sendMessage(message) {
    // Log only the message type. In particular, never store a pasted key in fixture state.
    calls.push(message.type);
    switch (message.type) {
      case "manga:popup-config":
        return { ok: true, config: copy(settings) };
      case "manga:popup-models":
        if (scenario === "catalog-error")
          return {
            ok: false,
            error: "OpenRouter could not be reached. Check your connection and try again.",
          };
        return { ok: true, catalog: copy(catalog) };
      case "manga:popup-save-model": {
        if (!catalog.models.some((model) => model.id === message.model))
          return { ok: false, error: "Unknown fixture model." };
        settings.model = message.model;
        persistSettings();
        return { ok: true };
      }
      case "manga:popup-save-key": {
        if (!String(message.apiKey || "").trim())
          return { ok: false, error: "Enter a fake value to exercise this fixture." };
        settings.key_configured = true;
        persistSettings();
        return { ok: true };
      }
      case "manga:popup-remove-key":
        settings.key_configured = false;
        persistSettings();
        return { ok: true };
      case "manga:popup-reset-setup":
        settings.key_configured = false;
        settings.model = "";
        persistSettings();
        return { ok: true };
      case "manga:popup-shortcut":
        return changeShortcut(message);
      case "manga:popup-cache-stats":
        if (scenario === "cache-blocked")
          return {
            ok: false,
            code: "storage",
            error:
              "Firefox blocked access to the extension's local cache. Restart Firefox and reopen the extension. (Simulated fixture error.)",
          };
        return { ok: true, stats: copy(stats) };
      case "manga:popup-clear-cache": {
        stats = { entries: 0, pages: 0, bytes: 1024, unresolved: 1 };
        return { ok: true, stats: copy(stats) };
      }
      default:
        return { ok: false, error: `Unsupported fixture message: ${message.type}` };
    }
  }

  globalThis.browser = {
    runtime: { sendMessage },
    tabs: {
      async query() {
        throw new Error("The configuration popup must not access reading tabs.");
      },
    },
    permissions: {
      async contains() {
        return permission;
      },
      async request() {
        permission = scenario !== "permission-denied";
        return permission;
      },
    },
  };
  globalThis.popupFixture = {
    calls,
    getState() {
      return copy({ scenario, settings, permission, stats });
    },
  };
  // Configuration changes stay in the popup; reading uses the keyboard shortcut.
  window.close = () => {
    throw new Error("The configuration popup must not close itself to launch reading UI.");
  };
})();
