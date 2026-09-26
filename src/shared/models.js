(() => {
  "use strict";
  const names = {
    "google/gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite",
    "openai/gpt-6-luna": "GPT-6 Luna",
    "qwen/qwen3.8-flash": "Qwen3.8 Flash",
    "google/gemini-3.8-flash": "Gemini 3.8 Flash",
    "google/gemini-3-flash-preview": "Gemini 3 Flash (Preview)",
    "google/gemini-3.1-pro-preview": "Gemini 3.1 Pro (Preview)",
    "anthropic/claude-opus-4.6": "Claude Opus 4.6",
    "anthropic/claude-haiku-4.5": "Claude Haiku 4.5",
    "anthropic/claude-sonnet-5": "Claude Sonnet 5",
    "deepseek/deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
    "z-ai/glm-5.3-flash": "GLM-5.3 Flash",
    "minimax/minimax-m3": "MiniMax M3",
    "mistralai/mistral-small-2603": "Mistral Small 4",
  };

  function modelName(id) {
    if (typeof id !== "string" || !id.trim()) return "Model unknown";
    if (Object.hasOwn(names, id)) return names[id];
    // Older saved results contain an ID, not the catalog's display name.
    return id
      .split("/")
      .pop()
      .split(":")
      .map((part) =>
        part
          .replace(/[-_]+/g, " ")
          .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
          .replace(/\b(gpt|ai|ocr|vl|llm)\b/gi, (word) => word.toUpperCase()),
      )
      .join(" · ");
  }

  const api = { modelName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.MangaModels = api;
})();
