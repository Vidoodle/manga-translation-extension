# Manga Reading Assistant

**Product and design**

**First target:** desktop Firefox, Japanese-to-English, inside BookWalker.

Help the reader understand manga and practice Japanese without leaving the book. The reading flow is selection, one translation request, and a small card with Japanese, natural English and major grammar points. The extension connects directly to OpenRouter; it needs no local server.

## Reading experience

1. **Set up once:** save an OpenRouter key, allow access and choose a compatible model. The welcome screen does not load models or saved reading data. Setup makes no translation request.
2. **Activate:** press the configurable shortcut (**Alt+Q** by default). Show the selection layer immediately. Do not capture, scan or search saved pages on activation. The extension popup is configuration only.
3. **Choose text:** drag the exact rectangle to translate. Dragging changes only the selection border. Ignore tiny drags. On release, hide the overlay for one screenshot, restore it, and crop the selected area.
4. **Read in place:** show the Japanese, one natural-English translation and major grammar. Hover, focus or tap underlined Japanese for its reading and meaning. These arrive in the original response; word help is local. Keep unrelated notes and large model/recapture controls out of the answer.
5. **Keep reading:** the card opens bottom-right and can be moved by its header. Remember its position and keep it within the viewport. Scrolling while work is pending leaves the original selection's card intact. Closing the card or pressing **Esc** dismisses it; work can finish and be saved afterward.
6. **Revisit a translation:** press the configured shortcut again while the selection layer is open, or use the bookmark icon in the translation card. Show a separate Saved translations modal on the reading page; pending work keeps running. Clicking an entry opens the original crop and saved content in the translation card within the same session. No Firefox popup opens or closes. It does not navigate the book, restore a page position, capture again or submit another translation. Pending entries poll their existing request; explicit retries remain in the card.

There is no in-page recognition, saved-area outline, snapping, automatic page screenshot, or periodic matching. A new drag is never silently adjusted to an older crop. Exact request identity can still reuse completed work or join an identical live request.

With any translation or saved-list card open, **Alt+Q** starts a new selection. Only pressing it while the selection layer is already active opens saved translations. The bookmark icon opens the saved list directly from a translation.

The translation should preserve meaning in natural English across the whole selection, following its reading order. Word readings, meanings and grammar are generated in context, not checked against a dictionary.

## Visual consistency

The popup, reader card and word help share a system font and paper, ink and green theme. Light and dark colors follow the browser/system preference automatically. The extension icon combines a book and speech bubble, with toolbar variants for light and dark themes.

The card heading is **Translation**. Japanese, natural English and grammar are the primary content; the crop preview stays small and readable model names remain secondary. Controls share consistent sizing and focus treatment. The selection hint is compact, translucent and placed at the bottom-right edge. An answer completing during a drag preserves the header's pointer offset, except where the card must be clamped to the viewport.

## Setup and models

The popup contains welcome, key, model, settings and reset confirmation screens. It has no reading actions or saved-translation list. Settings groups model choice, connection, shortcut, saved-data management and reset controls. Selection, the saved library and translation cards live on the reading page. Starting a new translation requires complete setup; reading already saved content makes no provider request.

The model screen automatically refreshes its catalog and prices whenever entered. Show **Retry model list** only after a failed load. Clearly label a cached fallback or unknown prices. Recommended starting models are joined against the available catalog; no model is selected automatically. Keep other compatible models searchable under **All models**.

The suggested models are Gemini 3 Flash Preview for learner explanations and Gemini 3.1 Flash-Lite for lower cost and shorter waits, based on the [model screening](model-benchmark-2026-09-25.md). The screening uses a small set of synthetic crops and is not a comprehensive manga translation ranking. Model choice remains in popup settings. Changing it affects future requests and never regenerates a saved translation.

The reset control in Settings opens a separate confirmation screen. Confirming **Reset connection** removes the key and model choice; Cancel changes nothing. Saved translations, running work, the shortcut and card position remain. This user action is separate from the one-time data migration below.

## Requests and interruptions

| Existing request state                 | Action                                   |
| -------------------------------------- | ---------------------------------------- |
| Compatible completed result            | Reuse it without a model call            |
| Matching live request                  | Join it                                  |
| No matching request                    | Persist intent, then submit once         |
| Submitted request with unknown outcome | Mark interrupted; require explicit retry |

Request identity includes the exact input, model, language, context, prompt/schema and relevant settings. Similar-looking rectangles or repeated dialogue do not establish an exact cache hit.

Accept complete, validated output and save it before notifying the card. Keep incomplete output out of saved completed answers. A request is independent of its card: dismissal does not authorize cancellation or resubmission.

The document port and heartbeat support work during normal popup/card dismissal. They do not guarantee survival of navigation, closing Firefox or crashes. An interrupted request may already have been charged; retries require a deliberate action after a charge warning.

## Data and migration

Only the selected crop is sent for a new translation. Full screenshots stay local and are not retained as page references. The selected crop and answer are stored locally for history and exact request reuse. The key is kept in local extension settings, outside the reading page; it is not encrypted at rest or synced.

The version-3 database upgrade removes obsolete page and region stores while retaining translations and request records from version 2. Version-1 databases also receive the historical answer-format reset, preserving unresolved requests and required source translations. Keys and settings are separate and remain intact. See [migration and retention](architecture.md#migration-and-retention) for details.

Ordinary answers remain bounded; active/unresolved requests and their required sources are protected. **Clear saved data** does not silently resubmit or discard unfinished work.

## Failure behavior

| Situation                                   | Expected behavior                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| No reader acknowledgement after activation  | Show an extension badge and actionable title; do not open a reading popup     |
| Page scroll/turn during a request           | Keep the original card and finish its request without recapture               |
| Reader changes before a selection finishes  | Cancel stale selection geometry rather than capture the wrong area            |
| Tiny or unreadable selection                | Ignore tiny drags; explain when no readable text was returned                 |
| Network/provider failure                    | Show the error; never automatically repeat a paid request                     |
| Storage failure                             | Do not submit without recording intent; keep unsaved completed output visible |
| Duplicate clicks or overlapping activations | Preserve the latest UI and share matching request work                        |
| Missing key or permission                   | Keep saved translations available; guide setup for new work                   |

## Testing

See the [testing guide](validation.md) for automated coverage, browser fixtures, recorded results and manual release checks. Translation-quality comparisons and their limitations are documented in the [model screening](model-benchmark-2026-09-25.md).
