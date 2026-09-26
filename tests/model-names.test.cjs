"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { modelName } = require("../src/shared/models.js");

test("saved model IDs have readable names without needing a catalog request", () => {
  assert.equal(modelName("google/gemini-3.1-flash-lite"), "Gemini 3.1 Flash-Lite");
  assert.equal(modelName("openai/gpt-6-luna"), "GPT-6 Luna");
  assert.equal(modelName("qwen/qwen3.8-flash"), "Qwen3.8 Flash");
  assert.equal(modelName("google/gemini-3.8-flash"), "Gemini 3.8 Flash");
  assert.equal(modelName("google/gemini-3-flash-preview"), "Gemini 3 Flash (Preview)");
  assert.equal(modelName("google/gemini-3.1-pro-preview"), "Gemini 3.1 Pro (Preview)");
  assert.equal(modelName("anthropic/claude-opus-4.6"), "Claude Opus 4.6");
  assert.equal(modelName("openai/gpt-5.6-sol"), "GPT 5.6 Sol");
  assert.equal(modelName("vendor/vision_model-2:free"), "Vision Model 2 · Free");
  assert.equal(modelName(""), "Model unknown");
  assert.equal(modelName(undefined), "Model unknown");
});
