# Anki word mining

Save vocabulary from a translation to your own Anki deck, without another model request.

## Setup

1. Install [AnkiConnect from AnkiWeb](https://ankiweb.net/shared/info/2055492159) in Anki Desktop, restart Anki, and open your collection.
2. During first setup, Anki is the optional step after choosing a model. Choose **Connect to Anki** or **Skip for now**; it remains available under **Settings → Anki → Configure**. Connecting requests local access in Firefox; accept Anki’s connection prompt if it appears.
3. Choose your existing deck and regular note type, then assign each value to a field. Several values can share a field in the displayed order.
4. Save, close settings, and activate the reader with your shortcut. Unfinished onboarding resumes on reopening; saving or skipping completes it. Existing users keep their settings without repeating setup.

For Basic notes, the default is **Word → Front** and **Reading, Meaning, Japanese context, Full translation → Back**. Specialized vocabulary note types can keep values separate. Unmapped fields stay empty except for the derived Kaishi fields described below. Your existing card templates determine what appears when studying. Deck/template creation and cloze generation are not included.

### Kaishi cards

Kaishi's field schema is recognized automatically, including cloned note types. Setup suggests Word → Word, Reading → Word Reading, Meaning → Word Meaning, Japanese context → Sentence, and Full translation → Sentence Meaning. Existing mappings with Reading → Word Furigana also work without reconfiguration.

With these mappings, Add to Anki also fills Word Reading, Word Furigana and Sentence Furigana. The word keeps its kanji with the reading above it; Japanese context appears on both sides. The mined word is highlighted using Kaishi's existing bold color and its available reading is included in the sentence. Other words remain plain Japanese; no extra model request is made. Edited values are used, and missing readings leave the Japanese visible.

New notes include a 20px gap above the front sentence and comfortable sentence line height. Single manga line breaks are joined for reading, while paragraph breaks remain. This formatting is stored in the new note's sentence fields. Shared templates, existing notes and saved translations are not modified. Custom mappings outside the standard Kaishi layout retain the generic field behavior.

| Value | Saved content |
| --- | --- |
| Word | The displayed Japanese surface, including inflection |
| Reading | The reading from this translation |
| Meaning | Its contextual English explanation |
| Japanese context | The full captured Japanese passage |
| Full translation | The full captured English translation |

Word is not automatically converted to dictionary form. Readings and meanings are model output and can be corrected.

## Mining

Hover to preview a Japanese word; click it to pin its popup while you move to the controls. Other words do not take over on hover. Click another word to switch, or click outside / press Esc to dismiss. Scrolling the reading area also dismisses word help. Click **+ (Add to Anki)** to create a note, or the **pencil (Edit Anki note)** to adjust values first. The editor has one action, **Add to Anki**, below the fields. It sends the edited note directly; no separate Done or Save step is needed. Successful submission closes the editor. Success appears in the same popup. Fresh and saved translations use the same flow. Hovering never creates a note.

Each add creates one note tagged `manga-reading-assistant`; the note type determines how many cards it produces. A crop can contain multiple sentences. You can trim Japanese context in the editor, but the English stays labelled **Full translation** and is not automatically aligned to a trimmed sentence. Audio, dictionary lookup, automatic sentence alignment, cloze generation and TSV export are not included.

## Connection and recovery

Keep Anki Desktop running with your collection open. Only the extension background contacts `http://127.0.0.1:8765`. Keep AnkiConnect’s default loopback binding; wildcard origins and network-wide access are unnecessary. Firefox’s optional permission covers the loopback host; the extension code and connection policy restrict Anki requests to port 8765.

If you configured an AnkiConnect API key, enter it under the optional key disclosure. It is saved locally alongside the mapping, never synced, sent to OpenRouter or exposed to the reading page. Blank keeps a saved key. **Disconnect** removes Anki settings and the key and revokes local access, without deleting notes in Anki. Resetting OpenRouter setup preserves Anki settings.

- **Anki closed:** open Anki and try Add again. Your editor remains available.
- **Duplicate:** no second note is added. Anki compares the first field within the same note type across the collection. Include Word in that field. Different inflections can count as different words. Existing notes are never overwritten.
- **Fields changed:** reconnect and save a new mapping.
- **No confirmation:** the note may already exist. Check Anki before retrying. Add stays disabled for that word in the current reader session; close and reactivate the reader after checking if another attempt is needed. There are no automatic retries or offline queue.

For test coverage and integration results, see the [testing guide](validation.md).
