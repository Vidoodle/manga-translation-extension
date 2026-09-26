# Broader model screening: DeepSeek, Claude and other families

Measured September 25, 2026, using the extension's production request, image input, response schema and validator. This adds 41 live OpenRouter attempts to the [earlier comparison](model-benchmark-2026-09-25.md). It reuses the earlier Gemini 3.1 Flash-Lite and Gemini 3 Flash Preview measurements as baselines.

**Recommendation: keep Flash-Lite as the inexpensive everyday suggestion and Gemini 3 Flash Preview for learner help. Claude Sonnet 5 is the strongest non-Gemini alternative in this sample, especially for transcription, but costs about 3.2 times Gemini 3 Flash and still made a word-help error.** The broader evidence supports keeping the two current suggestions; other compatible models remain selectable through All models.

DeepSeek's accepted answers were accurate, but its long waits and final response-limit failure undermine interactive use. GLM and MiniMax are cheaper but made material teaching errors. Haiku performed poorly on these vertical crops. Mistral remains unranked because no answer was received. These are provisional conclusions about this task and configuration, not general rankings of the model families.

## Measured results

| Model | Accepted / attempted | Exact transcripts / attempted | Median completion | Reported charges | Projected cost / 1,000 similar attempts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Gemini 3.1 Flash-Lite, earlier baseline | 8/8 | 7/8 | 3.68 s | $0.008857 | $1.11 |
| Gemini 3 Flash Preview, earlier baseline | 8/8 | 7/8 | 6.78 s | $0.018682 | $2.34 |
| DeepSeek V4.1 Flash | 7/8 | 6/8 | 46.84 s | $0.015473 + one unknown charge | Unknown |
| Claude Haiku 4.5 | 5/7 | 0/7 | 5.38 s | $0.024320 | $3.47 |
| Claude Sonnet 5 | 8/8 | 8/8 | 6.61 s | $0.059930 | $7.49 |
| GLM-5.3 Flash | 8/8 | 6/8 | 4.98 s | $0.002446 | $0.31 |
| MiniMax M3 | 7/8 | 4/8 | 5.98 s | $0.004861 | $0.61 |
| Mistral Small 4 | 0/2 | — | — | Two unknown charges | Unknown |

Accepted means usable by the extension's validator, not linguistically correct. Exact transcription normalizes Unicode and whitespace but retains punctuation and utterance order. The denominator includes rejected attempts. In particular, Haiku's zero exact transcripts reflects reordered or altered text, not an assertion that it recognized no Japanese.

Completion measures the full response and validation. Failed attempts remain included: DeepSeek's final response was rejected after 95.05 seconds; its seven accepted responses had a 43.34-second median. MiniMax's accepted-only median was 6.18 seconds. Other models' accepted-only medians equal the displayed medians. These tiny samples and varying provider routes do not establish general latency distributions.

The cost projection divides reported cost by attempted calls, including charged validation failures, and multiplies by 1,000. It is not a cost per successful answer or a quote for larger pages. The earlier Gemini measurements occurred at a different time. We made no new baseline calls simply to obtain better scores.

## What matters in the answers

| Model | English | Target readings | Grammar | Main finding |
| --- | ---: | ---: | ---: | --- |
| Flash-Lite, earlier baseline | 39/40 | 25/25 | 16/16 | Two material word-help mistakes despite these high target scores |
| Gemini 3 Flash, earlier baseline | 39/40 | 25/25 | 16/16 | One extra OCR character; no comparable material teaching error found |
| DeepSeek V4.1 Flash | 35/40 | 21/25 | 12/16 | All seven delivered English answers accurate; one omitted grammar section; final crop failed |
| Claude Haiku 4.5 | 15/35 | 15/21 | 2/14 | Reordered dialogue, reversed participant roles, invented grammar and two rejected answers |
| Claude Sonnet 5 | 38/40 | 25/25 | 15/16 | Exact transcription throughout; one malformed word/grammar explanation |
| GLM-5.3 Flash | 37/40 | 23/25 | 13/16 | Fluent English conceals meaning-changing Japanese and invented word help |
| MiniMax M3 | 29/40 | 20/25 | 11/16 | Invalid word divisions, wrong readings and invented grammar; one rejected answer |

