# Manga Reading Assistant

Read Japanese manga with translations and word help alongside the page. Select a speech bubble to get its Japanese text, an English translation, hoverable word readings and meanings, and grammar points. Save words to Anki with their sentence and translation.

Built for desktop Firefox and Japanese-to-English reading on BookWalker, including continuous scrolling. Other reading sites may work; compatibility depends on the site's reader. Chrome and mobile browsers are not currently supported.

## Get started

You need **Firefox 140 or newer** and your own **[OpenRouter account and API key](https://openrouter.ai/settings/keys)**. Translation usage is billed to that account. Anki is optional.

### Install

If you have a Mozilla-signed `.xpi`, open Firefox's **Add-ons → gear → Install Add-on From File** and select it. Signed installations remain after Firefox restarts.

The ZIP attached to [GitHub releases](https://github.com/Vidoodle/manga-translation-extension/releases) is an **unsigned upload package**, not a permanently installable Firefox add-on. There is no public Mozilla listing linked here yet. For signing and updates, see the [release guide](docs/releases.md).

To try the source locally:

1. Clone or download this repository.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Choose **Load Temporary Add-on** and select `src/manifest.json`.

Temporary installations disappear when Firefox restarts. No build step is needed to load the source.

### Set up

1. Open the extension from Firefox's toolbar and choose **Get started**.
2. Save your OpenRouter key and allow OpenRouter access if Firefox asks.
3. Choose a model. The suggested options offer a starting point; **All models** shows other compatible choices. Prices refresh when you enter model selection.
4. Connect Anki if you want to mine vocabulary, or choose **Skip for now**.

The toolbar popup holds setup and settings. Reading and saved translations live on the reading page.

## Read and save words

- **Alt+Q:** start selecting; drag around the Japanese text and release to translate. You can change the shortcut in settings.
- **Japanese words:** hover for a reading and meaning; click to pin word help so you can reach its controls.
- **Saved translations:** use the card's bookmark icon, or press Alt+Q again while the selection tool is open. Choose a saved answer to reopen its card at your current reading position.
- **Another selection:** with a translation card or saved-translations modal open, Alt+Q starts a new selection.
- **Move or dismiss:** drag the card's header to reposition it; that position is remembered. Esc dismisses the reader UI. Pending translations continue while you scroll or close the card.

Each translation includes Japanese, English, word help, and grammar in one request. Reopening saved answers and hovering words do not make new model requests. Saved answers are a local, size-limited history; selections are not marked on the manga page.

### Anki word mining

Install [AnkiConnect](https://ankiweb.net/shared/info/2055492159) in Anki Desktop and keep Anki running. In extension setup or **Settings → Anki → Configure**, connect and choose your deck, note type, and field mapping.

Click a Japanese word to pin its popup. Use **+** to add it directly or the **pencil** to edit before adding. The note includes the word, reading, meaning, Japanese context, and full translation. Kaishi mappings also populate furigana and sentence formatting. Mining does not make another model request.

See the [Anki guide](docs/anki-mining.md) for mappings, Kaishi support, and connection troubleshooting.

## Costs and model choice

The extension is free to use. **OpenRouter charges separately for model usage** through your own account. Cost depends on the model, crop size, and generated answer; input/output token prices in the model selector are not fixed prices per translation. The card shows reported cost when the provider supplies it.

The current suggestions are Gemini 3 Flash Preview for stronger learner explanations and Gemini 3.1 Flash-Lite for lower cost and shorter waits. These choices come from small tests on original Japanese samples, not a comprehensive translation benchmark. Models can misread text or give incorrect explanations, so word meanings and Anki notes remain editable. Read the [initial screening](docs/model-benchmark-2026-09-25.md) and [broader comparison](docs/model-benchmark-broader-2026-09-25.md) for results and limitations.

Failed or interrupted requests are not automatically retried. A deliberate retry may incur another charge even if the first answer never appeared. Use a dedicated OpenRouter key with a spending limit you are comfortable with.

## Privacy

The selected screenshot crop is sent directly to OpenRouter and a model provider. The full screenshot stays local. Your key, settings, and saved translations are stored in Firefox on your device; the extension does not sync them or send them to the maintainer. There is no analytics or developer-operated server.

Save a key only on a computer account you trust. The extension does not encrypt saved keys. See the **[privacy policy](PRIVACY.md)** for data flows, third-party processing, key protection, and exactly what the clear/reset controls remove.

## Development

Use Node 22 or newer and pnpm. The extension has no runtime package dependencies.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm package
```

`pnpm check` runs automated tests, formatting, version consistency, and Mozilla's extension linter. `pnpm package` produces an unsigned versioned ZIP and SHA-256 checksum in `dist/`.

For browser fixtures, run `pnpm test:browser` and open `http://127.0.0.1:17843/reader` or `/idb`. These use synthetic page content and simulated model responses with no external model calls. See the [testing guide](docs/validation.md) for coverage, recorded results and manual release checks.

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
docs/             Design, architecture and validation
```

Local model benchmarks are optional and billable; see the [benchmark guide](benchmarks/casual-japanese/README.md). Keep credentials in the ignored `.env` file, never in source or reports. Normal tests do not need a key.

- [Architecture](docs/architecture.md)
- [Release and signing guide](docs/releases.md)
- [Changelog](CHANGELOG.md)
- [Pre-publication audit](docs/publication-audit.md)

## Support and license

Report bugs or suggest improvements through [GitHub issues](https://github.com/Vidoodle/manga-translation-extension/issues). Include the extension and Firefox versions and steps to reproduce; never include your API key or private captures.

Code, documentation, and original assets are available under the [MIT license](LICENSE). Third-party dependencies retain their own licenses. Manga and other content you read are not licensed by this project. This is an independent project, unaffiliated with BookWalker, OpenRouter, Anki, or Mozilla.
