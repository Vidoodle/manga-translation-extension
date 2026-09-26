# Testing

## Automated checks

Run from the project root with Node 22 or newer and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm check
```

The checks cover request deduplication and recovery, storage migrations, screenshot geometry, reader lifecycle, saved translations, setup, model selection, Anki mapping and submission, packaged assets, formatting, and release metadata. Browser and provider boundaries are simulated; the suite does not make paid model requests.

## Browser fixtures

Run `pnpm test:browser`, then open:

| URL | Coverage |
| --- | --- |
| `http://127.0.0.1:17843/reader` | Selection, cards, saved translations, word help, scrolling and request progress |
| `http://127.0.0.1:17843/popup` | Setup, settings, model selection and Anki configuration |
| `http://127.0.0.1:17843/idb` | Native IndexedDB transactions, migration and recovery |

The fixtures use production modules, synthetic page content and simulated Firefox/OpenRouter/Anki responses. The reader uses native canvas and IndexedDB. Focus-sensitive scenarios check that opening and dismissing saved translations does not change scroll position. Request counters check that reopening an answer or mining a word does not submit another translation.

Fixtures cover rendering and state transitions. Firefox permissions, native popup sizing, fullscreen behavior and site-specific canvas/iframe handling need checks in the installed extension.

## Recorded results

For version 0.5.6, checked September 26, 2026:

- **286 automated tests passed**, along with formatting and version/changelog checks.
- **6/6 native IndexedDB fixture checks passed.** Existing translations survived the storage upgrade.
- The reader fixture captured once and submitted one simulated request for a selection. Reopening the saved result made no additional capture or request.
- Mozilla `web-ext` 10.7.0 reported **zero errors and one Android compatibility warning**: the data-collection declaration requires Android Firefox 142, while the desktop minimum is 140. Desktop Firefox is the supported target.
- Live AnkiConnect checks confirmed Kaishi ruby readings, Japanese context on both card sides, and sentence spacing using a temporary note. The note was deleted after verification; existing notes and templates were unchanged.

Live OpenRouter comparisons use the production provider module with original Japanese image fixtures. See the [initial model screening](model-benchmark-2026-09-25.md), [broader comparison](model-benchmark-broader-2026-09-25.md), and [Qwen diagnostics](qwen-diagnostics-2026-09-25.md) for request settings, results and limitations. These small samples do not establish quality across all manga styles.

## Manual release checks

Use the installed Firefox extension on a representative BookWalker reading session when changing reader behavior:

1. Check setup, model selection, permissions and native popup layout.
2. Select text at normal and scaled display settings; confirm that the captured crop matches the rectangle.
3. Scroll while a translation is pending, drag the card, dismiss it, and reopen the completed answer.
4. Open saved translations with the shortcut and bookmark icon. Open and close several entries; the reading position should stay unchanged.
5. Check shortcut transitions, keyboard dismissal, fullscreen changes and light/dark themes.
6. Pin a word, edit a note and add it to Anki. Check duplicate and offline feedback and confirm the rendered card content.
7. For storage changes, verify an upgrade preserves saved translations, settings and unresolved requests.

Run paid translation checks deliberately. An interrupted request may already have incurred a charge; retrying can incur another.
