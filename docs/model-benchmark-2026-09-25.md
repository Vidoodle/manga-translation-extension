# Model screening: casual Japanese crops

Measured on September 25, 2026, through live OpenRouter requests using the extension's production provider module.

**Provisional choice: Gemini 3.1 Flash-Lite for responsive, inexpensive reading; Gemini 3 Flash Preview when cleaner word and grammar help matters more than speed.** Luna was cheapest but changed the meaning of two selections through transcription errors. Gemini 3.8 Flash did not demonstrate enough benefit to justify its higher cost. Qwen returned one HTTP 429 and has no quality result.

These findings revise the earlier price-and-capability shortlist: Luna's low price alone is not a good reason to recommend it for image-based Japanese reading, and Qwen has not yet earned a recommendation. The older Gemini 3 Flash remains a useful comparison; a newer model name did not predict better results here. The initial benchmark did not change model suggestions. The subsequent [Qwen investigation and version 0.4.4](qwen-diagnostics-2026-09-25.md) updates the shortlist to Flash-Lite and Gemini 3 Flash, while preserving existing selections and access to other models.

## Measured results

| Exact model ID | Answers accepted | Exact transcripts | Median completion | Reported cost, 8 attempts | Cost per 1,000 similar attempts |
| --- | ---: | ---: | ---: | ---: | ---: |
| `google/gemini-3.1-flash-lite` | 8/8 | 7/8 | **3.68 s** | $0.008857 | **$1.11** |
| `google/gemini-3-flash-preview` | 8/8 | 7/8 | 6.78 s | $0.018682 | $2.34 |
| `openai/gpt-6-luna` | 8/8 | 5/8 | 8.41 s | **$0.0030528** | **$0.38** |
| `google/gemini-3.8-flash` | 7/8 | 7/8 | 6.48 s | $0.02478075 | $3.10 |
| `qwen/qwen3.8-flash` | 0/1 | — | — | Unknown; only one attempt | — |

“Accepted” means the production response validator accepted the result, not that its Japanese or explanation was correct. Transcript comparison normalizes Unicode and removes whitespace, but preserves punctuation and character order. All seven accepted Gemini 3.8 transcripts matched; its rejected response is not counted as a delivered transcript.

Completion includes the full response and validation, not just the first token. The Gemini 3.8 median includes the rejected response; accepted-only median was 6.53 s. Completion ranges were 2.98–4.22 s for Flash-Lite, 5.14–14.28 s for Gemini 3 Flash, 5.94–12.26 s for Luna, and 5.59–8.99 s for Gemini 3.8. Eight observations cannot establish a general latency distribution.

Costs come from returned OpenRouter usage, including the charged Gemini 3.8 response that failed validation. The last column is a simple extrapolation from these small crops, not a quote for arbitrary pages or a cost per successful answer. Total reported charges for 32 responses were **$0.05537255**, about 5.54 US cents. The Qwen rejection did not report a charge; it is unknown, not assumed free. The runner reserved $0.00735024 as that attempt's planning allowance before continuing, separately from reported charges.

## What the answers actually got wrong

### Gemini 3.1 Flash-Lite: best speed/value, imperfect teaching help

All eight English translations preserved the central meaning, and all 25 target word readings were covered correctly. On the Kansai-dialect crop, it transcribed `買うん？` as `買ううん？`, inserting an extra `う`. It then defined the invented `うん` segment as an informal question marker. The actual construction uses `ん`, from `の`.

On `先生にもう一度説明してもらった。`, the English and main grammar explanation were correct, but word help described `に` as marking an agent in a causative or passive construction. Here it belongs to the benefactive `てもらう` construction. These two wrong definitions matter in a learning product even though target-reading scores remain high.

### Gemini 3 Flash Preview: cleaner learner help in this run

It covered all 25 target readings and the central grammar points. It made the same extra-`う` transcription error on the Kansai crop, but did not invent a word-help definition for that fragment. The blinded review found no comparable material word-definition or grammar error. One translation was mildly awkward rather than meaning-changing.

It cost about 2.1 times Flash-Lite and took about 1.8 times as long at the median. That makes it a reasonable quality alternative on this evidence, not an established universal winner.

### GPT-6 Luna: cheap, with meaning-changing OCR mistakes

