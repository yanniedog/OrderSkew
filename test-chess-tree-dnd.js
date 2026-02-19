const path = require("path");

function loadPlaywright() {
  try {
    return require(path.join(__dirname, "pages", "domainname_wizard", "source", "node_modules", "playwright"));
  } catch {
    return require("playwright");
  }
}

async function readBoardMetrics(page) {
  return page.evaluate(() => {
    const board = document.querySelector("#board");
    const squares = Array.from(document.querySelectorAll("#board .board-square"));
    const first = squares[0];
    const box = board ? board.getBoundingClientRect() : null;
    const firstBox = first ? first.getBoundingClientRect() : null;
    return {
      board: box
        ? { width: Number(box.width.toFixed(2)), height: Number(box.height.toFixed(2)) }
        : null,
      first: firstBox
        ? { width: Number(firstBox.width.toFixed(2)), height: Number(firstBox.height.toFixed(2)) }
        : null,
      squareCount: squares.length
    };
  });
}

function closeEnough(a, b, tolerance = 1.25) {
  return Math.abs(a - b) <= tolerance;
}

async function waitForStartData(page) {
  await page.waitForSelector("#run", { timeout: 20000 });
  await page.click("#run");
  await page.waitForFunction(() => {
    const v = document.querySelector("#st-positions");
    return v && Number(v.textContent || "0") > 1;
  }, { timeout: 60000 });
}

async function dragPiece(page, fromSquare, toSquare) {
  const from = `#board .board-square[data-square='${fromSquare}'] .board-piece`;
  const to = `#board .board-square[data-square='${toSquare}']`;
  await page.waitForSelector(from, { timeout: 15000 });
  await page.waitForSelector(to, { timeout: 15000 });
  await page.dragAndDrop(from, to);
}

async function run(url) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const jsErrors = [];

  page.on("pageerror", (err) => jsErrors.push(String(err)));

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    const before = await readBoardMetrics(page);
    if (!before.board || before.squareCount !== 64) {
      throw new Error("Board did not initialize to 64 squares.");
    }

    await waitForStartData(page);

    const afterStart = await readBoardMetrics(page);
    if (!afterStart.board || !afterStart.first) {
      throw new Error("Board metrics unavailable after Start.");
    }

    if (!closeEnough(before.board.width, before.board.height)) {
      throw new Error(`Board not square before start: ${before.board.width}x${before.board.height}`);
    }

    if (!closeEnough(afterStart.board.width, afterStart.board.height)) {
      throw new Error(`Board not square after start: ${afterStart.board.width}x${afterStart.board.height}`);
    }

    if (!closeEnough(afterStart.first.width, afterStart.first.height)) {
      throw new Error(`Square not square after start: ${afterStart.first.width}x${afterStart.first.height}`);
    }

    // Select root to ensure initial start position is shown, then drag a2->a3.
    await page.click("text=ROOT");
    await dragPiece(page, "a2", "a3");

    const afterDrag = await readBoardMetrics(page);
    if (!closeEnough(afterDrag.board.width, afterDrag.board.height)) {
      throw new Error(`Board not square after drag: ${afterDrag.board.width}x${afterDrag.board.height}`);
    }
    if (!closeEnough(afterDrag.first.width, afterDrag.first.height)) {
      throw new Error(`Square not square after drag: ${afterDrag.first.width}x${afterDrag.first.height}`);
    }

    const fenValue = await page.inputValue("#seed-fen");
    if (!fenValue || !fenValue.includes("/")) {
      throw new Error("Seed FEN was not updated after drag.");
    }

    if (jsErrors.length > 0) {
      throw new Error("Page errors: " + jsErrors.slice(0, 3).join(" | "));
    }

    console.log("[test-chess-tree-dnd] pass", { before, afterStart, afterDrag, fenValue });
  } finally {
    await browser.close();
  }
}

const url = process.argv[2] || "https://www.orderskew.com/pages/chess_tree/index.html";
run(url).catch((err) => {
  console.error("[test-chess-tree-dnd]", err);
  process.exit(1);
});
