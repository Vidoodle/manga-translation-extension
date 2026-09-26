// One version for Firefox, GitHub, and the changelog. No credentials or signing here.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const read = (directory, file) => fs.readFileSync(path.join(directory, file), "utf8");
const json = (directory, file) => JSON.parse(read(directory, file));
function versionParts(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    throw new Error("Use a stable version such as 0.5.6 (major.minor.patch).");
  const parts = value.split(".").map(Number);
  if (parts.some((part) => part > 65535))
    throw new Error("Version components must be at most 65535.");
  return parts;
}
function check(directory = root) {
  const pkg = json(directory, "package.json");
  const manifest = json(directory, "src/manifest.json");
  versionParts(pkg.version);
  if (pkg.version !== manifest.version) throw new Error("Package and Firefox versions differ.");
  if (!read(directory, "CHANGELOG.md").includes(`## [${pkg.version}] - `))
    throw new Error(`Add a dated CHANGELOG.md entry for ${pkg.version}.`);
  return pkg.version;
}
function bump(directory, version, date = new Date().toISOString().slice(0, 10)) {
  const current = check(directory);
  const next = versionParts(version),
    previous = versionParts(current);
  const difference = next.map((part, index) => part - previous[index]).find((part) => part !== 0);
  if (!difference || difference < 0) throw new Error("The release version must increase.");
  const changelog = read(directory, "CHANGELOG.md");
  const pending = /^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## \[|$(?![\s\S]))/m.exec(changelog);
  if (!pending || !/^\s*-\s+\S/m.test(pending[1]))
    throw new Error("Write release notes under [Unreleased] before increasing the version.");
  if (changelog.includes(`## [${version}]`))
    throw new Error("That changelog version already exists.");
  const updated = changelog.replace(
    pending[0],
    `## [Unreleased]\n\n## [${version}] - ${date}\n\n${pending[1].trim()}\n\n`,
  );
  // Validate all inputs before writing either version file.
  const files = ["package.json", "src/manifest.json"].map((file) => [
    file,
    { ...json(directory, file), version },
  ]);
  for (const [file, value] of files)
    fs.writeFileSync(path.join(directory, file), JSON.stringify(value, null, 2) + "\n");
  fs.writeFileSync(path.join(directory, "CHANGELOG.md"), updated);
  return check(directory);
}
function webExt(args) {
  const entry = path.join(path.dirname(require.resolve("web-ext")), "bin/web-ext.js");
  execFileSync(process.execPath, [entry, ...args], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NO_UPDATE_NOTIFIER: "1" },
  });
}
function build() {
  const version = check();
  const filename = `manga-reading-assistant-${version}.zip`;
  webExt([
    "build",
    "--source-dir",
    "src",
    "--artifacts-dir",
    "dist",
    "--filename",
    filename,
    "--overwrite-dest",
  ]);
  const hash = createHash("sha256")
    .update(fs.readFileSync(path.join(root, "dist", filename)))
    .digest("hex");
  fs.writeFileSync(path.join(root, "dist", filename + ".sha256"), `${hash}  ${filename}\n`);
  console.log(`Unsigned Mozilla upload package: dist/${filename}`);
}
if (require.main === module) {
  try {
    const [command, value] = process.argv.slice(2).filter((arg) => arg !== "--");
    if (command === "check") console.log(`Release version ${check()} is consistent.`);
    else if (command === "version") console.log(`Prepared ${bump(root, value)}.`);
    else if (command === "lint") webExt(["lint", "--source-dir", "src"]);
    else if (command === "build") build();
    else throw new Error("Usage: node scripts/release.cjs check | version X.Y.Z | lint | build");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { check, bump };