These are delivered-answer totals, including rejection zeros. Haiku's unattempted final case is excluded. Mistral has no linguistic result to rank. The grammar column is the unscaled 0–2-per-case rubric. Target readings cover selected kana, not the correctness of every definition; the error examples below are essential to interpreting the scores.

### Sonnet: strongest alternative, with a learning-help caveat

Sonnet preserved every source transcript exactly, including the dialect crop that both Gemini baselines slightly mistranscribed. All 25 reading targets were covered; English meaning was preserved throughout, with two mildly awkward formulations.

However, on `終わってないって`, it split the words into `終わってな` and `いって`, defining the latter as “saying.” The `い` actually belongs to negative `ない`, followed by emphatic/quotative `って`. It also labeled the negative grammar pattern `〜てな〜`, omitting the final `い`. This matters for hoverable Japanese even though the combined kana and overall English are correct. Sonnet is a credible alternative, but the extra spend did not establish uniformly better learner help than Gemini 3 Flash.

### DeepSeek: good delivered language, poor interaction speed

All seven delivered translations earned full English credit, all their target readings were correct, and review found no comparable material teaching error. It expanded `じゃ` to `じゃあ` on one transcript and returned an empty grammar array for the umbrella dialogue, despite useful grammar being present.

Its accepted responses took 18.54–65.81 seconds, followed by the 95.05-second failed final crop. The first answer reported 3,949 reasoning tokens out of 4,346 completion tokens even with low reasoning requested. We cannot attribute the final failure to a specific reasoning-token count because that usage was lost. Cheap advertised tokens did not translate into consistently cheap, responsive interaction in this run.

### GLM: inexpensive, with misleading Japanese help

GLM's English was generally good and every response passed structural validation. However, it changed `返しなよ` (“return it”) into `返すなよ` (“don't return it”), while translating the line into the correct positive English instruction. Its hover explanation then failed to explain the prohibition in its own mistranscribed Japanese.

On the Kansai crop it merged `やろ。うち` into `やろうちゃ`, then invented a conditional derivation for that fragment. It also supplied `来られない` as its own reading rather than kana `こられない`, and guessed a male referent in an ambiguous line. This is unsuitable evidence for recommending GLM as a Japanese learning aid, despite its attractive measured price.

### Haiku and MiniMax: substantial errors in this configuration

Haiku repeatedly reversed the order of vertical dialogue. On `先生にもう一度説明してもらった。` (“I had the teacher explain it to me again”), it produced “Even if I explain it to the teacher again,” reversing the participants and turning a completed event into a hypothetical fragment. Its grammar then explained the invented construction. Two other answers failed the vocabulary/transcript consistency check.

MiniMax split `もらった` into an additive-particle `も` and invented `らった`, and changed `嫌い`/`きらい` to `嫌`/`いや`. On the final crop it moved the question mark and rendered “Can we keep the sashimi until tomorrow?” as an assertion that it could be left out. Its explanation invented an aggressive/masculine derivation for ordinary `食べちゃおう`. One answer was rejected for an unmatched vocabulary surface. Neither model earns a recommendation from these observations.

## Failures and stopping conditions

The new run completed **41 attempts: 35 accepted, four response-validation failures, and two HTTP 429 responses**. No failed request was retried.

