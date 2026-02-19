/**
 * E2E: verify Domain Name Wizard on production (or given URL) shows Curated Coverage in results.
 * Usage: node e2e-production-curated-coverage.js [baseUrl]
 * Example: node e2e-production-curated-coverage.js https://www.orderskew.com/pages/domainname_wizard/
 * Exits 0 if results panel appears and summary includes Curated Coverage row; 1 otherwise.
 */

const baseUrl = (process.argv[2] || "https://www.orderskew.com/pages/domainname_wizard/").replace(/\/$/, "");
const JOB_START_MS = 8000;
const RESULTS_WAIT_MS = 180000;

async function main() {
  const { chromium } = require("playwright");
  const url = baseUrl + "/index.html";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const log = (msg) => console.error("[e2e-curated]", msg);

  try {
    log("Loading " + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

    const formError = await page.locator("#form-error").textContent().catch(() => "");
    if (formError && formError.includes("Failed to start browser worker")) {
      log("FAIL: Worker failed to start");
      await browser.close();
      process.exit(1);
    }

    const keywordsInput = page.locator('input[name="keywords"]');
    await keywordsInput.waitFor({ state: 'visible', timeout: 15000 });
    await keywordsInput.fill("tech startup");
    await page.locator('input[name="loopCount"]').fill("2");
    await page.getByRole("button", { name: /start search/i }).click();

    log("Waiting for job to start...");
    await page.waitForFunction(
      () => {
        const el = document.getElementById("status-label");
        return el && el.textContent && el.textContent.trim().toLowerCase() !== "idle";
      },
      { timeout: JOB_START_MS }
    ).catch(() => null);

    log("Waiting for results panel and Curated Coverage in summary (up to " + (RESULTS_WAIT_MS / 1000) + "s)...");
    const found = await page.waitForFunction(
      () => {
        const panel = document.getElementById("results-panel");
        if (!panel || panel.hidden) return false;
        const kpis = document.getElementById("summary-kpis");
        if (!kpis || !kpis.innerHTML) return false;
        return kpis.innerHTML.includes("Curated Coverage");
      },
      { timeout: RESULTS_WAIT_MS }
    ).then(() => true).catch(() => false);

    if (!found) {
      const panel = await page.locator("#results-panel").getAttribute("hidden").catch(() => null);
      const kpisText = await page.locator("#summary-kpis").innerHTML().catch(() => "");
      log("FAIL: Results panel or Curated Coverage not found. results-panel.hidden=" + panel + ", summary-kpis length=" + (kpisText || "").length);
      await browser.close();
      process.exit(1);
    }

    const summaryHtml = await page.locator("#summary-kpis").innerHTML();
    const hasCuratedRow = summaryHtml.includes("Curated Coverage");
    const hasValue = /Curated Coverage[\s\S]*?<strong>([^<]+)<\/strong>/.test(summaryHtml);
    const valueMatch = summaryHtml.match(/Curated Coverage[\s\S]*?<strong>([^<]+)<\/strong>/);
    const value = valueMatch ? valueMatch[1].trim() : "";

    if (!hasCuratedRow) {
      log("FAIL: Summary KPIs do not contain Curated Coverage label");
      await browser.close();
      process.exit(1);
    }

    log("OK: Curated Coverage row present, value: " + (value || "(empty)"));
    await browser.close();
    process.exit(0);
  } catch (err) {
    log("FAIL: " + err.message);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
