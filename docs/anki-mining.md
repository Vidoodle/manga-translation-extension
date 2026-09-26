# Proposed Anki word mining

Discussion draft, 26 September 2026. **Not implemented.** This proposal reuses saved translations; mining a word would not make another model request.

## Reading flow

After configuration, the existing word popup would have a small **Add to Anki** icon. One click would add that word using the saved mapping and show success in place. An optional **Edit** action would let the user adjust the word, meaning, or context before adding. Hovering would never create a note, and adding would not move the reading page or open another application window.

The extension would create one Anki *note* per selected word. The selected note type determines how many cards that note produces. Audio, automatic dictionary lookup, deck creation, and an offline submission queue would be outside the first version.

## Configuration

Add an Anki section to Settings: connect to local Anki, choose an existing deck, choose an existing note type, and map its fields. Show a sample preview while configuring, rather than requiring a preview for every word. Remember the mapping and offer a refresh when the user changes their Anki collection.

| Available value | Meaning |
| --- | --- |
| Word | The selected Japanese surface exactly as displayed, including inflection |
| Reading | The reading already supplied for that surface |
| Meaning | The existing contextual English word explanation |
| Japanese context | The captured Japanese passage, optionally edited down to a sentence |
| Full translation | The English translation of the entire captured passage |

Fields could be omitted or combined, so an ordinary Front/Back note type remains usable. More specialized note types could keep these values separate. The first release should support ordinary vocabulary note types; cloze generation would require a separate design.

**Word does not mean dictionary form.** The current data has no lemma, so, for example, an inflected surface must not silently be replaced with a guessed base form. Reading and meaning are model output and should remain editable.

## Context is the main product decision

The current provider returns one Japanese transcription and one English translation for the whole crop, with `words: [{surface, reading, meaning}]`. Internally these become one selection region. `WordHelp` matches exact surfaces in the transcript; it does not carry sentence IDs or English alignments. Repeated appearances of the same surface currently use the same matching vocabulary entry.

The dependable default is therefore **full captured Japanese + full translation**. An optional editor can let the user trim Japanese context to the source sentence. That does not make the full English translation a translation of only that sentence. We should keep the label “Full translation,” and avoid inventing sentence alignment or making another paid request. Automatic sentence suggestions could come later, but punctuation and manga line breaks are not reliable sentence boundaries.

## Local connection and duplicate handling

Anki desktop would need to be running with AnkiConnect installed and a collection open. Its archived official configuration uses API version 6 at `http://127.0.0.1:8765`, with an optional API key. The extension should keep requests in its background context and request only the required localhost access; its present host permissions and connection policy do not permit this endpoint. Keep AnkiConnect bound to loopback and avoid wildcard CORS configuration. [Official configuration](https://github.com/FooSoft/anki-connect/blob/master/plugin/util.py) · [Mozilla host permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions).

The relevant API actions are `requestPermission`, `deckNames`, `modelNames`, `modelFieldNames`, `canAddNotes`, and `addNote`. The latter returns a note ID; preflight success does not replace checking the add result. Duplicate checking uses the first field and, by default, the same note type across the collection. `duplicateScope: "deck"` and child-deck options narrow or expand that scope; `allowDuplicate` permits a deliberate override. Recommend rejecting duplicates by default, with no automatic updates to existing notes. Putting Word first means different inflections remain different entries. [Official API implementation](https://github.com/FooSoft/anki-connect/blob/master/plugin/__init__.py).

If Anki is closed, keep the word popup available and show “Open Anki and try again.” If an add times out, report that its outcome is unknown and let the user check Anki before retrying. Disable repeated clicks while an add is pending. No automatic resubmission or queue is needed.

AnkiConnect also checks request origins and supports a permission handshake; the archived server has special handling for extension origins. Actual Firefox behavior and the installed add-on must be verified before implementation. [Official origin handling](https://github.com/FooSoft/anki-connect/blob/master/plugin/web.py).

## Optional fallback and verification limit

A UTF-8 TSV export could support manual import without AnkiConnect. Anki lets users choose the deck/note type and map columns. Import duplicate behavior needs care: the default can update matching first fields, so it is not equivalent to the proposed reject-duplicate Add action. Media would need separate packaging. [Official text-import manual](https://docs.ankiweb.net/importing/text-files.html).

FooSoft's GitHub repository is archived and explicitly points to [SourceHut as the current upstream](https://git.sr.ht/~foosoft/anki-connect). SourceHut could not be retrieved during this review. The API details above were checked against the archived official source, not a verified current checkout; confirm them against the installed/current version before implementing. [Official migration notice](https://github.com/FooSoft/anki-connect).
