/* AnkiConnect v6. Only the background can contact the fixed local endpoint. */
(() => {
  "use strict";
  const KEY = "ankiMining";
  const ORIGINS = ["http://127.0.0.1/*"];
  const VALUES = ["word", "reading", "meaning", "japanese", "translation"];
  const KAISHI = {
    word: "Word",
    reading: "Word Reading",
    meaning: "Word Meaning",
    japanese: "Sentence",
    translation: "Sentence Meaning",
  };
  function kaishiPreset(fields) {
    return [...Object.values(KAISHI), "Word Furigana", "Sentence Furigana"].every((field) =>
      fields.includes(field),
    )
      ? { ...KAISHI }
      : null;
  }
  const fail = (message, code = "anki") => Object.assign(new Error(message), { code });
  const escape = (text) =>
    String(text)
      .replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
      )
      .replace(/\r?\n/g, "<br>");
  const rubyLiteral = (text) => escape(text).replace(/\[/g, "&#91;").replace(/\]/g, "&#93;");

  // Anki's furigana filter expects surface[reading], not a standalone reading.
  function furigana(word, reading) {
    if (
      !/\p{Script=Han}/u.test(word) ||
      !/^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(reading)
    )
      return rubyLiteral(word);
    let stem = word,
      kana = reading,
      suffix = "";
    // Keep shared okurigana outside the annotation: 帰[かえ]らなきゃ.
    while (
      stem.length &&
      kana.length &&
      stem.at(-1) === kana.at(-1) &&
      !/\p{Script=Han}/u.test(stem.at(-1))
    ) {
      suffix = stem.at(-1) + suffix;
      stem = stem.slice(0, -1);
      kana = kana.slice(0, -1);
    }
    return kana
      ? `${rubyLiteral(stem)}[${rubyLiteral(kana)}]${rubyLiteral(suffix)}`
      : rubyLiteral(word);
  }

  function noteFields(fields, mapping, values) {
    const output = Object.fromEntries(
      fields.map((field) => [
        field,
        (mapping[field] || []).map((name) => escape(values[name])).join("<br><br>"),
      ]),
    );
    // Recognize the field schema, including cloned note types. Preserve custom mappings.
    const maps = (field, value) => mapping[field]?.length === 1 && mapping[field][0] === value;
    const standard =
      kaishiPreset(fields) &&
      Object.entries(KAISHI).every(([value, field]) => value === "reading" || maps(field, value)) &&
      ["Word Reading", "Word Furigana"].some((field) => maps(field, "reading")) &&
      ["Word Reading", "Word Furigana"].every(
        (field) => !mapping[field]?.length || maps(field, "reading"),
      ) &&
      !mapping["Sentence Furigana"]?.length;
    if (!standard) return output;
    const japanese = values.japanese
      .replace(/\r\n/g, "\n")
      .replace(/([^\n])\n(?=[^\n])/g, (match, before, offset, text) => {
        const japaneseCharacter =
          /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー、。！？「」]/u;
        return (
          before +
          (japaneseCharacter.test(before) && japaneseCharacter.test(text[offset + match.length])
            ? ""
            : " ")
        );
      });
    const parts = japanese.split(values.word);
    const sentence = parts.map(escape).join(`<b>${escape(values.word)}</b>`);
    const annotated = parts
      .map(rubyLiteral)
      .join(`<b> ${furigana(values.word, values.reading)}</b>`);
    output["Word Reading"] = escape(values.reading);
    output["Word Furigana"] = furigana(values.word, values.reading);
    output.Sentence = `<div style="margin-top:20px;line-height:1.6">${sentence}</div>`;
    output["Sentence Furigana"] = `<div style="line-height:1.8">${annotated}</div>`;
    return output;
  }

  function validateMapping(fields, mapping) {
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping))
      throw fail("Choose which values to put in your Anki fields.");
    for (const [field, values] of Object.entries(mapping)) {
      if (
        !fields.includes(field) ||
        !Array.isArray(values) ||
        values.some((value) => !VALUES.includes(value)) ||
        new Set(values).size !== values.length
      )
        throw fail("Your Anki fields have changed. Reconfigure Anki in extension settings.");
    }
    if (!mapping[fields[0]]?.includes("word"))
      throw fail("Include Word in the first field so Anki can check for duplicates.");
    for (const value of VALUES) {
      if (!Object.values(mapping).some((items) => items.includes(value)))
        throw fail(
          "Map Word, Reading, Meaning, Japanese context and Full translation to your fields. Several values can share one field.",
        );
    }
  }

  function miningValues(result, regionIndex, wordIndex, edits) {
    const regions = result?.analysis?.regions;
    const region = Number.isInteger(regionIndex) && regions?.[regionIndex];
    const word = Number.isInteger(wordIndex) && region?.words?.[wordIndex];
    if (!word || !word.surface || !region.japanese.includes(word.surface))
      throw fail("This word is no longer available. Reopen the translation.");
    const values = {
      word: word.surface,
      reading: word.reading || "",
      meaning: word.meaning || "",
      japanese: regions.map((item) => item.japanese).join("\n\n"),
      translation: regions.map((item) => item.translation).join("\n\n"),
    };
    if (edits !== undefined) {
      if (!edits || typeof edits !== "object" || Array.isArray(edits))
        throw fail("Invalid word edits.");
      for (const [name, value] of Object.entries(edits)) {
        if (!VALUES.includes(name) || typeof value !== "string" || value.length > 20000)
          throw fail("Each Anki value must be text under 20,000 characters.");
        values[name] = value.trim();
      }
    }
    if (!values.word || !values.japanese || !values.translation)
      throw fail("Keep a word, Japanese context and full translation before adding.");
    return values;
  }

  class AnkiService {
    constructor(extension, fetcher = globalThis.fetch.bind(globalThis), timeout = 15000) {
      this.extension = extension;
      this.fetcher = fetcher;
      this.timeout = timeout;
      this.pending = new Map();
      this.writes = Promise.resolve();
    }

    change(operation) {
      const write = this.writes.catch(() => {}).then(operation);
      this.writes = write;
      return write;
    }

    async local(operation, value) {
      try {
        return await this.extension.storage.local[operation](value);
      } catch {
        throw fail("Firefox could not access your Anki settings. Restart Firefox and try again.");
      }
    }

    async stored() {
      return (await this.local("get", KEY))[KEY] || {};
    }
    async config() {
      const value = await this.stored();
      return {
        enabled: !!value.enabled,
        deck: value.deck || "",
        model: value.model || "",
        mapping: value.mapping || {},
        keyConfigured: !!value.apiKey,
      };
    }
    async key(candidate) {
      if (candidate === undefined || candidate === "")
        return (await this.stored()).apiKey || undefined;
      if (typeof candidate !== "string" || candidate.length > 500)
        throw fail("Enter a valid AnkiConnect API key.");
      return candidate.trim() || undefined;
    }
    async call(action, params = {}, apiKey) {
      if (!(await this.extension.permissions.contains({ origins: ORIGINS })))
        throw fail("Connect Anki in extension settings to allow access to Anki Desktop.");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const response = await this.fetcher("http://127.0.0.1:8765", {
          method: "POST",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, version: 6, params, ...(apiKey ? { key: apiKey } : {}) }),
        });
        if (response.status === 403)
          throw fail(
            "AnkiConnect denied access. Connect again in extension settings and allow the extension in Anki.",
          );
        if (!response.ok) throw new Error("HTTP error");
        const data = await response.json();
        if (!data || !Object.hasOwn(data, "result") || !Object.hasOwn(data, "error"))
          throw new Error("Invalid AnkiConnect response");
        if (data.error) {
          const detail = String(data.error);
          if (/duplicate/i.test(detail))
            throw fail(
              "Already in Anki: a note with the same first field exists for this note type.",
              "anki-duplicate",
            );
          if (/api key/i.test(detail))
            throw fail("AnkiConnect requires a valid API key. Update it in Anki settings.");
          if (/collection/i.test(detail)) throw fail("Open your collection in Anki and try again.");
          throw fail(`Anki could not add or load this data: ${detail.slice(0, 240)}`);
        }
        return data.result;
      } catch (error) {
        if (error.code?.startsWith("anki")) throw error;
        if (action === "addNote")
          throw fail(
            "Anki did not confirm whether the note was added. Check Anki before trying again.",
            "anki-unknown",
          );
        throw fail(
          "Cannot reach Anki. Open Anki Desktop with AnkiConnect installed, then try again.",
          "anki-offline",
        );
      } finally {
        clearTimeout(timer);
      }
    }
    async catalog(candidate) {
      const apiKey = await this.key(candidate);
      const permission = await this.call("requestPermission", {}, apiKey);
      if (permission?.permission !== "granted")
        throw fail("Allow this extension in Anki’s connection prompt, then connect again.");
      const [decks, models] = await Promise.all([
        this.call("deckNames", {}, apiKey),
        this.call("modelNames", {}, apiKey),
      ]);
      if (
        ![decks, models].every(
          (items) => Array.isArray(items) && items.every((item) => typeof item === "string"),
        )
      )
        throw fail("Anki returned an invalid deck or note type list.");
      return { decks, models };
    }
    async fields(model, candidate) {
      if (typeof model !== "string" || !model) throw fail("Choose a note type.");
      const fields = await this.call(
        "modelFieldNames",
        { modelName: model },
        await this.key(candidate),
      );
      if (
        !Array.isArray(fields) ||
        !fields.length ||
        !fields.every((field) => typeof field === "string" && field)
      )
        throw fail("This note type has no usable fields.");
      return fields;
    }
    save(value) {
      return this.change(() => this.saveConfig(value));
    }
    async saveConfig(value) {
      if (!value || typeof value.deck !== "string" || typeof value.model !== "string")
        throw fail("Choose an Anki deck and note type.");
      const { decks, models } = await this.catalog(value.apiKey);
      if (!decks.includes(value.deck) || !models.includes(value.model))
        throw fail("Your deck or note type no longer exists. Connect again to refresh the list.");
      validateMapping(await this.fields(value.model, value.apiKey), value.mapping);
      const apiKey = await this.key(value.apiKey);
      await this.local("set", {
        [KEY]: {
          enabled: true,
          deck: value.deck,
          model: value.model,
          mapping: value.mapping,
          ...(apiKey ? { apiKey } : {}),
        },
      });
    }
    disconnect() {
      return this.change(() => this.local("remove", KEY));
    }
    async add(result, regionIndex, wordIndex, edits) {
      const config = await this.stored();
      if (!config.enabled) throw fail("Set up Anki in extension settings first.");
      const values = miningValues(result, regionIndex, wordIndex, edits);
      const identity = JSON.stringify([config.model, config.deck, config.mapping, values]);
      if (this.pending.has(identity)) return this.pending.get(identity);
      const operation = (async () => {
        const fields = await this.fields(config.model, config.apiKey);
        validateMapping(fields, config.mapping);
        const note = {
          deckName: config.deck,
          modelName: config.model,
          fields: noteFields(fields, config.mapping, values),
          options: { allowDuplicate: false },
          tags: ["manga-reading-assistant"],
        };
        const id = await this.call("addNote", { note }, config.apiKey);
        if (!Number.isSafeInteger(id) || id <= 0)
          throw fail(
            "Anki did not confirm whether the note was added. Check Anki before trying again.",
            "anki-unknown",
          );
        return { noteId: id, deck: config.deck };
      })();
      this.pending.set(identity, operation);
      try {
        return await operation;
      } finally {
        this.pending.delete(identity);
      }
    }
  }
  globalThis.MangaAnki = { AnkiService, miningValues, validateMapping, kaishiPreset, noteFields };
  if (typeof module !== "undefined" && module.exports) module.exports = globalThis.MangaAnki;
})();
