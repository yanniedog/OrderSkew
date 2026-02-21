/**
 * E2E test for the static domainname_wizard page (no Next.js).
 * Usage: node e2e-static-wizard.js <baseUrl>
 * Example: node e2e-static-wizard.js http://localhost:8765/pages/domainname_wizard/
 * Exits 0 on success, 1 on failure. Logs to stderr/stdout.
 */

const baseUrl = process.argv[2] || "http://localhost:8765/pages/domainname_wizard/";
const JOB_START_WAIT_MS = 20000;

async function main() {
  const { chromium } = require("playwright");
  const url = baseUrl.replace(/\/$/, "") + "/index.html";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const log = (msg) => console.error("[e2e]", msg);

  try {
    log("Loading " + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

    const formError = await page.locator("#form-error").textContent().catch(() => "");
    if (formError && formError.includes("Failed to start browser worker")) {
      log("FAIL: Worker failed to start: " + formError.trim());
      await browser.close();
      process.exit(1);
    }

    const keywordsInput = page.getByLabel("Keywords");
    await keywordsInput.fill("test keywords");
    await page.getByRole("button", { name: /start search/i }).click();

    log("Waiting for job to start (status change from Idle)...");
    const statusChanged = await page.waitForFunction(
      () => {
        const el = document.getElementById("status-label");
        return el && el.textContent && el.textContent.trim().toLowerCase() !== "idle";
      },
      { timeout: JOB_START_WAIT_MS }
    ).then(() => true).catch(() => false);

    const formErrorAfter = await page.locator("#form-error").textContent().catch(() => "");
    if (formErrorAfter && formErrorAfter.includes("Failed to start browser worker")) {
      log("FAIL: Worker error after start: " + formErrorAfter.trim());
      await browser.close();
      process.exit(1);
    }

    if (statusChanged) {
      const status = await page.locator("#status-label").textContent();
      log("OK: Job started (status: " + (status || "").trim() + ")");
      await browser.close();
      process.exit(0);
    }

    const errText = await page.locator("#form-error").textContent().catch(() => "") || await page.locator("#job-error").textContent().catch(() => "");
    log("WARN: Status did not change in time. Form/job error: " + (errText || "(none)").trim());
    await browser.close();
    process.exit(0);
  } catch (err) {
    log("FAIL: " + err.message);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
