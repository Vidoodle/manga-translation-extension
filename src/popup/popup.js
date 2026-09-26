"use strict";
const extension = globalThis.browser ?? globalThis.chrome;
const format = globalThis.MangaPopupFormat;
const $ = (id) => document.getElementById(id);
const OPENROUTER_ORIGINS = ["https://openrouter.ai/*"];
let config = { model: "", key_configured: false, shortcut: "" };
let configLoaded = false;
let catalog = { models: [] };
let hasAccess = false;
let modelSaving = false;
let keySaving = false;
let catalogLoading = false;
let cacheAvailable = null;
let step = "loading";
let returningSettings = false;
let statsPromise = null;
let cacheHasContent = false;
let resetting = false;
let shortcutSaving = false;
let cacheClearing = false;
function settingsBusy() {
  return resetting || keySaving || modelSaving || shortcutSaving || cacheClearing;
}

function connectionReady() {
  return configLoaded && config.key_configured && hasAccess;
}

function setupReady() {
  return connectionReady() && Boolean(config.model);
}

function showStep(next) {
  step = next;
  for (const name of ["welcome", "key", "model", "settings", "restart", "unavailable", "anki"])
    $(`${name}-step`).hidden = step !== name;
  $("restart-setup").hidden = step !== "settings";
  $("restart-confirm").hidden = step !== "restart";
  $("key-step-label").textContent = returningSettings ? "SETTINGS" : "STEP 1 OF 3";
  $("key-heading").textContent = returningSettings ? "OpenRouter key" : "Connect OpenRouter";
  $("model-step-label").textContent = returningSettings ? "SETTINGS" : "STEP 2 OF 3";
  $("key-back").textContent = returningSettings ? "Back to settings" : "Back";
  $("model-back").textContent = returningSettings ? "Back to settings" : "Back";
  $("finish-setup").hidden = returningSettings;
  window.scrollTo?.(0, 0);
  updateSetup();
}

async function enterModels() {
  if (!connectionReady()) return;
  showStep("model");
  await refreshModels(true);
}

async function enterSettings() {
  if (!configLoaded || (!returningSettings && !setupReady())) return;
  returningSettings = true;
  status("");
  showStep("settings");
  await loadStats();
}

function loadStats() {
  statsPromise ||= refreshStats();
  return statsPromise;
}

function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}

async function request(type, payload = {}) {
  let response;
  try {
    response = await extension.runtime.sendMessage({ ...payload, type: `manga:${type}` });
  } catch (error) {
    throw new Error("The extension connection was lost. Reopen this popup and try again.", {
      cause: error,
    });
  }
  if (!response?.ok)
    throw new Error(
      response?.error ||
        "The extension background did not respond. Reopen the extension and try again.",
    );
  return response;
}

function setupMessage() {
  if (!configLoaded) return "Settings could not be loaded. Reopen this popup to try again.";
  if (!config.key_configured) return "Save your OpenRouter API key to enable new translations.";
  if (!config.model) return "Choose a translation model to enable new translations.";
  if (!hasAccess) return "Allow OpenRouter access to enable new translations.";
  return "";
}

function updateSetup() {
  const missing = setupMessage();
  const busy = settingsBusy();
  $("clear-cache").disabled = !configLoaded || cacheAvailable !== true || !cacheHasContent || busy;
  $("clear-cache").hidden = !cacheHasContent || !$("clear-confirm").hidden;
  $("key-state").textContent = !configLoaded
    ? "Key status unavailable."
    : config.key_configured
      ? "Key saved on this device."
      : "No key saved yet.";
  $("remove-key").disabled = !configLoaded || !config.key_configured || keySaving;
  $("remove-key").hidden = !returningSettings || !config.key_configured;
  $("key-state").hidden = !config.key_configured;
  $("key-label").textContent = config.key_configured ? "Replacement API key" : "API key";
  const enteredKey = $("api-key").value.trim();
  $("save-key").textContent = returningSettings
    ? config.key_configured
      ? "Replace key"
      : "Save key"
    : config.key_configured && !enteredKey
      ? "Continue to models"
      : "Save and continue";
  $("save-key").classList.toggle("primary", !returningSettings);
  $("api-key").disabled = !configLoaded;
  $("save-key").disabled =
    !configLoaded || keySaving || (!enteredKey && (returningSettings || !config.key_configured));
  $("key-back").disabled = keySaving;
  $("allow-access").disabled = !configLoaded || keySaving;
  $("finish-setup").disabled = !setupReady() || modelSaving;
  $("current-model").textContent = format.modelName(config.model);
  $("current-key").textContent = config.key_configured ? "Saved on this device" : "Not connected";
  $("edit-connection").textContent = !config.key_configured
    ? "Add key"
    : !hasAccess
      ? "Allow access"
      : "Manage key";
  $("edit-model").disabled = !connectionReady() || busy;
  $("edit-connection").disabled = busy;
  $("model-back").disabled = modelSaving || catalogLoading;
  $("restart-setup").disabled = !configLoaded || busy;
  $("confirm-restart").disabled = !configLoaded || busy;
  $("cancel-restart").disabled = resetting;
  $("edit-model").title = connectionReady()
    ? "Change model"
    : "Connect OpenRouter before choosing another model.";
  $("access-state").hidden = hasAccess;
  $("access-state").textContent = config.key_configured
    ? "Allow OpenRouter access to continue."
    : "Firefox will ask for OpenRouter access when you save your key.";
  $("allow-access").hidden = !returningSettings || hasAccess || !config.key_configured;
  $("shortcut").textContent = configLoaded ? config.shortcut || "Disabled" : "Unavailable";
  $("setup-warning").textContent = step === "settings" ? missing : "";
  for (const id of ["save-shortcut", "reset-shortcut", "disable-shortcut"])
    $(id).disabled = !configLoaded || busy;
}

