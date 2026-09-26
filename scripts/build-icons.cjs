// Render the original vector mark at its final sizes; no scaled-down illustration.
// Run with `node scripts/build-icons.cjs`. Requires sharp on NODE_PATH or installed locally.
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

async function main() {
  const root = path.resolve(__dirname, "..");
  const mark = await fs.readFile(path.join(root, "assets/extension-mark.svg"), "utf8");
  const paths = mark.replace(/<svg[^>]*>|<\/svg>/g, "").trim();
  const svg = (fill, background = "") =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${background}<g fill="${fill}">${paths}</g></svg>`;
  const brand = svg("#fbfcf8", '<rect width="32" height="32" rx="7" fill="#234d3c"/>');
  const directory = path.join(root, "src/icons");
  const write = async (source, size, file) =>
    sharp(Buffer.from(source)).resize(size, size).png().toFile(path.join(directory, file));
  for (const size of [48, 64, 96, 128]) {
    await write(brand, size, `icon-${size}.png`);
  }
  for (const size of [16, 32, 64]) {
    await write(svg("#242b27"), size, `toolbar-dark-${size}.png`);
    await write(svg("#f1f3eb"), size, `toolbar-light-${size}.png`);
  }
  await fs.writeFile(path.join(root, "assets/extension-icon.svg"), brand);
  await sharp(Buffer.from(brand))
    .resize(512, 512)
    .png()
    .toFile(path.join(root, "assets/extension-icon.png"));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
