const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const PORT = 8773;
const BASE_URL = "http://127.0.0.1:" + PORT + "/pages/chess_tree/index.html";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json"
};

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

async function readBoardMetrics(page) {
  return page.evaluate(() => {
    const board = document.querySelector("#board");
    const squares = Array.from(document.querySelectorAll("#board .board-square"));
    const first = squares[0];
    const box = board ? board.getBoundingClientRect() : null;
    const firstBox = first ? first.getBoundingClientRect() : null;
    return {
      board: box ? { width: Number(box.width.toFixed(2)), height: Number(box.height.toFixed(2)) } : null,
      first: firstBox ? { width: Number(firstBox.width.toFixed(2)), height: Number(firstBox.height.toFixed(2)) } : null,
      squareCount: squares.length
    };
  });
}

function closeEnough(a, b, tolerance = 1.25) {
  return Math.abs(a - b) <= tolerance;
}

async function runE2E(url) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

    const before = await readBoardMetrics(page);
    if (!before.board || before.squareCount !== 64) throw new Error("Board did not initialize to 64 squares.");

    await page.click("#run");
    await page.waitForFunction(() => {
      const v = document.querySelector("#st-positions");
      return v && Number(v.textContent || "0") > 1;
    }, { timeout: 60000 });

    const afterStart = await readBoardMetrics(page);
    if (!closeEnough(afterStart.board.width, afterStart.board.height)) {
      throw new Error(`Board not square after start: ${afterStart.board.width}x${afterStart.board.height}`);
    }
    if (!closeEnough(afterStart.first.width, afterStart.first.height)) {
      throw new Error(`Square not square after start: ${afterStart.first.width}x${afterStart.first.height}`);
    }

    await page.click("text=ROOT");
    await page.waitForSelector("#board .board-square[data-square='a2'] .board-piece", { timeout: 20000 });
    await page.dragAndDrop("#board .board-square[data-square='a2'] .board-piece", "#board .board-square[data-square='a3']");

    const afterDrag = await readBoardMetrics(page);
    if (!closeEnough(afterDrag.board.width, afterDrag.board.height)) {
      throw new Error(`Board not square after drag: ${afterDrag.board.width}x${afterDrag.board.height}`);
    }
    if (!closeEnough(afterDrag.first.width, afterDrag.first.height)) {
      throw new Error(`Square not square after drag: ${afterDrag.first.width}x${afterDrag.first.height}`);
    }

    const fen = await page.inputValue("#seed-fen");
    if (!fen.includes("/")) throw new Error("Seed FEN not updated after drag.");

    console.log("[test-chess-tree-dnd-local] pass", { before, afterStart, afterDrag, fen });
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
    await runE2E(BASE_URL);
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error("[test-chess-tree-dnd-local]", err);
  process.exit(1);
});
