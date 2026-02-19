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

async function assertSquareBoard(page, label) {
  const metrics = await readBoardMetrics(page);
  if (!metrics.board || metrics.squareCount !== 64) throw new Error(`${label}: board invalid`);
  if (!closeEnough(metrics.board.width, metrics.board.height)) throw new Error(`${label}: board not square`);
  if (!closeEnough(metrics.first.width, metrics.first.height)) throw new Error(`${label}: square not square`);
  return metrics;
}

async function countSvgPieces(page) {
  return page.evaluate(() => {
    const pieces = Array.from(document.querySelectorAll("#board .board-piece"));
    return {
      count: pieces.length,
      allImages: pieces.every((el) => el.tagName === "IMG"),
      allSvgAssets: pieces.every((el) => (el.getAttribute("src") || "").includes("assets/pieces/"))
    };
  });
}

async function runDesktopFlow(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60000 });

  const before = await assertSquareBoard(page, "before-start");
  const pieceState = await countSvgPieces(page);
  if (pieceState.count !== 32 || !pieceState.allImages || !pieceState.allSvgAssets) {
    throw new Error("Pieces are not rendered as SVG image assets.");
  }

  await page.click("#run");
  await page.waitForFunction(() => {
    const v = document.querySelector("#st-positions");
    return v && Number(v.textContent || "0") > 1;
  }, { timeout: 60000 });

  const afterStart = await assertSquareBoard(page, "after-start");

  await page.click("text=ROOT");
  await page.click("#board .board-square[data-square='e2']");
  await page.click("#board .board-square[data-square='e4']");

  const fenAfterClick = await page.inputValue("#seed-fen");
  if (!fenAfterClick.startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b")) {
    throw new Error("Legal click-to-move did not update seed FEN as expected.");
  }

  await page.click("#board .board-square[data-square='e4']");
  await page.click("#board .board-square[data-square='e6']");
  const fenAfterIllegal = await page.inputValue("#seed-fen");
  if (fenAfterIllegal !== fenAfterClick) {
    throw new Error("Illegal move changed the position.");
  }

  await page.dragAndDrop(
    "#board .board-square[data-square='c7'] .board-piece",
    "#board .board-square[data-square='c5']"
  );

  const fenAfterDrag = await page.inputValue("#seed-fen");
  if (fenAfterDrag === fenAfterClick || !fenAfterDrag.includes("2p5")) {
    throw new Error("Legal drag move did not apply.");
  }

  const afterDrag = await assertSquareBoard(page, "after-drag");
  return { before, afterStart, afterDrag, fenAfterClick, fenAfterDrag };
}

async function runTouchFlow(browserType) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true
  });
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.tap("#board .board-square[data-square='g1']");
    await page.tap("#board .board-square[data-square='f3']");

    const fen = await page.inputValue("#seed-fen");
    if (!fen.startsWith("rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b")) {
      throw new Error("Touch tap move did not apply legal move.");
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const { chromium } = loadPlaywright();
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", resolve);
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });

  try {
    const desktop = await runDesktopFlow(page);
    await browser.close();
    await runTouchFlow(chromium);
    console.log("[test-chess-tree-dnd-local] pass", desktop);
  } finally {
    if (browser.isConnected()) await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error("[test-chess-tree-dnd-local]", err);
  process.exit(1);
});
