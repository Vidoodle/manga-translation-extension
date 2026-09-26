# Manga Reading Assistant

A Firefox extension for reading Japanese manga inside BookWalker. Select a bubble to see its Japanese, an English translation, word readings and meanings, and major grammar points.

The extension talks directly to OpenRouter. It does not need a local server.

## Install and read

1. Open `about:debugging#/runtime/this-firefox` in Firefox 140 or newer.
2. Click **Load Temporary Add-on**, then select `src/manifest.json` inside your local copy of this repository.

3. Open the extension popup and choose **Get started**. Enter your OpenRouter key, choose **Save and continue**, and allow OpenRouter access when Firefox asks. Choose a recommended starting model, or open **All models** to search the full compatible list. Prices come from OpenRouter; no model is preselected. The extension popup is only for setup, model choice and settings.
4. Open your book. Press **Alt+Q**, drag around Japanese text, and release. The card shows the captured text and one English translation, and stays open while you keep reading. It opens in the bottom-right corner by default; drag its header to move it. Your chosen position is remembered for future cards. Press **Alt+Q** again while the selection layer is open to show **Saved translations** in a separate in-page modal; pending translations keep running. With a translation or saved-list modal open, **Alt+Q** starts a new selection. **Esc** dismisses the reader UI. Change, reset, or disable the shortcut in the extension settings.

Activation and dragging take no screenshots and make no model request. Releasing a valid selection captures the visible page once, crops exactly the selected rectangle, and requests its Japanese, natural English translation, vocabulary and grammar together. Hover, focus or tap an underlined Japanese word to see its reading and meaning. The result card focuses on Japanese, Translation and Grammar; it stays readable while you scroll. Opening word help or a saved translation makes no model call.

New selection requires the key, model, OpenRouter access, and local cache to be ready. Before setup, the shortcut opens configuration if there are no saved translations; otherwise it opens the in-page library so existing answers remain readable. First-time setup includes connection, model choice and an optional Anki step. Reading a saved translation makes no provider request. A cache failure has its own error and does not prevent saving a key or changing settings. Opening the welcome screen loads neither the model catalog nor saved reading data.

The reader does not scan pages, recognize previous selections, restore outlines, or snap a new rectangle to an old one. Each drag uses your exact selection. Clicking a **Saved translations** entry reopens the same in-page card with its original captured crop and answer over your current viewport. It does not navigate or scroll the book, take a new screenshot, or submit another translation. Exact request deduplication still prevents concurrent identical submissions and can return an already saved result for identical input and settings.

Use the bookmark icon in the translation card, or press the reading shortcut again while selecting, to open **Saved translations**. Its list lives on the reading page and each entry shows its Japanese text, status, date, model and reported cost. Choosing an entry opens the translation card within the same reader session. Opening a pending entry checks its existing request; failed or interrupted work offers an explicit retry in the card. These reading actions never open or close Firefox's extension popup.

The popup, reader card and word help share a paper, ink and green theme that follows the browser/system light or dark preference. The card puts Japanese, translation and grammar first, with a small crop preview and secondary model information. The selection hint sits at the bottom-right edge with a translucent background.

Open the extension popup to change the model, connection, shortcut or saved-data settings. It contains no Select area button or saved-translation list. **Reset connection** opens a separate confirmation screen before removing the saved key and model choice and returning to Welcome. Saved translations, running requests, your shortcut and the card position are kept.

Temporary installations disappear when Firefox restarts. Persistent installation in standard Firefox requires a Mozilla-signed package; locally built packages still need signing. An unlisted submission supports personal use without a public store listing. Chrome support is not included in this build.

## Keep it installed across restarts

Use Mozilla's **unlisted / self-distributed** signing option. The extension does not need a public store listing.