function modelButton(model, suggestion = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.value = model.id;
  button.className = "model-choice";
  button.disabled = !connectionReady() || modelSaving;
  const selected = model.id === config.model;
  button.setAttribute("aria-pressed", String(selected));
  button.setAttribute(
    "aria-label",
    [
      model.name,
      model.badge,
      model.preview ? "Preview" : "",
      suggestion ? model.description : model.id,
      format.rates(model),
      selected ? "Selected" : "",
    ]
      .filter(Boolean)
      .map((part) => part.replace(/\.$/, ""))
      .join(". "),
  );
  const name = document.createElement("span");
  name.className = "model-name";
  name.textContent = model.name;
  const tag = document.createElement("span");
  tag.className = "model-tag";
  tag.textContent = [selected ? "Selected" : model.badge, model.preview ? "Preview" : ""]
    .filter(Boolean)
    .join(" · ");
  const heading = document.createElement("span");
  heading.className = "model-choice-heading";
  heading.replaceChildren(name, tag);
  button.appendChild(heading);
  if (suggestion) {
    const description = document.createElement("span");
    description.className = "model-description";
    description.textContent = model.description;
    button.appendChild(description);
  } else {
    const id = document.createElement("span");
    id.className = "model-description";
    id.textContent = model.id;
    button.appendChild(id);
  }
  const prices = document.createElement("span");
  prices.className = "model-rates";
  prices.textContent = format.rates(model);
  button.appendChild(prices);
  button.addEventListener("click", () => selectModel(model.id));
  return button;
}

function renderModels(focusModel) {
  const suggested = format.recommended(catalog).map((model) => modelButton(model, true));
  const all = format
    .modelChoices(catalog, $("model-search").value)
    .map((model) => modelButton(model));
  $("recommended-models").replaceChildren(...suggested);
  $("recommendations-note").hidden = !suggested.length;
  $("recommended-empty").hidden = !!suggested.length || !catalog.models.length;
  $("model-list").replaceChildren(...all);
  $("model-list-empty").hidden = !!all.length || !catalog.models.length;
  $("all-models-label").textContent = catalog.models.length
    ? `All models (${catalog.models.length})`
    : "All models";
  $("all-models").hidden = !catalog.models.length;
  $("model-pricing-help").hidden = !catalog.models.length;
  $("selected-model").hidden =
    !config.model || suggested.some((button) => button.value === config.model);
  $("selected-model-name").textContent =
    catalog.models.find((model) => model.id === config.model)?.name ||
    format.modelName(config.model);
  $("model-price").textContent = format.price(catalog, config.model);
  if (focusModel && step === "model")
    [...suggested, ...all].find((button) => button.value === focusModel)?.focus();
}

