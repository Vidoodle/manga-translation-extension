const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { check, bump } = require("../scripts/release.cjs");

test("release metadata agrees with the Firefox manifest and changelog", () => {
  assert.equal(check(), require("../package.json").version);
});

test("a release bump updates both versions and promotes only the unreleased notes", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manga-release-"));
  t.after(() => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(dir).startsWith("manga-release-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(dir, "src"));
  for (const file of ["package.json", "src/manifest.json"])
    fs.writeFileSync(path.join(dir, file), '{"version":"0.5.5","name":"keep me"}\n');
  fs.writeFileSync(
    path.join(dir, "CHANGELOG.md"),
    "# Changelog\n\n## [Unreleased]\n\n- Fix an issue.\n\n## [0.5.5] - 2026-09-26\n\n- Earlier release.\n",
  );
  assert.throws(() => bump(dir, "0.5.4"), /increase/);
  assert.throws(() => bump(dir, "0.5.6-beta"), /stable version/);
  assert.equal(check(dir), "0.5.5");
  assert.equal(bump(dir, "0.5.6", "2026-09-26"), "0.5.6");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "src/manifest.json"))).name, "keep me");
  const log = fs.readFileSync(path.join(dir, "CHANGELOG.md"), "utf8");
  assert.match(log, /\[0.5.6\] - 2026-09-26\n\n- Fix an issue/);
  assert.match(log, /\[0.5.5\] - 2026-09-26\n\n- Earlier release/);
  assert.throws(() => bump(dir, "0.5.7"), /release notes/);
  assert.equal(check(dir), "0.5.6");
  fs.writeFileSync(path.join(dir, "src/manifest.json"), '{"version":"0.5.4"}');
  assert.throws(() => check(dir), /differ/);
});