- Haiku returned vocabulary surfaces absent from its transcript on cases 05 and 06, so both answers were rejected.
- MiniMax had the same validation failure on case 01.
- DeepSeek's case 08 ended at the response limit under the production 8,192-token allowance. No partial answer was delivered. The benchmark observer also rejected the stream before retaining its usage metadata, so that charge is unknown. This is a limitation of the measurement, not evidence of a free request or of exactly how the output budget was consumed.
- Mistral hit shared-provider rate limits on both pilot crops. Its remaining six cases were not attempted, and its translation quality is unranked.
- The runner stopped on DeepSeek's unknown charge, leaving Haiku's final case 08 unattempted. Its quality denominators therefore cover seven cases. No new run was used to bypass that budget stop.

Known charges for this broader run total **$0.1070289408**, about 10.70 US cents, plus three unknown charges. The two Mistral failures had a combined $0.0128304 planning reservation; that reservation is not an observed bill. DeepSeek's last request also had a $0.0128304 planning bound, but its unknown charge blocked further paid work. The run used a $1 tracked budget, not an account spending cap.

## Method and scope

The [comparison plan](../benchmarks/casual-japanese/broader-screening.md) was written before paid requests. All candidates advertise image input and structured output in the [OpenRouter catalog](https://openrouter.ai/api/v1/models). DeepSeek V4.1 Flash supports [vision input](https://api-docs.deepseek.com/guides/vision/); this is a different candidate from older text-only DeepSeek models. The Claude comparison uses the economical Haiku 4.5 and current Sonnet 5, whose [documented reasoning controls](https://platform.claude.com/docs/en/models/sonnet-5/migration-guide) differ from earlier Sonnet versions.

Exact IDs and requested reasoning:

| Model ID | Reasoning |
| --- | --- |
| `deepseek/deepseek-v4.1-flash` | low |
| `anthropic/claude-haiku-4.5` | provider default |
| `anthropic/claude-sonnet-5` | low |
| `z-ai/glm-5.3-flash` | low |
| `minimax/minimax-m3` | provider default |
| `mistralai/mistral-small-2603` | provider default |

The prompt, schema, output allowance and validation are shared across candidates; model-specific supported reasoning settings remain explicit. The earlier Gemini baselines use the same outgoing settings as before. The updated reasoning-profile identifier changes request identity, not their API payload. Provider routing was not pinned: observed routes included Together and DeepInfra for DeepSeek, Amazon Bedrock for Haiku, Claude Platform on AWS for Sonnet, Together/Wafer/Parasail for GLM, and CoreWeave for MiniMax.

The eight [original crop fixtures](../benchmarks/casual-japanese/contact-sheet.png) test contractions, reported speech, participant roles, negation, dialect, unfinished sentences and contextual readings. They are clean synthetic balloons, not published manga scans. They do not test artwork context, handwriting, scan damage or complex layouts. References were withheld from the models. English, target readings and grammar were assistant-reviewed with accepted-answer identities and prices hidden; no independent native-speaker study was conducted.

Rejected answers receive zero delivered-answer credit; unattempted cases remain unscored. Correct target kana can coexist with incorrect word divisions and definitions. Correct English can coexist with a meaning-reversing Japanese transcript. Those errors matter more than small changes in composite scores.

## Local evidence

Run: `broader-families-20260925`. The ignored local [metrics](../test-results/model-benchmark/broader-families-20260925/metrics.json), [first-half grades](../test-results/model-benchmark/broader-families-20260925/review-first-half-grades.json), and [second-half grades](../test-results/model-benchmark/broader-families-20260925/review-second-half-grades.json) preserve the measurements and review. `events.jsonl` contains every attempt, including failures; it was not rewritten to replace unsuccessful answers. These evidence files are local and will not exist in a fresh checkout.

After this run, the offline benchmark observer was fixed to retain reported billing metadata on complete streams ending in rejection, including response limits and malformed JSON. Production validation still rejects them, and no automatic retry was added. That correction cannot recover the already-lost DeepSeek charge. Resume guards also reject changed references, changed attempted requests, and expanded cohorts that could reassign anonymous grading labels.

This exercises the production provider from Node. It does not establish installed Firefox/BookWalker compatibility.
