# Development

The extension runs directly from JavaScript, HTML, and CSS in `src/`. It has no runtime package dependencies and needs no build step for temporary loading.

## Load the extension in Firefox

1. Clone this repository or [download the source ZIP](https://github.com/Vidoodle/manga-translation-extension/archive/refs/heads/main.zip) and extract it.
2. Open `about:debugging#/runtime/this-firefox` in Firefox 140 or newer.
3. Choose **Load Temporary Add-on** and select `src/manifest.json` from the extracted project.
4. Open the toolbar popup and follow the [setup instructions](../README.md#first-time-setup).

Temporary installations disappear when Firefox restarts. After source changes, click **Reload** for the add-on in `about:debugging` and refresh the reading tab. Normal installation will use the public Mozilla Add-ons listing once published.

## Install development tools

Use Node 22 or newer and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm package
```

`pnpm check` runs automated tests, formatting, version consistency, and Mozilla's extension linter. `pnpm package` produces an unsigned versioned ZIP and SHA-256 checksum in `dist/` for Mozilla submission. Release ZIPs are unsigned; signing and publication are described in the [release guide](releases.md).

## Test locally

Run `pnpm test:browser` and open `http://127.0.0.1:17843/reader`, `/popup`, or `/idb`. These fixtures use production modules with synthetic page content and simulated model responses. No external model calls are made. See the [testing guide](validation.md) for coverage, results, and manual checks.

Paid model benchmarks are separate from normal tests. Follow the [benchmark instructions](../benchmarks/casual-japanese/README.md) to run them deliberately with a budget. Keep credentials in the ignored `.env` file, never in source or reports. Normal tests do not need a key.

## Repository layout

```text
src/background/   Requests, storage, settings, OpenRouter and Anki
src/reader/       Selection, screenshot cropping and translation cards
src/popup/        Setup and preferences
src/shared/       Theme and Japanese word help
src/icons/        Packaged icons
assets/           Original icon sources
benchmarks/       Original Japanese test samples
scripts/          Local fixtures, benchmarks and release tools
tests/            Automated tests
docs/             Guides, architecture and validation
```

- [Architecture](architecture.md)
- [Product design](design.md)
- [Release and signing guide](releases.md)
- [Pre-publication audit](publication-audit.md)

Code, documentation, and original assets use the [MIT license](../LICENSE). Third-party dependencies retain their own licenses; manga and other reading content are not licensed by this project.
