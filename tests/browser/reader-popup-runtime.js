/* Test-only popup adapter for the real background running in the reader fixture. */
(() => {
  "use strict";
  if (parent === window || parent.location.origin !== location.origin || !parent.fixture)
    throw new Error("Use Open extension popup in the local reader fixture.");
  const fixture = parent.fixture;
  globalThis.browser = {
    runtime: {
      getURL: fixture.api.runtime.getURL,
      sendMessage(message) {
        const { type, ...payload } = message;
        if (typeof type !== "string" || !type.startsWith("manga:"))
          throw new Error("Unknown popup fixture message.");
        return fixture.popup(type.slice("manga:".length), payload);
      },
    },
    tabs: {
      query() {
        throw new Error("The configuration popup must not access reading tabs.");
      },
    },
    permissions: fixture.api.permissions,
  };
  window.close = () => {
    throw new Error("The configuration popup must not close itself to launch reading UI.");
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, options) => {
    if (new URL(url, location.href).origin !== location.origin)
      throw new Error("External requests are disabled in the popup fixture.");
    return realFetch(url, options);
  };
})();
