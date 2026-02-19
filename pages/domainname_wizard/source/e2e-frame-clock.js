/**
 * E2E check that the OrderSkew page frame shows the footer with latest-commit stamp.
 * Usage: node e2e-frame-clock.js <baseUrl>
 * Example: node e2e-frame-clock.js http://127.0.0.1:8766/
 * Exits 0 on success, 1 on failure.
 */

const baseUrl = (process.argv[2] || "http://127.0.0.1:8766/").replace(/\/$/, "");
const pagePath = process.argv[3] || "pages/index.html";

async function main() {
  const { chromium } = require("playwright");
  const url = baseUrl + "/" + pagePath.replace(/^\//, "");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const log = (msg) => console.error("[e2e-frame-clock]", msg);

  try {
    log("Loading " + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

    const commitEl = page.locator("#os-frame-commit");
    await commitEl.waitFor({ state: "visible", timeout: 5000 });

    const text = (await commitEl.textContent()) || "";

    if (!/latest commit/i.test(text)) {
      log("FAIL: #os-frame-commit should contain 'latest commit', got: " + JSON.stringify(text));
      await browser.close();
      process.exit(1);
    }

    log("OK: footer commit stamp present: " + text.trim().slice(0, 60) + (text.length > 60 ? "..." : ""));
    await browser.close();
    process.exit(0);
  } catch (err) {
    log("FAIL: " + (err && err.message));
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
