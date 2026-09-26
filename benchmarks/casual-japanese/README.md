# Casual Japanese crop screening

Eight original dialogue samples, written for this project. These are synthetic speech balloons, not scans of published manga. Six use vertical right-to-left columns, two use horizontal text, one has furigana, and one uses smaller type. The fixtures test casual language, participant roles, negation, dialect, unfinished sentences and context-dependent readings. They do not test handwriting, damaged scans, complex page layouts or inference from artwork.

`cases.json` contains the source and grading references. `images/` contains the actual inputs. Only the image and an empty reading-context string go to the model; the reference answers are never included in the request. `contact-sheet.png` is for visual inspection and is not submitted.

The [September 25, 2026 live screening report](../../docs/model-benchmark-2026-09-25.md) records measured results, actual mistakes and provisional recommendations.

The [broader-family results](../../docs/model-benchmark-broader-2026-09-25.md) compare DeepSeek, two Claude models, GLM, MiniMax and Mistral against the two useful Gemini baselines, retaining failures and partial-run denominators.

The [broader family comparison](broader-screening.md) adds DeepSeek, Claude, GLM, MiniMax and Mistral. Additional model IDs require an explicit `--model` filter; the original five-model default remains unchanged. Live planning uses the highest published pricing overrides and cache-write rate. Resuming a run after changing its references, expanding its original model cohort, or changing an already attempted request's configuration is rejected before network access; use a separate run to retain each comparison's evidence and stable anonymous labels.

Regenerate images with Pillow and the Windows Yu Gothic font:

```text
python scripts/render-benchmark-samples.py
```

Use `scripts/benchmark-models.cjs` to compare the production provider request, schema, validation and reasoning settings. The runner is offline by default; `--run` explicitly enables paid requests. Credentials come from `OPENROUTER_API_KEY` or the ignored project-root `.env`, never from tracked files. Results go under ignored `test-results/model-benchmark/`.

```text
node scripts/benchmark-models.cjs --run-name example
node scripts/benchmark-models.cjs --run-name example --sample 01-contractions --run
node scripts/benchmark-models.cjs --run-name example --run
node scripts/summarize-model-benchmark.cjs --run-name example
```

The runner skips every attempted request in the same run, including failures. It checks a conservative catalog-based planning bound against a $1 run budget, then tracks reported usage costs. Unknown costs stop the run by default. After inspecting a confirmed HTTP 429 rejection, `--reserve-rate-limits` permits explicit continuation while reserving that attempt's full planning bound; it never retries that attempt. Use `--model` with a comma-separated list of exact IDs to continue without the unavailable model. The reservation is reported separately from actual billed cost. These bounds depend on provider pricing/tokenization and are not an account-level spending limit.

The summarizer writes `metrics.json`, two blinded review files, and a separate `blinding-key.json`. Grade the review files before opening the key or comparing prices. Preserve the raw append-only events so unsuccessful attempts remain visible.

## Predeclared evaluation

Run one attempt per sample/model. Count failed and rejected outputs, never silently rerun them. Rotate model order across samples. Report actual OpenRouter costs, first-content and completion latency, and provider identities. Eight observations per model describe this screening run, not a reliable general latency distribution.

Grade English, readings and grammar with model identity and prices hidden from the reviewers. Use the references as semantic guides, accepting valid alternative wording and segmentation.

- **OCR (25):** NFKC-normalized character error rate after removing whitespace, retaining punctuation and order. `25 * max(0, 1 - pooled CER)`. Also report exact matches and missing/reordered dialogue. A rejected answer counts as an empty transcript for accepted-result scoring.
- **English (40):** Each sample receives 0–5: 5 accurate/natural; 4 accurate with minor awkwardness; 3 a meaningful omission/distortion; 2 substantially incomplete; 1 a critical reversal; 0 missing/unusable. Flag reversed participant roles or negation, invented identities, and invented endings.
- **Readings (25):** One point for each of the 25 reference targets correctly covered. Adjacent entries may cover a target jointly. Accept listed alternative readings. Missing or incorrect targets receive zero. Separately flag wrong readings or definitions anywhere in the answer, even beyond the target list.
- **Grammar (10):** Each sample receives 0–2, scaled from 16 to 10: 2 explains the central construction accurately; 1 useful but incomplete; 0 missing, irrelevant or materially wrong. Do not demand every reference grammar point.

Rejected responses receive zero quality credit for that crop. Retained raw responses may help diagnose rejection but are not counted as answers delivered by the extension. Report material mistakes alongside totals so a high average cannot hide a serious teaching error. This is an assistant-reviewed screening exercise, not a native-speaker study or a comprehensive manga benchmark.