1. Run `pnpm check` and `pnpm package`. This creates a versioned ZIP under `dist/`, with `manifest.json` at the ZIP root. It contains only extension source, not your saved key or reading cache.
2. Sign in at the [Mozilla submission page](https://addons.mozilla.org/developers/addon/submit/), choose **On your own**, and upload the ZIP. Follow the validation/signing steps, then download the signed `.xpi` from your submission's version page.
3. In Firefox, open `about:addons`, use the gear menu's **Install Add-on From File**, and select that signed `.xpi`. This installation remains after Firefox restarts.

For future updates, use the [release workflow](docs/releases.md) to update both versions and the changelog, keep the same extension ID, and sign/install the updated package. Editing this project's files does not update an installed signed copy. See Mozilla's [signing instructions](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/#self-distribution) and [file-install instructions](https://extensionworkshop.com/documentation/publish/install-self-distributed/).

## Model and data choices

- Model selection is persistent. Gemini 3 Flash Preview appears first as **Recommended** for translations, word meanings and grammar. Gemini 3.1 Flash-Lite appears second as **Faster & cheaper**, with shorter waits and lower cost but less reliable word explanations. These suggestions follow the small live screening below. Claude Sonnet 5 and other compatible alternatives remain available through **All models**. Luna and Qwen are no longer recommended: Luna made meaning-changing transcription errors, and Qwen's follow-up exposed repeated malformed responses and shared-provider rate limits. Existing selections are preserved, and models never switch automatically. Entering the model screen refreshes the list and prices automatically; **Retry model list** appears only if loading fails. Cached fallback prices are labelled.
- Requests explicitly use minimal reasoning for Flash-Lite, low reasoning for Luna, and a 1,024-token reasoning budget for Qwen3.8 Flash. Gemini 3 Flash Preview, 3.1 Pro Preview, 3.8 Flash, DeepSeek V4.1 Flash, Claude Sonnet 5 and GLM-5.3 Flash use low reasoning. These controls reduce the requested reasoning work; they do not guarantee cost or latency. Models without a verified configuration keep their provider settings. The 8,192-token translation output allowance remains available for Japanese, English, vocabulary, grammar and reasoning.
- Save a key only on a computer you trust, under your own password-protected computer account. Avoid public computers and logins shared with people you don’t trust. Create a separate key for this extension with a low spending limit in [OpenRouter’s key settings](https://openrouter.ai/settings/keys). If it may have been copied, delete it there and create a replacement; removing it from the extension does not disable a copied key. The key stays in local extension storage without encryption; it is not synced or exposed to BookWalker.
- Full screenshots stay local and are used only to produce the selected crop. The crop goes to OpenRouter and the chosen provider; the reader no longer creates page references.
- Version 0.5.6 removes obsolete page-placement storage while retaining current saved translations, credentials, settings and unresolved request records. Very old version-1 databases also receive the historical answer-format migration.
- Unknown request outcomes require a deliberate retry because the earlier request may already have been charged. Cache eviction bounds ordinary saved data; **Clear saved data** preserves active/unresolved request records and their required sources.

The [live model screening](docs/model-benchmark-2026-09-25.md) compares 33 OpenRouter attempts on eight original Japanese crop fixtures using the production provider module. It favors Flash-Lite for speed/value and Gemini 3 Flash Preview for cleaner learner help in this small sample. The separate [Qwen follow-up](docs/qwen-diagnostics-2026-09-25.md) found both Alibaba shared-pool rate limits and invalid array-shaped answers despite a correctly forwarded object schema. No tested configuration established reliable Qwen behavior. Version 0.4.4 updates the shortlist and identifies a confirmed shared-provider rate limit in the error message; it does not claim to repair Qwen's upstream behavior.

The [broader family screening](docs/model-benchmark-broader-2026-09-25.md) adds 41 attempts across DeepSeek, Claude Haiku/Sonnet, GLM, MiniMax and Mistral. Sonnet produced exact transcripts but cost more and still made a word-help error; DeepSeek was slow and hit a response limit; the cheaper alternatives made material learning errors or were rate-limited. The two current suggestions remain. Version 0.4.5 adds verified reasoning controls and readable names for the broader candidates, with no automatic model changes. These small synthetic-crop studies are provisional, not a comprehensive manga evaluation.

Actual installed Firefox/BookWalker behavior remains unverified. The supported computer-use tool blocked Firefox inspection because URL-policy enforcement is unsupported for that browser. Live provider requests from Node and synthetic browser fixtures do not establish installed-browser compatibility; see [validation status](docs/validation.md).

## Anki word mining

Version 0.5.0 adds optional AnkiConnect support. Anki is an optional final setup step, with **Skip for now**; it also remains under **Settings → Anki → Configure**. Choose your existing deck, note type and field mapping. In a Japanese word popup, **+** adds the word with its reading, meaning, captured Japanese and full translation; the pencil lets you edit first. Mining makes no new model request. See the [Anki setup guide](docs/anki-mining.md). Kaishi mappings automatically include word furigana, Japanese context on both sides and readable spacing. Live AnkiConnect rendering was verified with a temporary test note that was removed afterward. Installed Firefox/BookWalker interaction remains unverified.

## Develop

Node 22 or newer and pnpm are needed for development checks. The installed extension has no runtime package dependencies and needs no build step.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm package
pnpm test:browser
```

The browser fixture runs at `http://127.0.0.1:17843/reader`; native IndexedDB checks are at `/idb`. It uses actual extension modules, synthetic page pixels, and a simulated OpenRouter transport. It makes no external model calls. It supplements the tests; it does not prove behavior in installed Firefox or BookWalker.

`pnpm package` uses Mozilla’s pinned `web-ext` tool to produce `dist/manga-reading-assistant-<version>.zip` and its SHA-256 checksum. The ZIP still needs Mozilla signing for permanent installation. Load `src/manifest.json` directly during development. See [release instructions](docs/releases.md) and the [changelog](CHANGELOG.md).

```text
src/
  manifest.json
  icons/          Packaged toolbar, add-on list and popup images
  background/     Browser messages, requests, persistence, settings, OpenRouter
  reader/         Selection, screenshot cropping, card presentation
  popup/          Extension setup and preferences
  shared/         Shared visual theme and local Japanese word help
tests/            Automated tests and browser fixtures
docs/             Product design, architecture, validation
scripts/          Local test server and packaging
assets/           Icon sources and design artifacts
```

See [the product design](docs/design.md), [module responsibilities](docs/architecture.md), and [validation status](docs/validation.md). The former Python lab, credentials, and historical experiments are preserved outside this repository in the old Codex work archive.
