// Test-only HTTP fixture. Serves an explicit allowlist; never serves keys or runtime data.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const workspace = path.resolve(__dirname, "..");
const extension = path.join(workspace, "src");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json",
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const pathname = url.pathname;
  try {
    if (req.method === "POST" && pathname === "/report") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2000000) throw new Error("Report too large");
      }
      const result = JSON.parse(body);
      const reportDirectory = path.join(workspace, "test-results");
      await fs.mkdir(reportDirectory, { recursive: true });
      await fs.writeFile(
        path.join(reportDirectory, "browser-report.json"),
        JSON.stringify(result, null, 2),
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    if (pathname === "/popup" || pathname === "/reader-popup") {
      const popup = await fs.readFile(path.join(extension, "popup/popup.html"), "utf8");
      const runtime = pathname === "/reader-popup" ? "reader-popup-runtime.js" : "popup-runtime.js";
      const theme = url.searchParams.get("theme");
      const themePreview = ["light", "dark"].includes(theme)
        ? `<style>:root { color-scheme: ${theme} !important; }</style>`
        : "";
      const fixture = popup.replace(
        "<head>",
        `<head>\n    <base href="/src/popup/" />\n    ${themePreview}\n    <script src="/${runtime}"></script>`,
      );
      res.writeHead(200, { "Content-Type": types[".html"], "Cache-Control": "no-store" });
      res.end(fixture);
      return;
    }
    const localRoutes = {
      "/idb": "idb.html",
      "/reader": "reader.html",
      "/fixture-runtime.js": "fixture-runtime.js",
      "/popup-runtime.js": "popup-runtime.js",
      "/reader-popup-runtime.js": "reader-popup-runtime.js",
    };
    let file;
    if (localRoutes[pathname]) file = path.join(workspace, "tests/browser", localRoutes[pathname]);
    else if (
      /^\/src\/(background|reader|popup|shared)\/[a-z0-9.-]+\.(js|css|html|json)$/.test(pathname) ||
      /^\/src\/icons\/(icon|toolbar-dark|toolbar-light)-(16|32|48|64|96|128)\.png$/.test(pathname)
    )
      file = path.join(extension, pathname.slice(5));
    else {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const data = await fs.readFile(file);
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "text/plain",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(error.message);
  }
});
server.listen(17843, "127.0.0.1", () =>
  console.log("Extension test fixture: http://127.0.0.1:17843/idb"),
);
