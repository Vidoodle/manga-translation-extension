const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AnkiService,
  miningValues,
  validateMapping,
  kaishiPreset,
  noteFields,
} = require("../src/background/anki.js");
const { analysis } = require("./core-helpers.cjs");
const mapping = { Front: ["word"], Back: ["reading", "meaning", "japanese", "translation"] };
const source = () => ({ run_id: "saved-run", analysis: analysis() });
const kaishiFields = [
  "Word",
  "Word Reading",
  "Word Meaning",
  "Word Furigana",
  "Word Audio",
  "Sentence",
  "Sentence Meaning",
  "Sentence Furigana",
  "Sentence Audio",
];
const kaishiMapping = {
  Word: ["word"],
  "Word Furigana": ["reading"],
  "Word Meaning": ["meaning"],
  Sentence: ["japanese"],
  "Sentence Meaning": ["translation"],
};

test("Kaishi Add uses existing mappings to populate both card sides, furigana and sentence spacing", async () => {
  const h = harness(
    (request) =>
      request.action === "modelFieldNames" && {
        ok: true,
        json: async () => ({ result: kaishiFields, error: null }),
      },
  );
  h.stored.ankiMining.model = "My cloned mining type";
  h.stored.ankiMining.mapping = kaishiMapping;
  const result = {
    analysis: {
      regions: [
        {
          japanese: "風邪\nひかないよーに",
          translation: "Don't catch a cold.",
          words: [{ surface: "風邪", reading: "かぜ", meaning: "a cold" }],
        },
      ],
    },
  };
  await h.service.add(result, 0, 0);
  const fields = h.calls.at(-1).params.note.fields;
  assert.equal(fields.Word, "風邪");
  assert.equal(fields["Word Reading"], "かぜ");
  assert.equal(fields["Word Furigana"], "風邪[かぜ]");
  assert.equal(
    fields.Sentence,
    '<div style="margin-top:20px;line-height:1.6"><b>風邪</b>ひかないよーに</div>',
  );
  assert.equal(
    fields["Sentence Furigana"],
    '<div style="line-height:1.8"><b> 風邪[かぜ]</b>ひかないよーに</div>',
  );
  assert.equal(fields["Sentence Meaning"], "Don&#39;t catch a cold.");
  assert.equal(fields["Word Audio"], "");
  assert.deepEqual(
    h.calls.map((call) => call.action),
    ["modelFieldNames", "addNote"],
  );
});

test("Kaishi preset detects fields, works with fresh mappings, and respects edited context and readings", () => {
  assert.equal(kaishiPreset(["Front", "Back"]), null);
  const preset = kaishiPreset(kaishiFields);
  assert.equal(preset.reading, "Word Reading");
  const mapping = Object.fromEntries(
    Object.entries(preset).map(([value, field]) => [field, [value]]),
  );
  const values = miningValues(source(), 0, 1, {
    japanese: "帰らなきゃ。\n\n明日は帰らなきゃ。",
    reading: "かえらなきゃ",
    meaning: "edited meaning",
  });
  const fields = noteFields(kaishiFields, mapping, values);
  assert.equal(fields["Word Furigana"], "帰[かえ]らなきゃ");
  assert.match(fields["Sentence Furigana"], /<br><br>明日は<b> 帰\[かえ\]らなきゃ<\/b>/);
  assert.equal(fields["Word Meaning"], "edited meaning");
  const removed = noteFields(kaishiFields, mapping, { ...values, japanese: "明日は休み。" });
  assert.equal(removed["Sentence Furigana"], '<div style="line-height:1.8">明日は休み。</div>');
});

