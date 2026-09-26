(function (root) {
  "use strict";
  const modelNames =
    root.MangaModels ||
    (typeof module !== "undefined" && module.exports ? require("../shared/models.js") : null);
  // Reviewed 2026-09-25 against https://openrouter.ai/models for image/schema support and cost.
  // Ordered from the main learning recommendation to the faster, cheaper alternative.
  // See docs/model-benchmark-broader-2026-09-25.md; the live catalog supplies prices.
  const RECOMMENDATIONS = [
    {
      id: "google/gemini-3-flash-preview",
      name: "Gemini 3 Flash",
      badge: "Recommended",
      description: "For translations, word meanings and grammar.",
      preview: true,
    },
    {
      id: "google/gemini-3.1-flash-lite",
      name: "Gemini 3.1 Flash-Lite",
      badge: "Faster & cheaper",
      description: "Shorter waits and lower cost, with less reliable word explanations.",
    },
  ];
  function money(value, digits = 4) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? `$${value.toLocaleString("en-US", { maximumFractionDigits: digits })}`
      : "unknown";
  }

  function models(catalog) {
    return Array.isArray(catalog?.models)
      ? catalog.models
          .filter((model) => model && typeof model.id === "string")
          .map((model) => ({ ...model, name: String(model.name || model.id) }))
      : [];
  }

  function modelChoices(catalog, query = "") {
    query = query.trim().toLowerCase();
    const filtered = catalog.models.filter((model) =>
      `${model.name} ${model.id}`.toLowerCase().includes(query),
    );
    filtered.sort(
      (a, b) =>
        (a.prompt_per_million ?? Infinity) - (b.prompt_per_million ?? Infinity) ||
        a.name.localeCompare(b.name),
    );
    return filtered;
  }

  function recommended(catalog) {
    return RECOMMENDATIONS.flatMap((suggestion) => {
      const model = catalog.models.find((item) => item.id === suggestion.id);
      return model ? [{ ...model, ...suggestion }] : [];
    });
  }

  function rates(model) {
    return `${money(model.prompt_per_million)} input · ${money(model.completion_per_million)} output / 1M tokens`;
  }

  function modelName(id) {
    return modelNames.modelName(id);
  }

  function price(catalog, selected) {
    if (!selected) return "Choose a model before requesting a new translation.";
    const model = catalog.models.find((item) => item.id === selected);
    return model
      ? `${rates(model)}${catalog.source === "cached" ? " · saved rates" : ""}`
      : "Saved model retained. Current pricing and availability could not be verified.";
  }

  function catalogStatus(catalog) {
    return [
      catalog.source === "cached"
        ? "Showing a saved model list. Prices and availability may have changed."
        : "",
      catalog.warning || "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function stats(value) {
    const bytes =
      typeof value?.bytes === "number" && Number.isFinite(value.bytes) && value.bytes >= 0
        ? value.bytes
        : null;
    const size =
      bytes === null
        ? "size unknown"
        : bytes >= 1048576
          ? `${(bytes / 1048576).toFixed(1)} MB`
          : `${Math.ceil(bytes / 1024)} KB`;
    return `${value?.entries ?? "?"} saved translations · ${value?.pages ?? "?"} saved pages · ${size}${value?.unresolved ? ` · ${value.unresolved} unfinished request(s) kept when clearing` : ""}`;
  }
  const api = {
    money,
    models,
    modelChoices,
    recommended,
    rates,
    modelName,
    price,
    catalogStatus,
    stats,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MangaPopupFormat = api;
})(globalThis);
