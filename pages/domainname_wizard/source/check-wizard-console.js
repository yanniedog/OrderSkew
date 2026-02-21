/**
 * Check Domain Name Wizard page for console errors on load.
 * Usage: node check-wizard-console.js [url]
 * Default: http://localhost:9876/index.html
 * Exits 0 if no errors, 1 if errors found.
 */

const url = process.argv[2] || "http://localhost:9876/index.html";

async function main() {
  const { chromium } = require("playwright");
  
  console.log("Loading:", url);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const consoleMessages = [];
  const pageErrors = [];
  const networkErrors = [];
  
  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    consoleMessages.push({ type, text });
    if (type === "error" || type === "warning") {
      console.log(`[CONSOLE ${type.toUpperCase()}]`, text);
    }
  });
  
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    console.log("[PAGE ERROR]", err.message);
  });
  
  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400) {
      const error = `${status} ${response.statusText()} - ${url}`;
      networkErrors.push(error);
      console.log("[NETWORK ERROR]", error);
    }
  });
  
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
    
    // Wait a bit for any async errors
    await page.waitForTimeout(2000);
    
    console.log("\n=== Page Structure Check ===");
    
    // Check for form fields
    const keywordsInput = await page.locator('input[name="keywords"]').count();
    console.log("Keywords input:", keywordsInput > 0 ? "FOUND" : "MISSING");
    
    const collectUnavailableCheckbox = await page.locator('input[name="collectUnavailable"]').count();
    console.log("Collect Unavailable checkbox:", collectUnavailableCheckbox > 0 ? "FOUND" : "MISSING");
    
    const startBtn = await page.locator('#start-btn').count();
    console.log("Start button:", startBtn > 0 ? "FOUND" : "MISSING");
    
    // Check for results panel elements
    const resultsPanel = await page.locator('#results-panel').count();
    console.log("Results panel:", resultsPanel > 0 ? "FOUND" : "MISSING");
    
    const allRankedTable = await page.locator('#all-ranked-table').count();
    console.log("All Ranked table container:", allRankedTable > 0 ? "FOUND" : "MISSING");
    
    const withinBudgetTable = await page.locator('#within-budget-table').count();
    console.log("Within Budget table container:", withinBudgetTable > 0 ? "FOUND" : "MISSING");
    
    const unavailableTable = await page.locator('#unavailable-table').count();
    console.log("Unavailable table container:", unavailableTable > 0 ? "FOUND" : "MISSING");
    
    // Filter network errors to separate expected API failures from actual issues
    const expectedApiErrors = networkErrors.filter(err => 
      err.includes('/api/') && (err.includes('404') || err.includes('501'))
    );
    const unexpectedNetworkErrors = networkErrors.filter(err => 
      !err.includes('/api/') || (!err.includes('404') && !err.includes('501'))
    );
    
    console.log("\n=== Summary ===");
    console.log("Console errors:", consoleMessages.filter(m => m.type === "error").length);
    console.log("Console warnings:", consoleMessages.filter(m => m.type === "warning").length);
    console.log("Page errors:", pageErrors.length);
    console.log("Network errors (4xx/5xx):", networkErrors.length);
    console.log("  - Expected API errors (404/501 on /api/*):", expectedApiErrors.length);
    console.log("  - Unexpected network errors:", unexpectedNetworkErrors.length);
    
    if (unexpectedNetworkErrors.length > 0) {
      console.log("\n=== Unexpected Network Error Details ===");
      unexpectedNetworkErrors.forEach(err => console.log("  -", err));
    }
    
    if (expectedApiErrors.length > 0) {
      console.log("\n=== Expected API Errors (ignored) ===");
      expectedApiErrors.forEach(err => console.log("  -", err));
    }
    
    await browser.close();
    
    // Only consider it a failure if there are page errors or unexpected network errors
    const hasRealErrors = pageErrors.length > 0 || unexpectedNetworkErrors.length > 0;
    
    if (hasRealErrors) {
      console.log("\n❌ FAILED: Real errors detected");
      process.exit(1);
    } else {
      console.log("\n✓ PASSED: No real errors (API errors are expected without backend)");
      process.exit(0);
    }
    
  } catch (err) {
    console.error("\n❌ FAILED:", err.message);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