test("Kaishi formatting escapes edits, tolerates missing readings and leaves custom mappings alone", () => {
  const values = {
    word: "風邪",
    reading: "<script>bad</script>",
    meaning: "<b>cold</b>",
    japanese: "<img src=x>風邪\n\nEnglish\ntext",
    translation: "<script>bad</script>",
  };
  const fields = noteFields(kaishiFields, kaishiMapping, values);
  assert.equal(fields["Word Furigana"], "風邪");
  assert.match(fields["Sentence Furigana"], /&lt;img src=x&gt;/);
  assert.match(fields.Sentence, /English text/);
  assert.equal(fields["Word Meaning"], "&lt;b&gt;cold&lt;/b&gt;");
  assert.equal(
    noteFields(kaishiFields, kaishiMapping, { ...values, reading: "" })["Word Furigana"],
    "風邪",
  );
  const custom = { ...kaishiMapping, "Sentence Furigana": ["translation"] };
  assert.equal(
    noteFields(kaishiFields, custom, values)["Sentence Furigana"],
    "&lt;script&gt;bad&lt;/script&gt;",
  );
  const kana = noteFields(kaishiFields, kaishiMapping, {
    ...values,
    word: "もう",
    reading: "もう",
    japanese: "もう帰る。",
  });
  assert.equal(kana["Word Furigana"], "もう");
});

function harness(handler, timeout = 1000) {
  const stored = {
    ankiMining: {
      enabled: true,
      deck: "Japanese",
      model: "Basic",
      mapping,
      apiKey: "anki-private-key",
    },
  };
  const calls = [];
  let allowed = true;
  const extension = {
    permissions: {
      contains: async ({ origins }) => {
        assert.deepEqual(origins, ["http://127.0.0.1/*"]);
        return allowed;
      },
    },
    storage: {
      local: {
        get: async (key) => ({ [key]: structuredClone(stored[key]) }),
        set: async (values) => Object.assign(stored, structuredClone(values)),
        remove: async (key) => {
          delete stored[key];
        },
      },
    },
  };
  const service = new AnkiService(
    extension,
    async (url, options) => {
      assert.equal(url, "http://127.0.0.1:8765");
      assert.equal(options.redirect, "error");
      assert.equal(options.credentials, "omit");
      const request = JSON.parse(options.body);
      assert.equal(request.version, 6);
      calls.push(request);
      const custom = await handler?.(request, options);
      if (custom) return custom;
      const result = {
        requestPermission: { permission: "granted", version: 6 },
        deckNames: ["Japanese"],
        modelNames: ["Basic"],
        modelFieldNames: ["Front", "Back"],
        addNote: 123456,
      }[request.action];
      return { ok: true, json: async () => ({ result, error: null }) };
    },
    timeout,
  );
  return {
    service,
    stored,
    calls,
    extension,
    deny: () => {
      allowed = false;
    },
  };
}

test("Anki connection saves existing deck and combined field mapping without returning the key", async () => {
  const h = harness();
  await h.service.save({ deck: "Japanese", model: "Basic", mapping });
  const config = await h.service.config();
  assert.equal(config.keyConfigured, true);
  assert.equal(config.apiKey, undefined);
  assert.equal(JSON.stringify(config).includes("anki-private-key"), false);
  assert.equal(
    h.calls.some((call) => call.action === "addNote"),
    false,
  );
  await h.service.disconnect();
  assert.equal((await h.service.config()).enabled, false);
  assert.equal(h.stored.ankiMining, undefined);
});

test("mining uses saved surface, reading, meaning and the full multi-region context with no model call", async () => {
  const h = harness();
  const result = source();
  result.analysis.regions.push({
    japanese: "また明日。",
    translation: "See you tomorrow.",
    words: [],
  });
  const response = await h.service.add(result, 0, 1);
  assert.equal(response.noteId, 123456);
  const note = h.calls.find((call) => call.action === "addNote").params.note;
  assert.equal(note.fields.Front, "帰らなきゃ");
  assert.equal(
    note.fields.Back,
    "かえらなきゃ<br><br>have to go home<br><br>もう帰らなきゃ。<br><br>また明日。<br><br>I&#39;d better head home.<br><br>See you tomorrow.",
  );
  assert.deepEqual(note.options, { allowDuplicate: false });
  assert.deepEqual(
    h.calls.map((call) => call.action),
    ["modelFieldNames", "addNote"],
  );
});

