/* The optional last setup step and Settings share the same Anki form. */
const ankiSettings = (() => {
  "use strict";
  const labels = {
    word: "Word",
    reading: "Reading",
    meaning: "Meaning",
    japanese: "Japanese context",
    translation: "Full translation",
  };
  let saved = {},
    onboarding = false,
    busy = false,
    fields = [],
    mappingInputs = [];
  const message = (text, error = false) => {
    $("anki-status").textContent = text;
    $("anki-status").classList.toggle("error", error);
  };
  function lock(value) {
    busy = value;
    for (const id of [
      "anki-connect",
      "anki-save",
      "anki-model",
      "anki-deck",
      "anki-key",
      "anki-back",
      "anki-disconnect",
      "anki-skip",
    ])
      $(id).disabled = value;
    for (const [, input] of mappingInputs) input.disabled = value;
    $("anki-save").disabled = value || !fields.length;
  }
  function options(select, values, selected) {
    select.replaceChildren(
      ...values.map((value) => {
        const option = document.createElement("option");
        option.value = option.textContent = value;
        return option;
      }),
    );
    select.value = values.includes(selected) ? selected : values[0] || "";
  }
  async function loadFields() {
    fields = [];
    mappingInputs = [];
    $("anki-mapping").replaceChildren();
    const model = $("anki-model").value;
    if (!model) throw new Error("Create a regular note type in Anki, then connect again.");
    const response = await request("popup-anki-fields", { model, apiKey: $("anki-key").value });
    fields = response.fields;
    $("anki-mapping-hint").textContent = response.preset
      ? "Kaishi: with these mappings, word and sentence furigana are filled automatically, with the selected word highlighted."
      : "Choose what each field contains. Values are combined in the order shown.";
    for (const [value, label] of Object.entries(labels)) {
      const row = document.createElement("div");
      row.className = "anki-map-row";
      const caption = document.createElement("label");
      caption.textContent = label;
      const select = document.createElement("select");
      select.id = `anki-map-${value}`;
      caption.htmlFor = select.id;
      const configured =
        model === saved.model && fields.find((field) => saved.mapping?.[field]?.includes(value));
      const match = fields.find(
        (field) => field.toLowerCase() === value || field.toLowerCase() === label.toLowerCase(),
      );
      options(
        select,
        fields,
        configured ||
          response.preset?.[value] ||
          match ||
          (value === "word" ? fields[0] : fields[1] || fields[0]),
      );
      mappingInputs.push([value, select]);
      row.append(caption, select);
      $("anki-mapping").append(row);
    }
  }
  async function open(fromSetup = false) {
    if (settingsBusy() || busy) return;
    onboarding = fromSetup;
    $("anki-step-label").textContent = onboarding ? "STEP 3 OF 3 · OPTIONAL" : "SETTINGS";
    $("anki-optional").hidden = !onboarding;
    $("anki-skip").hidden = !onboarding;
    $("anki-back").textContent = onboarding ? "Back" : "Back to settings";
    $("anki-save").textContent = onboarding ? "Save and finish" : "Save Anki settings";
    $("anki-skip").textContent = "Skip for now";
    showStep("anki");
    status("");
    message("Loading Anki settings…");
    lock(true);
    try {
      saved = (await request("popup-anki-config")).config;
      $("anki-disconnect").hidden = onboarding || !saved.enabled;
      if (onboarding && saved.enabled) $("anki-skip").textContent = "Keep current setup";
      $("anki-key-hint").textContent = saved.keyConfigured
        ? "Key saved. Leave blank to keep it; disconnect to remove it."
        : "Only needed if you set a key in AnkiConnect.";
      message(
        saved.enabled ? `Words go to ${saved.deck}. Connect to change your deck or fields.` : "",
      );
    } catch (error) {
      message(error.message, true);
    } finally {
      lock(false);
    }
  }
  $("edit-anki").addEventListener("click", () => open());
  async function finish() {
    if (onboarding) {
      await request("popup-finish-setup");
      config.anki_setup_pending = false;
    }
    await enterSettings();
  }
  $("anki-connect").addEventListener("click", async () => {
    if (busy) return;
    // Firefox requires the permission request to start directly from the click.
    const permission = extension.permissions.request({ origins: ["http://127.0.0.1/*"] });
    lock(true);
    fields = [];
    $("anki-fields").hidden = true;
    message("Connecting… If Anki asks, allow this extension.");
    try {
      if (!(await permission)) throw new Error("Allow local Anki access to connect.");
      const result = await request("popup-anki-connect", { apiKey: $("anki-key").value });
      if (!result.decks.length || !result.models.length)
        throw new Error("Create a deck and regular note type in Anki, then connect again.");
      options($("anki-deck"), result.decks, saved.deck);
      options($("anki-model"), result.models, saved.model);
      await loadFields();
      $("anki-fields").hidden = false;
      message("Connected. Choose your deck and field mapping.");
    } catch (error) {
      message(error.message, true);
    } finally {
      lock(false);
    }
  });
  $("anki-model").addEventListener("change", async () => {
    if (busy) return;
    lock(true);
    try {
      await loadFields();
      message("");
    } catch (error) {
      message(error.message, true);
    } finally {
      lock(false);
    }
  });
  $("anki-save").addEventListener("click", async () => {
    if (busy || !fields.length) return;
    lock(true);
    message("Saving…");
    try {
      const mapping = Object.fromEntries(fields.map((field) => [field, []]));
      for (const [value, select] of mappingInputs) mapping[select.value].push(value);
      await request("popup-anki-save", {
        config: {
          deck: $("anki-deck").value,
          model: $("anki-model").value,
          apiKey: $("anki-key").value,
          mapping,
        },
      });
      $("anki-key").value = "";
      $("anki-fields").hidden = true;
      fields = [];
      await finish();
      status("Anki is ready. Open a word’s reading popup to add it.");
    } catch (error) {
      message(error.message, true);
    } finally {
      lock(false);
    }
  });
  $("anki-disconnect").addEventListener("click", async () => {
    if (busy) return;
    lock(true);
    try {
      await request("popup-anki-disconnect");
      await extension.permissions.remove({ origins: ["http://127.0.0.1/*"] });
      saved = {};
      fields = [];
      mappingInputs = [];
      $("anki-fields").hidden = true;
      $("anki-key").value = "";
      await enterSettings();
      status("Anki disconnected. Notes already added to Anki are kept.");
    } catch (error) {
      message(error.message, true);
    } finally {
      lock(false);
    }
  });
  $("anki-back").addEventListener("click", () => {
    if (!busy) {
      $("anki-key").value = "";
      $("anki-fields").hidden = true;
      fields = [];
      return onboarding ? enterModels() : enterSettings();
    }
  });
  $("anki-skip").addEventListener("click", async () => {
    if (!onboarding || busy) return;
    lock(true);
    try {
      await finish();
      $("anki-key").value = "";
      $("anki-fields").hidden = true;
      fields = [];
      status("You’re ready to read. Anki is available in settings whenever you want it.");
    } catch (error) {
      message(error.message, true);
    } finally {
      lock(false);
    }
  });
  return { open };
})();
// Start after both popup modules have registered their setup screens.
init().catch((error) => status(error.message, true));
