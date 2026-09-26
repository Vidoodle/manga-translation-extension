const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { IDBFactory } = require("fake-indexeddb");

const source = path.resolve(__dirname, "../src");
const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));

test("Firefox package resolves all its declared entry points", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, undefined);

  for (const file of [...manifest.background.scripts, manifest.action.default_popup]) {
    assert.ok(fs.existsSync(path.join(source, file)), `Missing packaged entry point: ${file}`);
  }

  for (const [name, icons] of [
    ["extension", manifest.icons],
    ["toolbar", manifest.action.default_icon],
    ...["light", "dark"].map((theme) => [
      `toolbar ${theme}`,
      Object.fromEntries(manifest.action.theme_icons.map((icon) => [icon.size, icon[theme]])),
    ]),
  ]) {
    assert.ok(
      icons && typeof icons === "object" && Object.keys(icons).length,
      `${name} icons are declared`,
    );
    for (const [size, file] of Object.entries(icons)) {
      const filename = path.join(source, file);
      assert.ok(fs.existsSync(filename), `Missing packaged ${name} icon: ${file}`);
      const png = fs.readFileSync(filename);
      assert.ok(png.length >= 33, `Truncated PNG header: ${file}`);
      assert.deepEqual(
        png.subarray(0, 8),
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        `${file} is a PNG`,
      );
      assert.equal(png.toString("ascii", 12, 16), "IHDR", `${file} has a PNG image header`);
      assert.equal(png.readUInt32BE(16), Number(size), `${file} width matches its declared size`);
      assert.equal(png.readUInt32BE(20), Number(size), `${file} height matches its declared size`);
    }
  }

  const popupFile = path.join(source, manifest.action.default_popup);
  const popup = fs.readFileSync(popupFile, "utf8");
  const header = popup.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i)?.[1] || "";
  const popupIcon = header.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i)?.[1];
  assert.ok(popupIcon, "The popup header declares an icon");
  assert.doesNotMatch(popupIcon, /^(?:[a-z][a-z\d+.-]*:|\/\/)/i, "The popup icon is local");
  const popupIconFile = path.resolve(path.dirname(popupFile), popupIcon);
  assert.ok(popupIconFile.startsWith(source + path.sep), "The popup icon stays inside the package");
  assert.ok(fs.existsSync(popupIconFile), `Missing packaged popup icon: ${popupIcon}`);
});

test("every packaged file is reachable from declared entry points or local resource references", () => {
  const all = fs
    .readdirSync(source, { recursive: true })
    .filter((file) => fs.statSync(path.join(source, file)).isFile());
  const visited = new Set(),
    queue = ["manifest.json"];
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!/\.(js|css|html|json)$/.test(file)) continue;
    const content = fs.readFileSync(path.join(source, file), "utf8");
    for (const [, reference] of content.matchAll(
      /["']([^"'\r\n]+\.(?:js|css|html|png|json))["']/g,
    )) {
      for (const candidate of [
        path.resolve(source, path.dirname(file), reference),
        path.resolve(source, reference),
      ]) {
        if (
          candidate.startsWith(source + path.sep) &&
          fs.existsSync(candidate) &&
          fs.statSync(candidate).isFile()
        ) {
          queue.push(path.relative(source, candidate));
          break;
        }
      }
    }
  }
  assert.deepEqual(
    all.filter((file) => !visited.has(file)),
    [],
    "Remove unused packaged files or reference them explicitly",
  );
});

test("installed extension has explicit page access, OpenRouter and optional local Anki access", () => {
  assert.deepEqual(manifest.permissions, ["activeTab", "storage", "scripting"]);
  assert.deepEqual(manifest.host_permissions, ["https://openrouter.ai/*"]);
  assert.deepEqual(manifest.optional_host_permissions, ["http://127.0.0.1/*"]);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  assert.match(
    manifest.content_security_policy.extension_pages,
    /connect-src 'self' https:\/\/openrouter\.ai http:\/\/127\.0\.0\.1:8765$/,
  );
  assert.equal(manifest.commands["select-manga"].suggested_key.default, "Alt+Q");
});

