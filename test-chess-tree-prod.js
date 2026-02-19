/**
 * Production smoke test for Chess Tree.
 * Run from repo root: node test-chess-tree-prod.js
 */

const path = require("path");

function loadPlaywright() {
  try {
    return require(path.join(__dirname, "pages", "domainname_wizard", "source", "node_modules", "playwright"));
  } catch {
    return require("playwright");
  }
}

async function main() {
  const baseUrl = process.argv[2] || "https://www.orderskew.com/pages/chess_tree/index.html";
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const errors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector("#run", { timeout: 20000 });
    await page.click("#run");
    await page.waitForFunction(() => {
      const v = document.querySelector("#st-positions");
      return v && Number(v.textContent || "0") > 1;
    }, { timeout: 60000 });

    await page.fill("#search", "e4");
    await page.click("#search-btn");
    await page.waitForTimeout(1000);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1200);

    if (errors.length > 0) {
      throw new Error("Console/page errors: " + errors.slice(0, 5).join(" | "));
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[test-chess-tree-prod]", err);
  process.exit(1);
});
