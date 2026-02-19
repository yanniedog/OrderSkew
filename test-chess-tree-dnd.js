const path = require("path");

function loadPlaywright() {
  try {
    return require(path.join(__dirname, "pages", "domainname_wizard", "source", "node_modules", "playwright"));
  } catch {
    return require("playwright");
  }
}

function closeEnough(a, b, tolerance = 1.25) {
  return Math.abs(a - b) <= tolerance;
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

async function assertBoard(page, label) {
  const metrics = await readBoardMetrics(page);
  if (!metrics.board || metrics.squareCount !== 64) throw new Error(`${label}: board not initialized`);
  if (!closeEnough(metrics.board.width, metrics.board.height)) throw new Error(`${label}: board not square`);
  if (!closeEnough(metrics.first.width, metrics.first.height)) throw new Error(`${label}: square not square`);
  return metrics;
}

async function run(url) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const errors = [];

  page.on("pageerror", (err) => errors.push(String(err)));

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

    const before = await assertBoard(page, "before-start");
    const svgState = await page.evaluate(() => {
      const pieces = Array.from(document.querySelectorAll("#board .board-piece"));
      return {
        count: pieces.length,
        allImages: pieces.every((el) => el.tagName === "IMG"),
        allSvgAssets: pieces.every((el) => (el.getAttribute("src") || "").includes("assets/pieces/"))
      };
    });

    if (svgState.count !== 32 || !svgState.allImages || !svgState.allSvgAssets) {
      throw new Error("Production board is not rendering SVG chess pieces.");
    }

    await page.click("#run");
    await page.waitForFunction(() => {
      const v = document.querySelector("#st-positions");
      return v && Number(v.textContent || "0") > 1;
    }, { timeout: 60000 });

    const afterStart = await assertBoard(page, "after-start");

    await page.click("text=ROOT");
    await page.click("#board .board-square[data-square='e2']");
    await page.click("#board .board-square[data-square='e4']");
    const fenAfterMove = await page.inputValue("#seed-fen");
    if (!fenAfterMove.startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b")) {
      throw new Error("Production click-to-move legal move failed.");
    }

    const afterMove = await assertBoard(page, "after-move");

    if (errors.length > 0) {
      throw new Error("Page errors: " + errors.slice(0, 3).join(" | "));
    }

    console.log("[test-chess-tree-dnd] pass", { before, afterStart, afterMove, fenAfterMove });
  } finally {
    await browser.close();
  }
}

const url = process.argv[2] || "https://www.orderskew.com/pages/chess_tree/index.html";
run(url).catch((err) => {
  console.error("[test-chess-tree-dnd]", err);
  process.exit(1);
});
