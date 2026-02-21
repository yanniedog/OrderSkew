/**
 * Full automated test for domainname_wizard: unit tests + static server + E2E.
 * Run from repo root: node test-domainname-wizard.js
 * Exits 0 only if all steps pass. Aborts on first failure.
 */

const { spawnSync, spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const sourceDir = path.join(root, "pages", "domainname_wizard", "source");
const PORT = 8765;
function getBaseUrl(port) {
  return "http://127.0.0.1:" + port + "/pages/domainname_wizard/";
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".ico": "image/x-icon",
};

function log(msg) {
  console.log("[test-domainname-wizard]", msg);
}

function runUnitTests() {
  log("Running unit tests (vitest) in source...");
  const vitestMjs = path.join(sourceDir, "node_modules", "vitest", "vitest.mjs");
  const result = spawnSync(process.execPath, [vitestMjs, "run"], {
    cwd: sourceDir,
    stdio: "inherit",
    shell: false,
    timeout: 120000,
  });
  if (result.status !== 0) {
    log("Unit tests FAILED (exit " + (result.status != null ? result.status : "signal") + ")");
    process.exit(result.status != null ? result.status : 1);
  }
  log("Unit tests OK");
}

function createStaticServer() {
  return http.createServer((req, res) => {
    let pathname = "";
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
      pathname = "/";
    }
    if (pathname === "/") pathname = "/pages/index.html";
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

function runE2E(name, script, timeoutMs, baseUrl) {
  return new Promise((resolve) => {
    log("Running E2E: " + name + " against " + baseUrl);
    const child = spawn(
      process.execPath,
      [path.join(sourceDir, script), baseUrl],
      { cwd: sourceDir, stdio: "inherit", shell: false, timeout: timeoutMs || 60000 }
    );
    child.on("close", (code, signal) => {
      if (code === 0) {
        log("E2E " + name + " OK");
        resolve(0);
      } else {
        log("E2E " + name + " FAILED (exit " + (code != null ? code : signal) + ")");
        resolve(code || 1);
      }
    });
    child.on("error", (err) => {
      log("E2E spawn error: " + err.message);
      resolve(1);
    });
  });
}

function main() {
  runUnitTests();

  const server = createStaticServer();
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    const baseUrl = getBaseUrl(port);
    log("Static server listening on " + baseUrl);
    runE2E("job start", "e2e-static-wizard.js", 60000, baseUrl).then((code) => {
      server.close();
      process.exit(code);
    });
  });
  server.on("error", (err) => {
    log("Server error: " + err.message);
    process.exit(1);
  });
}

main();
