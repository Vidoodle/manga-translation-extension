# Broader family comparison — September 25, 2026

This follow-up broadens the original Google-heavy screening. Keep the same eight images, production prompt/schema/validator, output allowance and predeclared grading rubric. References are not submitted. Each selected model gets one attempt per crop; failures remain in the result set. Grade the new answers with model identity, latency and price hidden before opening the mapping.

| Model ID | Role | Requested reasoning |
| --- | --- | --- |
| `deepseek/deepseek-v4.1-flash` | Low-cost DeepSeek vision candidate | low |
| `anthropic/claude-haiku-4.5` | Lower-cost Claude | provider default |
| `anthropic/claude-sonnet-5` | Higher-cost Claude comparison | low |
| `z-ai/glm-5.3-flash` | Very low-cost vision candidate | low |
| `minimax/minimax-m3` | Alternative multimodal family | provider default |
| `mistralai/mistral-small-2603` | Mistral Small 4, inexpensive vision candidate | provider default |

The live OpenRouter catalog was checked before selection for image input, text output and structured outputs. It explicitly advertises low reasoning for DeepSeek V4.1 Flash, Sonnet 5 and GLM-5.3 Flash. The production reasoning profile now requests low for these models, using supported controls without manual thinking budgets. Haiku and Mistral default to no thinking according to provider documentation; MiniMax retains provider defaults because no specific effort/budget mapping was verified. Actual response usage is recorded. This is a comparison of practical reading configurations, not maximum-effort capability.

The original Gemini 3.1 Flash-Lite and Gemini 3 Flash Preview results are comparison baselines. They will not be rerun simply to improve their scores. They use the same prompt and images, but were measured earlier, so latency comparisons are descriptive rather than simultaneous controlled measurements. The new reasoning-profile identifier changes request identity, not the baseline models' outgoing reasoning settings.

The new run uses `broader-families-20260925`, a $1 tracked budget, and conservative catalog planning bounds including higher pricing overrides. Start with the first two samples, inspect request compatibility, then finish the remaining samples in bounded groups. A model is not discarded for low scores or a malformed answer. Unknown charges pause work for inspection; confirmed HTTP 429 reservations may be explicitly used without repeating failed attempts. Keep results separate from the original screening and Qwen diagnostics.

This remains a small synthetic-crop screening exercise with assistant review, not a Japanese-reader study. Report acceptance, transcription, English meaning, word-help mistakes, grammar, completion time and actual reported cost together; a low price or valid JSON alone does not earn a recommendation.

Primary references: [OpenRouter catalog](https://openrouter.ai/api/v1/models), [DeepSeek vision](https://api-docs.deepseek.com/guides/vision/), [Claude Sonnet 5 migration and thinking defaults](https://platform.claude.com/docs/en/models/sonnet-5/migration-guide), [Mistral Small 4](https://docs.mistral.ai/models/mistral-small-4-0-26-03).

Completion note: [Final results](../../docs/model-benchmark-broader-2026-09-25.md) retain 41 attempts. Mistral was left unranked after two shared-pool rate limits. DeepSeek's last answer hit the response limit with uncaptured cost, causing the runner to stop before Haiku's last case. That case and Mistral's remaining six are explicitly unattempted; no failed call was retried.
