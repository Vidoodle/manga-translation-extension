# Implementation boundaries

Firefox hosts the extension. OpenRouter handles model requests. Selection, cropping, word help and persistence run locally.

| Module                         | Owns                                                                    | Does not own                                                |
| ------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `background/background.js`     | Message dispatch and service composition                                | Provider parsing or transaction details                     |
| `background/reader-session.js` | Sender/tab/session ownership, checked activation, capture, reader ports | Prompts or DOM rendering                                    |
| `background/settings.js`       | Key storage, catalog, model choice, shortcut and card position          | In-page presentation                                        |
| `background/jobs.js`           | Request identity, durable lifecycle, deduplication and explicit retry   | Browser DOM                                                 |
| `background/store.js`          | IndexedDB transactions, migration, recovery and retention               | Requests or UI policy                                       |
| `background/provider.js`       | Fixed endpoints, prompts/schema, streaming and validation               | Page coordinates or cache decisions                         |
| `reader/vision.js`             | Rectangle normalization, screenshot pixel bounds and card placement     | Page recognition or browser APIs                            |
| `reader/selection-capture.js`       | Serialized explicit capture and selected-size crop export               | Matching, history lookup or model policy                    |
| `reader/reader-view.js`        | Safe DOM rendering, draggable card and word help                        | Requests or persistence decisions                           |
| `reader/content.js`            | Selection/session lifecycle and request coordination                    | Database or provider implementation                         |
| `popup/popup.js`               | Setup, model choice and settings                                        | Reading UI, direct credential persistence or provider calls |
| `popup/popup-format.js`        | Model, price and storage formatting                                     | Browser side effects                                        |
| `shared/japanese.js`           | Literal word segmentation and local tooltips                            | Requests or credentials                                     |
| `shared/theme.css`             | Shared font, color and control-radius tokens                            | Layout or request state                                     |

Browser scripts expose explicit modules in the isolated extension context. Tests import the same code through CommonJS. Manifest order defines background dependencies; the reader service defines injection order. There is no bundler or remote runtime dependency.

## Selection and activation

Activation creates a session, injects the reader modules and sends `manga:start`. Success requires `{ ok: true, sessionId, mounted: true }` with the exact current session ID. Missing or invalid acknowledgements surface an activation error. Generation guards stop a late older response from replacing or failing a newer activation; injection is not automatically retried.

The configurable shortcut activates selection when no reader UI is open. While the selection layer is open, the same shortcut opens the in-page Saved translations modal in the existing session. Pending jobs and their document port remain active. The translation card also has a bookmark icon for the library. Reading actions never invoke `action.openPopup`; that API is reserved for incomplete configuration. The popup contains no selection or history navigation controls.

With a translation or library card open, the shortcut restarts selection using current settings. It never treats an open card as a request to reload the library. Previous jobs keep their ports until work finishes; late responses cannot replace the new selection.

When setup is incomplete but saved entries exist, fresh shortcut activation opens the library without enabling capture or paid actions. With no saved entries it opens configuration. Replacing a library/card releases that view's listeners; session listeners remain until dismissal.

The selection layer mounts without a screenshot or saved-page query. Dragging updates the rectangle only. Releasing a valid selection requests one screenshot, hides the overlay only for capture, restores it before image decoding, and draws the chosen pixels from the original screenshot Image into one selected-size canvas. This avoids both full-screen JavaScript pixel scans and the Firefox security problem caused by copying a selectively readable canvas into another canvas.

Coordinate conversion uses the actual screenshot-to-viewport ratio. Arithmetic noise at integer pixel boundaries is removed before outward rounding; real fractional edges are preserved.

There is no in-page reference matching, saved outline, snapping or periodic capture. New selections create no page reference/region association. The page service, message routes and placement stores were removed in 0.5.6.

Each selection owns its state and pending-operation guards. Async work retains its original selection revision so late output cannot overwrite a newer selection. An open card retains its original crop while the reader scrolls or changes. Resizing/fullscreen changes reposition the card; they do not recapture it. Trusted header dragging persists a normalized position.

Card dragging uses the current measured card dimensions. If completion replaces pending content during a drag, the card recomputes its anchor to retain the header's pointer offset within the viewport.

## Request guarantees

1. Compute identity from the exact input, model, language, context, prompt/schema version and relevant settings.
2. Atomically return completed work, join a live request, or claim a new submission.
3. Persist intent before contacting OpenRouter. Only the claim owner submits.
4. Validate complete output and persist it before notifying the reader.
5. Recover previously running work as interrupted; never automatically repeat an unknown paid request.

Exact-input caching remains independent of the removed visual-matching feature. A similar-looking selection cannot establish a cache hit.

`provider.js` sets reasoning controls only for exact model IDs whose supported parameters have been verified. Flash-Lite uses minimal effort; Luna and the listed Gemini Flash/Pro models use low effort. Qwen3.8 Flash uses `reasoning.max_tokens: 1024`, because OpenRouter advertises budget control rather than effort selection for that model. Unknown models retain provider settings. Request records contain the actual reasoning configuration, and the versioned request profile participates in cache identity. Changing that profile does not delete saved translations.

