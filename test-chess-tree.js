/**
 * Local smoke test for Chess Tree.
 * Run from repo root: node test-chess-tree.js
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const PORT = 8771;
const BASE_URL = "http://127.0.0.1:" + PORT + "/pages/chess_tree/index.html";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
};

function log(msg) {
  console.log("[test-chess-tree]", msg);
}

function loadPlaywright() {
  try {
    return require(path.join(root, "pages", "domainname_wizard", "source", "node_modules", "playwright"));
  } catch {
    return require("playwright");
  }
}

function createStaticServer() {
  return http.createServer((req, res) => {
    let pathname = "/";
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {}
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
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    });
  });
}

async function runE2E(url) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForSelector("#run", { timeout: 15000 });
    await page.waitForSelector("#parents-list", { timeout: 15000 });
    await page.click("#run");
    await page.waitForFunction(() => {
      const v = document.querySelector("#st-positions");
      return v && Number(v.textContent || "0") > 1;
    }, { timeout: 45000 });

    await page.fill("#search", "e4");
    await page.click("#search-btn");
    await page.waitForTimeout(500);
    await page.waitForSelector("#parents-list");

    await page.click("#export-json");
    await page.click("#import-json");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);

    if (errors.length > 0) {
      throw new Error("Console/page errors: " + errors.slice(0, 5).join(" | "));
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", resolve);
  });

  try {
    log("Running smoke test at " + BASE_URL);
    await runE2E(BASE_URL);
    log("Smoke test passed.");
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