async function refreshModels(force = false) {
  if (catalogLoading || step !== "model" || !connectionReady()) return;
  catalogLoading = true;
  updateSetup();
  $("refresh-models").hidden = true;
  $("refresh-models").disabled = true;
  $("catalog-status").textContent = "Loading models…";
  try {
    const result = await request("popup-models", { force });
    catalog = { ...result.catalog, models: format.models(result.catalog) };
    renderModels();
    $("catalog-status").textContent = format.catalogStatus(catalog);
    if (!format.recommended(catalog).length && catalog.models.length) $("all-models").open = true;
  } catch (error) {
    renderModels();
    $("catalog-status").textContent = `Model list unavailable. ${error.message}`;
    $("refresh-models").textContent = "Retry model list";
    $("refresh-models").hidden = false;
  } finally {
    catalogLoading = false;
    $("refresh-models").disabled = false;
    updateSetup();
  }
}
// Invoke before awaiting anything else in a click handler: Firefox requires a user gesture.
async function requestAccess() {
  try {
    hasAccess = await extension.permissions.request({ origins: OPENROUTER_ORIGINS });
  } catch (error) {
    throw new Error(
      "Firefox could not grant OpenRouter access. Reopen this popup and try connecting again.",
      { cause: error },
    );
  }
  updateSetup();
  if (!hasAccess) throw new Error("OpenRouter access was not granted. Allow access to continue.");
}

async function refreshStats() {
  try {
    const { stats } = await request("popup-cache-stats");
    $("cache-stats").textContent = format.stats(stats);
    cacheHasContent = stats.entries > 0;
    cacheAvailable = true;
    return true;
  } catch (error) {
    $("cache-stats").textContent = `Saved data unavailable. ${error.message}`;
    cacheAvailable = false;
    $("cache-settings").open = true;
    return false;
  } finally {
    updateSetup();
  }
}

$("refresh-models").addEventListener("click", async () => {
  if (step !== "model" || !connectionReady()) return;
  try {
    await requestAccess();
    await refreshModels(true);
  } catch (error) {
    status(error.message, true);
  }
});

$("allow-access").addEventListener("click", async () => {
  if (step !== "key" || !configLoaded || keySaving) return;
  keySaving = true;
  updateSetup();
  try {
    await requestAccess();
    status("OpenRouter access allowed.");
  } catch (error) {
    status(error.message, true);
  } finally {
    keySaving = false;
    updateSetup();
  }
});

$("save-key").addEventListener("click", async () => {
  if (step !== "key" || !configLoaded || keySaving) return;
  const apiKey = $("api-key").value.trim();
  if (!apiKey && (returningSettings || !config.key_configured))
    return status("Paste your OpenRouter API key first.", true);
  keySaving = true;
  updateSetup();
  try {
    await requestAccess();
    if (apiKey) {
      await request("popup-save-key", { apiKey });
      config.key_configured = true;
      $("api-key").value = "";
    }
    updateSetup();
    if (returningSettings) status("Key saved.");
    else {
      status("");
      await enterModels();
    }
  } catch (error) {
    status(error.message, true);
  } finally {
    keySaving = false;
    updateSetup();
  }
});
$("api-key").addEventListener("input", updateSetup);

$("remove-key").addEventListener("click", async () => {
  if (step !== "key" || !configLoaded || !config.key_configured || keySaving) return;
  keySaving = true;
  updateSetup();
  try {
    await request("popup-remove-key");
    config.key_configured = false;
    $("api-key").value = "";
    showStep("key");
    status("Key removed.");
  } catch (error) {
    status(error.message, true);
  } finally {
    keySaving = false;
    updateSetup();
  }
});

$("get-started").addEventListener("click", () => {
  if (!configLoaded || step !== "welcome") return;
  status("");
  showStep("key");
});
$("key-back").addEventListener("click", () => {
  if (step !== "key" || keySaving) return;
  if (returningSettings) return enterSettings();
  status("");
  showStep("welcome");
});
$("model-back").addEventListener("click", () => {
  if (step !== "model" || modelSaving || catalogLoading) return;
  if (returningSettings) return enterSettings();
  status("");
  showStep("key");
});
$("finish-setup").addEventListener("click", () => {
  if (step !== "model" || returningSettings || modelSaving || !setupReady()) return;
  return ankiSettings.open(true);
});
$("edit-connection").addEventListener("click", () => {
  if (!configLoaded || step !== "settings" || settingsBusy()) return;
  status("");
  showStep("key");
});
$("edit-model").addEventListener("click", () => {
  if (step !== "settings" || !connectionReady() || settingsBusy()) return;
  status("");
  return enterModels();
});
$("restart-setup").addEventListener("click", () => {
  if (step !== "settings" || !configLoaded || settingsBusy()) return;
  status("");
  showStep("restart");
  $("cancel-restart").focus();
});
$("cancel-restart").addEventListener("click", () => {
  if (step !== "restart" || resetting) return;
  enterSettings();
  $("restart-setup").focus();
});
$("confirm-restart").addEventListener("click", async () => {
  if (step !== "restart" || !configLoaded || settingsBusy() || $("restart-confirm").hidden) return;
  resetting = true;
  updateSetup();
  try {
    await request("popup-reset-setup");
    config = { ...config, key_configured: false, model: "" };
    returningSettings = false;
    catalog = { models: [] };
    $("api-key").value = "";
    $("model-search").value = "";
    renderModels();
    showStep("welcome");
    status("Connection reset. Your saved translations and reading preferences were kept.");
  } catch (error) {
    status(`Connection was not reset. ${error.message}`, true);
  } finally {
    resetting = false;
    updateSetup();
  }
});

