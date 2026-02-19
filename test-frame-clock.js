/**
 * Verifies the page frame clock (local time, UTC on hover).
 * Run from repo root: node test-frame-clock.js
 * Requires: npm install and npx playwright install chromium in pages/domainname_wizard/source/
 * Exits 0 on success.
 */

const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const sourceDir = path.join(root, "pages", "domainname_wizard", "source");
const PORT = 8766;
const BASE_URL = "http://127.0.0.1:" + PORT + "/";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
};

function log(msg) {
  console.log("[test-frame-clock]", msg);
}

function createStaticServer() {
  return http.createServer((req, res) => {
    let pathname = "";
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
      pathname = "/";
    }
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.resolve(path.join(root, pathname.replace(/^\//, "").replace(/\/+/g, path.sep)));
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      const ext = path.extname(filePath);
      const contentType = MIME[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      fs.createReadStream(filePath).pipe(res);
    });
  });
}

const server = createStaticServer();
server.listen(PORT, "127.0.0.1", () => {
  log("Server at " + BASE_URL);
  const child = spawn(
    process.execPath,
    [path.join(sourceDir, "e2e-frame-clock.js"), BASE_URL, "pages/index.html"],
    { cwd: sourceDir, stdio: "inherit", shell: false, timeout: 25000 }
  );
  child.on("close", (code, signal) => {
    server.close();
    process.exit(code !== 0 ? (code != null ? code : 1) : 0);
  });
  child.on("error", (err) => {
    log("Spawn error: " + err.message);
    server.close();
    process.exit(1);
  });
});
server.on("error", (err) => {
  log("Server error: " + err.message);
  process.exit(1);
});
