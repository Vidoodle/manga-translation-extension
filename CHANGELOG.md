# Changelog

Versions follow `major.minor.patch`. Dates use ISO format. Versions 0.5.0–0.5.5 were local development builds; a changelog entry does not imply Mozilla signing or publication.

## [Unreleased]

- Add a visual product walkthrough, Firefox publication and setup guidance, and a separate developer guide.

- Add the MIT license, privacy policy, and a public-facing guide to installation, reading, Anki setup, and OpenRouter costs.
- Record the pre-publication audit of Git history, release downloads, and CI artifacts and logs.
- Replace development-session notes with a focused testing guide and current product documentation.

## [0.5.6] - 2026-09-26

- Remove the retired page-recognition service, placement database stores, unused message routes, and redundant icons. Preserve saved translations and unresolved paid requests.
- Remove creation of separate word-explanation requests; word help and grammar continue to arrive with the translation. Retain recovery of existing request records.
- Rename the selection capture module to reflect its current purpose and update stale documentation and fixtures.
- Add checked version updates, versioned Mozilla upload ZIPs, SHA-256 checksums, release instructions, and Mozilla's official lint/build tool.
- Run validation and upload an unsigned package artifact in GitHub Actions on pushes and pull requests.

## [0.5.5] - 2026-09-26

- Recognize Kaishi field layouts and suggest the appropriate Anki mappings.
- Populate word and sentence furigana, retain Japanese on both card sides, highlight the mined word, and improve sentence spacing in newly added notes.
- Support existing mappings and edited values without additional model requests or shared-template changes.

## [0.5.4] - 2026-09-26

- Submit edited words directly through Add to Anki; remove the redundant Done step.

## [0.5.3] - 2026-09-26

- Distinguish the editor's completion action from its pencil icon. Superseded by the simpler 0.5.4 flow.

## [0.5.2] - 2026-09-26

- Click a word to pin its reading popup while editing or adding it to Anki.
- Preserve draft, pending, success, and error state when the word popup is reopened.

## [0.5.1] - 2026-09-26

- Offer optional Anki configuration as the last setup step, with a persistent Skip option and later access through Settings.

## [0.5.0] - 2026-09-26

- Add optional local AnkiConnect integration with deck, note-type, and field configuration.
- Mine words with readings, meanings, full Japanese context, and the translation; edit before adding.
- Handle duplicates and uncertain submission outcomes without automatic retries.

## [0.4.6] - 2026-09-26

Baseline imported into this GitHub repository. Earlier iterations were not separately tagged here.

- Translate selected manga crops with inline word help and grammar explanations.
- Keep saved translations in the in-page reader and settings in the extension popup.
- Support draggable cards, continuous scrolling, explicit request retries, and durable local storage.
- Include model recommendations, price refresh, and recorded model-quality screening.