test("declared background scripts bootstrap and activate the reader with packaged styles", async (t) => {
  const listeners = new Map();
  const connections = [];
  const requests = [];
  const injections = [];
  const messages = [];
  const errors = [];
  const factory = new IDBFactory();
  const tab = { id: 7, windowId: 3, url: "https://reader.example/book" };
  const event = (name) => ({
    addListener(listener) {
      listeners.set(name, listener);
    },
  });

  const storageArea = () => {
    const values = {};
    return {
      async get(keys) {
        const names = typeof keys === "string" ? [keys] : keys;
        return Object.fromEntries(names.map((key) => [key, structuredClone(values[key])]));
      },
      async set(value) {
        Object.assign(values, structuredClone(value));
      },
    };
  };

  const browser = {
    runtime: {
      id: "bootstrap-test",
      getURL: (file) => `moz-extension://bootstrap-test/${file}`,
      onMessage: event("message"),
      onConnect: event("connect"),
    },
    storage: { local: storageArea(), session: storageArea() },
    action: {
      async setTitle({ title }) {
        errors.push(title);
      },
      async setBadgeText() {},
      async openPopup() {},
    },
    permissions: {
      async contains() {
        return true;
      },
    },
    commands: {
      onCommand: event("command"),
      async getAll() {
        return [{ name: "select-manga", shortcut: "Alt+Q" }];
      },
    },
    tabs: {
      onRemoved: event("removed"),
      onUpdated: event("updated"),
      async query() {
        return [tab];
      },
      async sendMessage(tabId, message) {
        messages.push({ tabId, message });
        return { ok: true, sessionId: message.sessionId, mounted: true };
      },
    },
    scripting: {
      async executeScript(injection) {
        injections.push(injection);
      },
    },
  };

  const context = vm.createContext({
    browser,
    URL,
    crypto,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    indexedDB: {
      open(...args) {
        const request = factory.open(...args);
        request.addEventListener("success", () => connections.push(request.result));
        return request;
      },
    },
    async fetch(url) {
      requests.push(url);
      const file = ["shared/theme.css", "reader/reader.css", "shared/japanese.css"].find(
        (file) => browser.runtime.getURL(file) === url,
      );
      assert.ok(file, `Unexpected style resource: ${url}`);
      return {
        ok: true,
        async text() {
          return fs.readFileSync(path.join(source, file), "utf8");
        },
      };
    },
  });

  t.after(() => connections.forEach((connection) => connection.close()));

  for (const file of manifest.background.scripts) {
    const filename = path.join(source, file);
    vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  }

  assert.deepEqual([...listeners.keys()].sort(), [
    "command",
    "connect",
    "message",
    "removed",
    "updated",
  ]);

  const sender = {
    id: browser.runtime.id,
    url: browser.runtime.getURL(manifest.action.default_popup),
  };
  const config = await listeners.get("message")({ type: "manga:popup-config" }, sender);
  assert.equal(config.ok, true);
  assert.equal(config.config.model, "");
  assert.equal(config.config.key_configured, false);

  await listeners.get("command")("select-manga", tab);
  assert.match(errors.at(-1), /Save your OpenRouter key/);
  assert.equal(injections.length, 0);
  await browser.storage.local.set({
    openRouterApiKey: "synthetic-bootstrap-key",
    selectedModel: "fixture/vision",
  });

  await listeners.get("command")("select-manga", tab);
  assert.equal(errors.length, 1);
  assert.equal(requests.length, 3);
  assert.equal(injections.length, 1);
  for (const file of injections[0].files) assert.ok(fs.existsSync(path.join(source, file)));
  assert.equal(messages[0].message.type, "manga:start");
  assert.match(messages[0].message.readerCss, /\.card/);
  assert.match(messages[0].message.readerCss, /--manga-font/);
  assert.match(messages[0].message.readerCss, /\.jp-gloss/);
  assert.ok(
    injections[0].files.indexOf("shared/models.js") >= 0 &&
      injections[0].files.indexOf("shared/models.js") <
        injections[0].files.indexOf("reader/reader-view.js"),
    "Friendly model names are available before the card renders",
  );
  assert.ok(
    injections[0].files.indexOf("shared/japanese.js") <
      injections[0].files.indexOf("reader/reader-view.js"),
  );
  assert.equal(messages[0].message.model, "fixture/vision");
});