$("model-search").addEventListener("input", () => renderModels());
async function selectModel(model) {
  if (
    step !== "model" ||
    !connectionReady() ||
    modelSaving ||
    model === config.model ||
    !catalog.models.some((item) => item.id === model)
  )
    return;
  modelSaving = true;
  renderModels();
  updateSetup();
  status("Saving model…");
  try {
    await request("popup-save-model", { model });
    config.model = model;
    status(returningSettings ? "Model saved for future requests." : "Model saved.");
  } catch (error) {
    status(error.message, true);
  } finally {
    modelSaving = false;
    renderModels(model);
    updateSetup();
  }
}

async function changeShortcut(action) {
  if (!configLoaded || step !== "settings" || settingsBusy()) return;
  const shortcut = $("shortcut-input").value.trim();
  if (action === "set" && !shortcut) return status("Enter a shortcut, or choose Disable.", true);
  shortcutSaving = true;
  updateSetup();
  try {
    const result = await request("popup-shortcut", {
      action,
      ...(action === "set" ? { shortcut } : {}),
    });
    config.shortcut = result.shortcut || "";
    $("shortcut-input").value = config.shortcut;
    updateSetup();
    status(config.shortcut ? `Shortcut set to ${config.shortcut}.` : "Shortcut disabled.");
  } catch (error) {
    $("shortcut-input").value = config.shortcut;
    updateSetup();
    status(`Shortcut unchanged. ${error.message}`, true);
  } finally {
    shortcutSaving = false;
    updateSetup();
  }
}
$("save-shortcut").addEventListener("click", () => changeShortcut("set"));
$("reset-shortcut").addEventListener("click", () => changeShortcut("reset"));
$("disable-shortcut").addEventListener("click", () => changeShortcut("disable"));
$("clear-cache").addEventListener("click", () => {
  if (
    step !== "settings" ||
    !configLoaded ||
    cacheAvailable !== true ||
    !cacheHasContent ||
    settingsBusy()
  )
    return;
  $("clear-confirm").hidden = false;
  $("clear-cache").hidden = true;
});

$("cancel-clear").addEventListener("click", () => {
  if (step !== "settings" || cacheClearing) return;
  $("clear-confirm").hidden = true;
  $("clear-cache").hidden = false;
});

$("confirm-clear").addEventListener("click", async () => {
  if (
    step !== "settings" ||
    !configLoaded ||
    cacheAvailable !== true ||
    settingsBusy() ||
    $("clear-confirm").hidden
  )
    return;
  cacheClearing = true;
  updateSetup();
  $("confirm-clear").disabled = true;
  $("cancel-clear").disabled = true;
  try {
    const { stats } = await request("popup-clear-cache");
    $("cache-stats").textContent = format.stats(stats);
    cacheHasContent = stats.entries > 0;
    $("clear-confirm").hidden = true;
    updateSetup();
    status("Saved data cleared. Unfinished requests, your key, and settings were kept.");
  } catch (error) {
    status(error.message, true);
  } finally {
    cacheClearing = false;
    $("confirm-clear").disabled = false;
    $("cancel-clear").disabled = false;
    updateSetup();
  }
});

async function init() {
  const results = await Promise.allSettled([
    request("popup-config"),
    extension.permissions.contains({ origins: OPENROUTER_ORIGINS }),
  ]);
  if (results[0].status === "fulfilled") {
    config = { ...config, ...results[0].value.config };
    configLoaded = true;
    returningSettings = Boolean(config.model) && !config.anki_setup_pending;
  } else status(results[0].reason.message, true);
  hasAccess = results[1].status === "fulfilled" && results[1].value;
  $("shortcut-input").value = config.shortcut;
  renderModels();
  if (!configLoaded) showStep("unavailable");
  else if (config.anki_setup_pending && setupReady()) await ankiSettings.open(true);
  else if (returningSettings) await enterSettings();
  else if (connectionReady()) await enterModels();
  else showStep(config.key_configured ? "key" : "welcome");
}