Source: `この傘、姉が貸してくれたんだ。`

Luna changed `姉` (older sister) to `市` (city), omitted `んだ`, and translated the line as **“The city lent me this umbrella.”** Its word help also taught the incorrect city reading and meaning.

Source: `先生にもう一度説明してもらった。`

Luna dropped `う` from `もう`, producing `先生にも一度説明してもらった。` and **“I had the teacher explain it to me once, too.”** That changes “again / one more time” to “also / once.” It also dropped a character from `そんなん` in another crop. Its median completion was the slowest of the four models that completed the set.

Some grammar explanations were in Japanese. That is less helpful for the intended English-speaking learner, but the production prompt could specify explanation language more clearly; this is not evidence of an inherent model limitation.

### Gemini 3.8 Flash: one undeliverable answer, highest measured cost

On the umbrella crop, its Japanese omitted `ちゃんと` and wrote `返えしなよ`, while word entries still contained `ちゃんと` and `返しなよ`. Those entries did not occur in its own transcript. The production validator rejected the answer, so the reader would receive an error rather than a translation. OpenRouter reported a $0.003174 charge for that response.

On another crop, an explanation of `〜だし` overgeneralized its attachment to verbs and adjectives. Reason-listing `し` has broader use, but inserting the copula `だ` after verbs or i-adjectives is incorrect. The other seven responses passed validation with exact transcripts, including the context-dependent reading `生物 → なまもの`.

### Qwen3.8 Flash: no quality conclusion

The paid `qwen/qwen3.8-flash` endpoint returned HTTP 429 on its first attempt. It was excluded from the remainder, and the failed request was not retried. This was not the earlier `:free` model. One rejection does not establish persistent unreliability or translation quality; it only means this run cannot support recommending it.

## Method and limits

- Eight original casual-Japanese dialogue crops: six vertical, two horizontal, one with furigana and one in smaller type. They cover contractions, reported speech, participant roles, negation, Kansai dialect, an unfinished conditional and a context-dependent reading. These are synthetic speech balloons, not published manga scans. See the [input contact sheet](../benchmarks/casual-japanese/contact-sheet.png) and [source/reference cases](../benchmarks/casual-japanese/cases.json).
- The image and an empty context string were submitted through `src/background/provider.js`. Models did not receive the source transcription or reference answers. The production prompt, structured-output schema, streaming parser and response validation were used unchanged, with the 8,192-token output allowance.
- Requested reasoning: Flash-Lite `minimal`; Luna, Gemini 3 Flash and Gemini 3.8 Flash `low`; Qwen a 1,024-token budget. These are comparisons of the configurations our extension uses, not of each model's maximum possible capability.
- One attempt per model/crop, with order rotated across crops; no automatic retries or replacement of bad results. There were 33 attempts: 31 accepted, one validation rejection and one HTTP 429. Routing remained with OpenRouter. One Gemini 3 Flash answer used Google AI Studio; its other seven, and all other Gemini attempts, used Google according to returned metadata. Luna used OpenAI.
- Two assistant reviewers graded separate halves of the samples with model IDs, costs and latency hidden. The flagged mistakes were checked against the source crops before model identities were revealed. This was assistant review, not a native-speaker panel.
- The [predeclared rubric](../benchmarks/casual-japanese/README.md) includes transcription, English, target readings and central grammar. Additional wrong definitions are flagged separately. Its composite scores give Flash-Lite and Gemini 3 Flash the same total despite their different word-help errors, so the composite is not used to select a winner. Failed answers receive zero delivered-answer credit; unattempted Qwen crops are not scored.
- No handwriting, damaged scans, artwork-dependent meaning, complex multi-panel layouts, long selections or repeated trials were tested. This verifies the live provider path from Node, not installed Firefox capture, popup behavior or BookWalker compatibility.

## Reproduce and inspect

The [runner instructions](../benchmarks/casual-japanese/README.md) describe paid execution, budget checks, resume behavior and offline summarization. Credentials stay in ignored `.env`; raw responses and generation metadata stay under ignored `test-results/`.

The original raw responses and grading files are not distributed with this repository. The tables above summarize the recorded results; a new run will produce its own output files and incur its own API charges.
