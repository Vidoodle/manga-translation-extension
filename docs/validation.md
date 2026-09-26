# Validation status

The maintainer has used this extension in Firefox on BookWalker throughout development and supplied hands-on feedback. This document records that feedback alongside automated and agent-run checks. Historical statements below that installed Firefox was “unverified” describe the coding agent's automation limitation, not an absence of real Firefox use.

After the focus-only changes, the user still saw a viewport jump and confirmed that closing other Firefox extension popups caused the same BookWalker behavior. Version 0.4.0 therefore moves Saved translations entirely into the reading page and removes Select area and history navigation from the extension popup. Reading uses the shortcut and in-page controls; the popup is configuration only.

Live paid OpenRouter requests through the production provider module were verified from Node on September 25, 2026. The [model screening report](model-benchmark-2026-09-25.md) covers 33 attempts on eight original Japanese crop fixtures: 31 accepted responses, one Gemini 3.8 vocabulary/transcript validation rejection, and one Qwen HTTP 429. All eight Gemini 3 Flash Preview requests succeeded with the current configuration. This does not reproduce the earlier Firefox HTTP 400 or establish installed Firefox/BookWalker compatibility.

## Automated checks

Run `pnpm test` and `pnpm format:check` from the project root. Automated checks use the production source with Node and simulated browser/provider boundaries; they do not replace installed-browser acceptance.

Version 0.4.6 passes all **268 tests** and the formatting check. The suggestions now put Gemini 3 Flash first as **Recommended**, followed by Flash-Lite as **Faster & cheaper**, with the agreed descriptions. Existing tests verify order, catalog prices, selection/focus by model ID and continued access to a saved Sonnet choice through All models. The local popup fixture was visually checked in the in-app browser: both descriptions and badges fit, changing the selected card retained the suggestion order, and the existing selection remained on opening. This was a simulated popup, not an installed Firefox test.

Version 0.4.5 passes all **268 tests** and the formatting check. The [broader family screening](model-benchmark-broader-2026-09-25.md) adds 41 live attempts: 35 accepted answers, four validation failures, and two shared-provider rate limits. It retains the two existing recommendations after comparing DeepSeek, Claude Haiku/Sonnet, GLM, MiniMax and Mistral. Supported low-reasoning settings were added for DeepSeek V4.1 Flash, Sonnet 5 and GLM-5.3 Flash; other candidates retain provider defaults. The benchmark now checks pricing overrides, resume consistency and stable anonymous cohorts, and retains reported usage on terminal rejected streams. It cannot recover DeepSeek's already-lost final charge; that unknown cost stopped the run before Haiku's final case. No failed request was retried, and these Node calls do not establish Firefox/BookWalker acceptance.

After adding the benchmark tools, all 255 tests and the formatting check pass. Eight added regressions cover offline dry runs, production request settings, credential redaction, explicit budget reservations and avoiding repeated paid attempts. The live model screening is separate from these automated tests and is never run by `pnpm test`.

Version 0.4.4 passes all 257 tests. Qwen diagnostic requests reproduced invalid array-shaped results and an Alibaba HTTP 429 with `limit_source: upstream_provider_shared_pool`. The error now identifies shared provider capacity and Alibaba without exposing raw diagnostics. Regressions cover that classification, rejection of array-shaped answers without another paid request, the two-model shortlist, and preservation of saved Luna/Qwen choices. Prompt and reasoning experiments did not establish a reliable repair and were not shipped. See the [Qwen diagnostic report](qwen-diagnostics-2026-09-25.md); the original 33-attempt benchmark remains unchanged.