Translation regions contain Japanese, one natural-English translation, contextual vocabulary and major grammar. Word surfaces must occur in the exact transcript. The same reader card renders new and saved translations with literal safe rendering and local word help. Hover/focus/tap never submits another request.

A document port and heartbeat support work after ordinary card dismissal. They do not guarantee survival of tab/browser closure or process failure. Losing that port does not stop status polling over runtime messages or imply a failed request. Actual status-message errors show **Check again**, which reads the existing job without resubmitting it. Completion that cannot be persisted stays available in memory with an explicit warning. An explicit retry must first persist a previously unsaved failure; late outcome reconciliation cannot overwrite a newer attempt.

New word help and grammar arrive in the initial translation request. The old study-creation route and builder are removed. Existing study records can still be read, polled and explicitly retried through the common durable request service; these recovery paths preserve previously paid request intent rather than creating a second learning workflow.

## Popup and settings

Settings reads/writes remain independent of cache initialization. New work checks setup before activation, capture and submission. Missing setup does not create a failed paid-request record. Saved translations remain readable without credentials.

The popup derives onboarding from saved key/model state. Welcome does no model or history work. Entering the model screen refreshes the public compatible-model catalog and prices automatically. Cached fallback is labelled; a Retry control appears only after loading fails. Explicit model choice is preserved across catalog changes.

The short recommendation list is curated for this workload, not inferred from model names or release dates. Its entries appear only when present in the compatible catalog; all prices come from that catalog. Review recommendations and their reasoning settings together when releasing model updates. The September 25, 2026 review uses [OpenRouter's catalog](https://openrouter.ai/api/v1/models), its [reasoning API](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [OpenAI Docs for Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), and [Alibaba's Qwen API reference](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions). A newer name alone does not establish better manga translation.

The ready popup shows configuration: model, connection, shortcut and saved-data controls. Reset has its own confirmation screen. Cancel returns without mutation. Reset removes only key/model choice and cannot race a pending settings write.

The in-page library requests history through authenticated reader messages. Choosing an entry registers its saved run/job with the current session, then shows the same translation card used for new results. It keeps the same overlay host, does not navigate, scroll, capture or submit another translation, and never opens or closes a browser-action popup. Failed reads retain the library. Pending entries poll their existing job, and explicit retries remain in the card with the original saved input.

`shared/theme.css` supplies font, color and radius tokens to both the popup and packaged reader styles. Light/dark variants follow browser/system preference. Reader card and selection surfaces explicitly set their font inside the shadow tree so page styles on the host cannot alter the UI type. Japanese, translation and grammar take precedence over the compact crop preview and model metadata. Icon controls share sizing and focus treatment. The compact selection hint has a translucent background at the bottom-right edge.

## Migration and retention

The `manga-reader-v3` IndexedDB database uses schema version 3. Upgrading from version 2 deletes only obsolete page and region stores; jobs and claims remain intact. Version-1 databases also receive the historical answer-format reset, preserving non-completed requests and required source translations. Credentials/preferences live in extension settings and are unaffected.

The upgrade runs once, not on every startup. New completed answers persist across reopening. Normal retention bounds ordinary jobs to 200 entries / 120 MiB. Active/interrupted records and required sources remain protected. New submissions also pass a storage admission check. Explicit clearing removes ordinary saved data while preserving unresolved work.

Storage, injection, capture and crop errors identify their failed boundary and retain the underlying cause. Cache failures do not prevent independent key/model/shortcut settings from working.

## Maintenance

Keep rendering separate from request/persistence policy. Keep geometry helpers independent of browser APIs. Tests should cover request counts, state ownership, precise crop pixels, failure recovery and durable data. Do not keep unused visual-matching algorithms merely because their unit tests still pass.

Synthetic fixtures are useful for these contracts. Installed Firefox/BookWalker and paid model quality require separate acceptance evidence.

## Anki mining

`background/anki.js` owns the fixed loopback AnkiConnect v6 transport, credentials, mapping validation and note creation. Only authenticated popup messages configure it. Reading messages must own their source run; the background loads its saved result and resolves the word by region/word index before applying bounded user edits. The reader never chooses an API action, endpoint, note type or deck. Fields are HTML escaped and duplicate rejection stays enabled. Concurrent identical adds share one pending operation; ambiguous outcomes never retry automatically.

`popup/anki-settings.js` shares one configuration form between the final optional onboarding step and Settings. The first saved model records `ankiSetupPending`; reopening resumes Anki until the user saves or skips. Existing configured installations have no pending flag, and later model changes do not restart setup. `shared/japanese.js` adds mining and editing to word help only when enabled. Per-word state preserves pending, success and error feedback across popup closure; translation requests and cache keys are unchanged.