test("edits are bounded, validated and HTML escaped in Anki fields", async () => {
  const h = harness();
  await h.service.add(source(), 0, 0, {
    meaning: '<img src="https://bad.example/x"> & test\nnext',
  });
  const back = h.calls.at(-1).params.note.fields.Back;
  assert.match(back, /&lt;img src=&quot;https:\/\/bad.example\/x&quot;&gt; &amp; test<br>next/);
  for (const edits of [
    { word: "" },
    { meaning: "x".repeat(20001) },
    { endpoint: "https://evil" },
    [],
    { japanese: null },
  ]) {
    assert.throws(() => miningValues(source(), 0, 0, edits));
  }
  for (const [region, word] of [
    [-1, 0],
    [0, 20],
    ["0", 0],
    [0, 0.5],
  ])
    assert.throws(() => miningValues(source(), region, word));
});

test("mapping must preserve context and match actual fields; stale configuration never adds", async () => {
  assert.throws(
    () => validateMapping(["Front", "Back"], { Front: ["word"], Back: ["meaning"] }),
    /Map Word/,
  );
  assert.throws(
    () =>
      validateMapping(["Front", "Back"], {
        Front: ["meaning"],
        Back: ["word", "reading", "japanese", "translation"],
      }),
    /first field/,
  );
  const h = harness(
    (request) =>
      request.action === "modelFieldNames" && {
        ok: true,
        json: async () => ({ result: ["Renamed", "Back"], error: null }),
      },
  );
  await assert.rejects(h.service.add(source(), 0, 0), /fields have changed/);
  assert.equal(
    h.calls.some((call) => call.action === "addNote"),
    false,
  );
});

test("double clicks share a single pending note creation", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const h = harness(async (request) => {
    if (request.action === "addNote") await gate;
  });
  const first = h.service.add(source(), 0, 0);
  const second = h.service.add(source(), 0, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.filter((call) => call.action === "addNote").length, 1);
  release();
  assert.deepEqual(await first, await second);
});

test("duplicate, unavailable Anki and permission failures are distinct and never retried", async () => {
  const duplicate = harness(
    (request) =>
      request.action === "addNote" && {
        ok: true,
        json: async () => ({ result: null, error: "cannot create note because it is a duplicate" }),
      },
  );
  await assert.rejects(
    duplicate.service.add(source(), 0, 0),
    (error) => error.code === "anki-duplicate",
  );
  assert.equal(duplicate.calls.filter((call) => call.action === "addNote").length, 1);
  const offline = harness(() => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(offline.service.add(source(), 0, 0), /Open Anki Desktop/);
  assert.equal(offline.calls.length, 1);
  const denied = harness();
  denied.deny();
  await assert.rejects(denied.service.catalog(), /allow access/);
  assert.equal(denied.calls.length, 0);
});

test("an add timeout or malformed acknowledgement is an unknown outcome and is not retried", async () => {
  const h = harness(
    (request, options) =>
      request.action === "addNote" &&
      new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    10,
  );
  await assert.rejects(
    h.service.add(source(), 0, 0),
    (error) => error.code === "anki-unknown" && /Check Anki/.test(error.message),
  );
  assert.equal(h.calls.filter((call) => call.action === "addNote").length, 1);
  const invalid = harness(
    (request) =>
      request.action === "addNote" && {
        ok: true,
        json: async () => ({ result: null, error: null }),
      },
  );
  await assert.rejects(
    invalid.service.add(source(), 0, 0),
    (error) => error.code === "anki-unknown",
  );
});

test("disconnect waits for an earlier save instead of letting it re-enable mining", async () => {
  const h = harness();
  const save = h.service.save({ deck: "Japanese", model: "Basic", mapping });
  const disconnect = h.service.disconnect();
  await Promise.all([save, disconnect]);
  assert.equal((await h.service.config()).enabled, false);
});