Version 0.4.3 passed all 247 tests and the formatting check. Its model changes cover supported outgoing reasoning controls (including Qwen's budget-only gateway configuration), exact selected model, actual request metadata, unknown-model behavior, profile-sensitive cache identity, and continued access to saved translations. Recommendation checks cover the new three-model shortlist, catalog-provided prices, availability filtering and preservation of existing model choices. The local popup fixture showed all three suggestions with consistent card spacing and retained its existing Gemini selection on opening. These checks use simulated requests, not live model generations.

Version 0.4.1 passed all 243 tests. It corrects the shortcut's state handling: selection opens the library, while pending/completed translations and loaded/loading library cards start a new selection. Regressions verify stale library/history/poll replies cannot replace that selection and the original pending job's port remains alive. The local browser fixture verified library → selection, pending translation → selection, and completed translation → selection. The pending request completed and was saved with one capture, one simulated provider request and zero native popups; the saved-card transition retained the 720px scroll position. Installed Firefox remains unverified.

Version 0.4.0 passed all 238 automated tests on September 25, 2026. Obsolete popup-reading tests were replaced with coverage of the in-page library, authenticated history access, pending-job continuity and configuration-only popup. Focus regressions exercise page handlers that reset a nested scroller, verify saved-card mounting/replacement/dismissal makes no programmatic focus changes, and check that pointer clicks on library controls do not move focus while keyboard activation still works. Repeated library/card navigation keeps listener counts bounded. Saved entries remain accessible after setup removal, with new capture and paid work blocked until configuration is complete.

Relevant tests cover:

- Reader activation requires a mounted acknowledgement for the current session. Missing/mismatched replies and transport failure surface errors; late older replies cannot disrupt a newer activation.
- Activation and dragging perform no capture, pixel scan or page lookup. Releasing a valid rectangle captures once; a second release during preparation cannot submit duplicate work.
- Cropping draws directly from the screenshot Image into one selected-size canvas. RGBA expectations cover nonzero coordinates and HiDPI/fractional edges without a full-screen pixel read.
- Pending/completed cards preserve their original selection while scrolling. Trusted dragging, card bounds, position persistence and dismissal are covered separately.
- Keepalive-port failure does not stop a healthy status channel or add an interruption warning. Polling can finish after port loss; **Check again** retrieves the existing answer after an actual status error without resubmission. Elapsed time retains the original request start through long requests and repeated scrolling.
- Safe Japanese rendering, locally supplied word readings/meanings and grammar arrive together. Opening word help does not request a model.
- Setup gating, key isolation, authenticated messages, exact request identity, atomic claims, concurrent duplicates and durable request recovery.
- Explicit paid retries, uncertain outcomes, interrupted recovery, failed persistence and protection of required source requests.
- One-time database migration removes obsolete completed answers and page/region references, retains non-completed work and required source translations, and does not clear new answers on subsequent opens.
- Saved-translation library uses authenticated reader messages and the same in-page host/session, retains the list on errors, and blocks duplicate opens. Saved pending jobs resume polling without resubmission. Configuration cannot start selection or navigate saved translations. Restart confirmation/cancellation and pending settings-write protection remain covered.
- Model catalog receiver binding, refresh/error handling, labelled cached prices, explicit choices and unavailable selections.
- Packaged entry points, script order and local icon assets.

The former matching/outline tests are not acceptance criteria for the simplified reader. That feature has been removed.

No real API key or paid OpenRouter generation was used in the automated checks. A prior public-catalog request through the production SettingsService succeeded from Node without an API key. That verifies the catalog path in that environment, not Firefox permissions or Gemini generation.

The direct-Image crop approach is supported by Mozilla's implementation: [extension-owned images can grant selective canvas read access](https://github.com/mozilla-firefox/firefox/blob/main/dom/canvas/CanvasUtils.cpp#L598), while [copying a write-only canvas propagates write-only state](https://github.com/mozilla-firefox/firefox/blob/main/dom/canvas/CanvasRenderingContext2D.cpp#L5595). Synthetic regressions model that boundary; they are not a completed reproduction in the user's Firefox session.

## Browser fixtures

Run `pnpm test:browser`. The local server binds to `127.0.0.1:17843` and serves an explicit file allowlist. `/reader` uses production modules, native canvas and IndexedDB, simulated Firefox APIs, and simulated OpenRouter responses. `/popup` exercises configuration and setup. `/idb` exercises native IndexedDB. The reader fixture shows an extension-popup counter so reading flows can be checked for zero native-popup invocations.

Version 0.4.2 corrects stacked settings margins. Local browser measurements confirmed that model, key, collapsed/expanded shortcut, saved-data and reset sections all use 12px top/bottom padding and zero outer margins. The light and dark settings screens were visually inspected. Expanding key guidance preserves a 20px gap before Back and its 8px/12px button padding. The loaded model screen hides its empty status wrapper, retains the same 20px action gap and has no horizontal overflow at the popup's 380px body width. These checks use the production HTML/CSS with simulated settings, not Firefox's native popup sizing.

Version 0.4.0 was checked in the supported in-app browser against the local fixture. The configuration popup was reviewed at 380px width with model, key, shortcut, saved-data and reset settings, and no selection or saved-list navigation. Alt+Q activated selection with zero captures and zero native popups; the next Alt+Q opened the in-page Saved translations list.

The `focus-sensitive` fixture has a page handler that resets scroll when a card or its controls receive focus. An initial library-row mouse click reproduced a jump from 640px to 0. After preventing pointer focus on reader action buttons, choosing an entry retained 640px with zero focus resets, captures, provider requests or native popups. Returning through the bookmark icon, closing the list, reopening it and dismissing with Escape also retained 640px. Keyboard activation is covered by automated tests.

The popup fixture now uses a nonmodal container. An older `dialog.showModal()` adapter made the reading page inert and masked focus problems; its earlier unchanged-scroll results are not acceptance evidence. The `popup-focus-sensitive` fixture separately models the user's observation that closing a native extension popup moves the reading page. Reading actions must leave its native-popup counter at zero.

With a 40-second simulated response, the in-page library exposed the running request and reopening it resumed progress. The request completed while the fixture scrolled from 640px to 2540px. Library entry selection added no captures or provider requests; the provider count remained one and native-popup/focus-reset counts remained zero. The dark library was visually inspected and dragged, then an entry was reopened and dismissed with Escape at the same 2540px position.

After removing the fixture's fake key with no open reader, the shortcut opened the saved library directly. Choosing an entry displayed its Japanese, translation and grammar with paid controls disabled; scroll stayed at 2540px and popup/capture/provider counters stayed at zero. Choosing a model in configuration updated its settings screen without accessing the reading tab or closing the popup.

Earlier fixture passes established native IndexedDB claim/recovery, card position persistence, local word help, delayed translation completion while scrolling, and guarded configuration reset. Styling checks covered both appearances, matching popup/reader/pending fonts, 18px Japanese, 15px translations and model selection at 380px without horizontal overflow. Theme previews (`?theme=light` / `?theme=dark`) force only the test adapter's color scheme; they do not verify Firefox's native theme selection or toolbar rendering.

Popup spacing was checked at narrow fixture viewports. The user also found a Firefox-native popup-width regression that those checks missed. The fixed width now belongs to `body` (380px), following [Mozilla's popup sizing guidance](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/user_interface/Popups#popup_resizing); `html` does not set a fixed width. Fixture layout measurements do not prove installed Firefox popup sizing.

## Installed Firefox and BookWalker limits

An isolated installed-Firefox smoke attempt was stopped by the computer-use tool with:

> Browser URL policy enforcement is not yet supported for the current Windows browser.

No extension was loaded through that route. Only the isolated test processes were stopped. A later attempt to inspect the actual Firefox BookWalker window met the same tool-policy blocker; the window was not controlled after the rejection. Expanded filesystem permissions did not establish support for that UI surface.

Opening the supplied BookWalker viewer in the supported in-app browser instead produced a message that the eBook could not be viewed and required reopening or signing in. This did not verify the user's authenticated Firefox reader.

## Remaining acceptance checks

- Install/reload version 0.4.0 in actual Firefox and verify shortcut selection, repeated-shortcut in-page library, entry selection, native configuration-popup size, modal drag/Close, capture permissions, fullscreen and BookWalker canvas/iframe behavior. Saved entries must not open or close the native popup.
- Confirm screenshot alignment and latency on real display scaling, and scroll little by little while a request is pending.
- Verify the one-time migration against the installed profile without changing credentials or losing recoverable request intent.
- Confirm the chosen model from the installed extension on representative BookWalker selections. Live cost, latency and structured output were measured from Node in the model screening above; the earlier free-model rate limit and Firefox Gemini HTTP 400 have not been reproduced. Displaying retained HTTP status improves diagnosis but does not itself fix a remote failure.
- Have a competent Japanese reader assess transcription, meaning, natural English, word help and grammar on representative manga.

Unknown outcomes never authorize automatic paid retries. A deliberate retry can incur another charge. The package remains unsigned; temporary installation disappears on Firefox restart.

## Anki mining — 26 September 2026 (0.5.0)

- 281 automated tests pass, including mapping, escaping, multi-region context, duplicate/concurrent submission, permissions, offline/unknown outcomes, save/disconnect ordering, reader authentication and optional setup.
- The in-app browser exercised real settings and reader UI against synthetic Anki responses: configure Basic fields, save settings, translate, open word help, edit its meaning and add successfully. Translation request count stayed unchanged during mining.
- Tests found and resolved a pending-popup reopen bug: the reopened popup now receives completion feedback.
- No real collection was modified. The local AnkiConnect probe did not connect. Native Firefox inspection was first rejected because its current page contained unrelated private content; opening a separate test tab then hit unsupported Firefox URL-policy enforcement. Installed Firefox/BookWalker and live AnkiConnect remain unverified.

## Optional Anki onboarding — 0.5.1

285 automated tests pass. Coverage includes fresh setup, persisted resume, skipping without Anki access, saving a mapping, back navigation, skipping after connection failure, existing-user behavior and reset persistence. The in-app browser fixture verified the optional step layout, Skip for now and reopening to Settings after completion. This does not extend the installed Firefox/Anki verification described above.

## Pinned word help — 0.5.2

287 automated tests pass. New regressions cover pinning an already hovered word without recreating its popup; crossing another word, focus changes and delayed leave events; explicit word switching and dismissal; and keeping the correct word and edited meaning when adding to Anki. No new live Firefox verification is claimed.

## Word editor controls — 0.5.3

287 automated tests pass. The word editor now shows a text Done action while open, updates the popup preview with edited values, and keeps Add to Anki separate. Tests cover the action labels, editor state, preview update and lack of submission on Done. The supported browser fixture verified opening the editor, changing a meaning and returning to the revised popup via Done.

## Direct edit-and-add — 0.5.4

The editor now has one Add to Anki action below its fields. It submits current edits directly and collapses after confirmed success. The pencil is hidden during editing; there is no Done step. All 287 tests pass, covering edited payloads, pending guards, retained drafts and success state. The supported browser fixture exercised editing a meaning and submitting directly through simulated AnkiConnect.

## Kaishi note formatting — 0.5.5

All 291 tests pass. Added coverage for both saved and suggested Kaishi mappings, generated furigana, edited readings/context, preserved paragraphs, sentence spacing, escaping, unavailable readings and custom mappings. Through live AnkiConnect, the production AnkiService.add created a temporary note in Mined Words using the real Kaishi 1.5k note type. cardsInfo confirmed actual Anki ruby rendering, the Japanese sentence on both card sides and the front sentence gap. The test note was then deleted by its returned ID and removal confirmed. Existing notes and shared card templates were not changed. The live rendered HTML is in ignored test-results/kaishi-live-render.json. This verifies the Anki boundary, not installed Firefox/BookWalker interaction.

## Repository cleanup and releases — 0.5.6

- 286 automated tests pass. The count is lower because tests for removed page-placement routes and fresh standalone study creation were removed; current translation, capture, retry, Anki and migration coverage remains. New checks cover v2-to-v3 preservation, retired message rejection, packaged-file reachability and version/changelog consistency.
- Native IndexedDB fixture: 6/6 checks passed in the in-app browser. The reader fixture loaded the renamed capture module, translated a selection with exactly one capture and one simulated request, and reopened the saved answer with no extra capture or request. Its existing saved entries survived the storage upgrade.
- Formatting and git whitespace checks pass. A local unused-variable audit reported no unused local variables in production JavaScript.
- Mozilla web-ext 10.7.0: zero errors, one warning for Android's data-collection manifest support (142 versus the desktop minimum 140). Desktop Firefox is the target; Android and installed Firefox/BookWalker interaction remain unverified.
- The versioned ZIP contains only extension source; its SHA-256 checksum accompanies it. Local packaging is not Mozilla signing or publication.
