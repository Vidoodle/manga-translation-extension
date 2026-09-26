# Privacy policy

Effective September 26, 2026. This policy describes Manga Reading Assistant 0.5.6, maintained by [Vidoodle](https://github.com/Vidoodle).

Manga Reading Assistant translates selections through your OpenRouter account and optionally adds words to Anki Desktop. The extension has no developer-operated server, analytics, advertising, or automatic crash reporting. The maintainer does not receive your API key, captures, translations, or reading activity through the extension.

## When you translate

After you select an area, Firefox captures the visible tab. The extension crops that screenshot on your device and sends **the selected crop** to OpenRouter over HTTPS, together with translation instructions and your chosen model and request settings. Your OpenRouter key authenticates the request. OpenRouter routes the content to a model provider and returns the Japanese text, translation, word help, and grammar explanations.

The full screenshot is used temporarily to create the crop; it is not uploaded or saved in the translation history. Anything visible inside your selection can be sent, so select only content you want translated. Starting the selection tool or dragging the rectangle does not send a translation request. Opening saved translations or word help does not send another request. An explicit retry can send the saved crop again; recovery of older word-help requests can send their saved Japanese text and context.

The active page's URL and tab identifiers are used locally to keep the reading session attached to the right tab. The extension does not read your browser history or add the page URL to its translation payload. A URL or other personal information visible inside a selected image would be part of that image.

Opening model selection requests OpenRouter's model catalog and prices. This catalog request does not include your API key, captured images, or translations. Like other internet services, OpenRouter receives connection information such as your IP address. Its handling of requests and providers' retention and training practices are governed by their own policies and your account settings. See [OpenRouter's privacy policy](https://openrouter.ai/privacy) and [data collection documentation](https://openrouter.ai/docs/guides/privacy/data-collection). The extension does not enforce zero retention or a particular provider's training policy.

## What stays on your device

Firefox's local extension storage holds your OpenRouter key, chosen model, cached model catalog, card position, setup preferences, and optional Anki configuration and AnkiConnect key. The local translation database holds selected crops, answers, vocabulary, grammar, request status, timestamps, model information, and reported usage and cost. Temporary browser-session storage holds reading-session identifiers and page URLs.

The extension does not use Firefox Sync for this data. Ordinary saved translations are evicted as the cache reaches its count or size limits. Pending and interrupted requests, together with any source answers they require, are retained separately so their outcomes can be checked without accidentally paying twice. There is no fixed time-based deletion schedule.

**Saved keys are not encrypted by the extension.** Use your own password-protected computer account and avoid saving a key on public computers or accounts shared with people you do not trust. Someone with access to your Firefox profile files could read it. A dedicated key with a small spending limit in [OpenRouter's key settings](https://openrouter.ai/settings/keys) limits potential charges. The extension keeps the key in its background/settings code and does not pass it to the reading page.

## Optional Anki support

Anki is contacted only after you enable its connection. The extension uses AnkiConnect on your own computer at `http://127.0.0.1:8765` to request deck and note-type information and, when you click **Add to Anki**, create a note. The note contains the selected word, reading, meaning, Japanese passage, and full English translation, including edits you make. Your chosen deck and field mapping determine where those values go. An optional AnkiConnect key is sent to that local service.

This does not make another OpenRouter request. The extension does not contact AnkiWeb. If you enable syncing in Anki itself, the resulting notes may sync under Anki's own settings and policies.

## Your controls

- **Clear saved data** in settings removes ordinary saved translations and crops. It preserves pending/interrupted request records and the source data needed to recover them; it is not a complete data wipe.
- **Remove key** removes the locally saved OpenRouter key. **Reset connection** also removes the model choice and returns to setup. Neither action deletes saved translations or your Anki settings.
- **Disconnect Anki** removes the extension's Anki settings and AnkiConnect key and revokes its local connection permission. Notes already added to Anki remain in Anki and can be deleted there.
- Deleting a key from the extension does not revoke it at OpenRouter. Revoke or replace it in OpenRouter's key settings if you want to disable it or think it was copied.
- Deleting local data does not delete data already processed by OpenRouter, its providers, or Anki. Their own controls and policies apply to those copies.

## Questions and policy changes

Contact the maintainer through [GitHub issues](https://github.com/Vidoodle/manga-translation-extension/issues). Share only information you are comfortable posting publicly; do not include API keys or private captures. Information you choose to post there is handled by GitHub under its policies.

Changes to the extension's data handling will be reflected here with an updated effective date and recorded in the [changelog](CHANGELOG.md).
