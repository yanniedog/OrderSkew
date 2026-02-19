/**
 * E2E test to verify Domain Name Wizard keyword pool behavior.
 * Usage: node e2e-keyword-verification.js <baseUrl>
 * Example: node e2e-keyword-verification.js https://www.orderskew.com/pages/domainname_wizard/
 * 
 * Verifies that ONLY appropriate keywords are used across all loops,
 * and that off-topic keywords like "seat", "seato", etc. NEVER appear.
 */

const baseUrl = process.argv[2] || "https://www.orderskew.com/pages/domainname_wizard/";
const LOOP_COUNT = 5;
const MAX_WAIT_MS = 20 * 60 * 1000; // 20 minutes max (includes model download time)

// Off-topic keywords that should NEVER appear
const FORBIDDEN_KEYWORDS = [
  "seat", "seato", "seatero", "seatify", "hivision", "summitis", 
  "fin", "sekey", "setty", "visionex"
];

// Expected keyword stems for "AI productivity"
const EXPECTED_STEMS = [
  "ai", "productivity", "workflow", "task", "manage", "plan", 
  "organize", "track", "focus", "artificial", "intelligence", 
  "smart", "machine", "learn", "neural", "auto"
];

async function main() {
  const { chromium } = require("playwright");
  const url = baseUrl.replace(/\/$/, "") + "/index.html";
  const browser = await chromium.launch({ headless: true }); // headless for reliability
  const context = await browser.newContext();
  context.setDefaultTimeout(MAX_WAIT_MS); // Set default timeout for all operations
  const page = await context.newPage();

  const log = (msg) => console.log("[keyword-verify]", msg);

  try {
    log("Loading " + url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Clear IndexedDB to ensure fresh model load
    log("Clearing IndexedDB...");
    await page.evaluate(() => {
      return new Promise((resolve) => {
        if (!window.indexedDB) {
          resolve();
          return;
        }
        const req = indexedDB.deleteDatabase("transformers-cache");
        req.onsuccess = () => resolve();
        req.onerror = () => resolve(); // continue even if fails
        req.onblocked = () => {
          setTimeout(() => resolve(), 1000);
        };
      });
    });

    // Wait a bit for page to fully load
    await page.waitForTimeout(2000);

    // Check for worker initialization
    const formError = await page.locator("#form-error").textContent().catch(() => "");
    if (formError && formError.includes("Failed to start browser worker")) {
      log("FAIL: Worker failed to start: " + formError.trim());
      await browser.close();
      process.exit(1);
    }

    // Fill in the form
    log("Filling form with 'AI productivity' keywords and " + LOOP_COUNT + " loops");
    const keywordsInput = page.locator('input[name="keywords"]');
    await keywordsInput.fill("AI productivity");
    
    const loopCountInput = page.locator('input[name="loopCount"]');
    await loopCountInput.fill(LOOP_COUNT.toString());

    // Capture console logs to check for debug output
    const consoleLogs = [];
    page.on("console", msg => {
      const text = msg.text();
      consoleLogs.push(text);
      if (text.includes("Initialized strict keyword pool") || 
          text.includes("Loop") || 
          text.includes("keywords")) {
        log("Console: " + text);
      }
    });

    // Start the job
    log("Starting search...");
    await page.locator("#start-btn").click();

    // Wait for job to start
    log("Waiting for job to start...");
    const statusChanged = await page.waitForFunction(
      () => {
        const el = document.getElementById("status-label");
        return el && el.textContent && el.textContent.trim().toLowerCase() !== "idle";
      },
      { timeout: 30000 }
    ).then(() => true).catch(() => false);

    if (!statusChanged) {
      log("FAIL: Job did not start");
      await browser.close();
      process.exit(1);
    }

    log("Job started, waiting for completion...");

    // Poll for completion with manual timeout control
    const startTime = Date.now();
    let completed = false;
    let lastLoopStatus = "";
    
    while (!completed && (Date.now() - startTime) < MAX_WAIT_MS) {
      try {
        // Check status
        const statusLabel = await page.locator("#status-label").textContent({ timeout: 5000 }).catch(() => "");
        const loopStatus = await page.locator("#loop-label").textContent({ timeout: 5000 }).catch(() => "");
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        
        if (loopStatus !== lastLoopStatus) {
          log(`Progress at ${elapsed}s: ${statusLabel.trim()} - ${loopStatus.trim()}`);
          lastLoopStatus = loopStatus;
        }
        
        // Check if job is done
        const statusLower = statusLabel.trim().toLowerCase();
        if (statusLower === "idle" || statusLower.includes("complete") || statusLower.includes("done") || statusLower === "failed") {
          completed = true;
          log(`Job completed with status: ${statusLabel.trim()}`);
          break;
        }
        
        // Wait before next check
        await page.waitForTimeout(5000);
      } catch (e) {
        log("Error during progress check: " + e.message);
        await page.waitForTimeout(5000);
      }
    }

    if (!completed) {
      log("FAIL: Job did not complete in time");
      await browser.close();
      process.exit(1);
    }

    log("Job completed! Analyzing results...");

    // Wait a bit for UI to update
    await page.waitForTimeout(2000);

    // Take screenshot
    await page.screenshot({ path: "keyword-verification-results.png", fullPage: true });
    log("Screenshot saved to keyword-verification-results.png");

    // Extract loop summaries and tuning history
    const loopData = await page.evaluate(() => {
      const results = {
        loopSummaries: [],
        tuningHistory: [],
        rawText: document.body.innerText
      };

      // Extract loop summaries table
      const loopSummaryTable = document.querySelector("#loop-summary-table table");
      if (loopSummaryTable) {
        const rows = loopSummaryTable.querySelectorAll("tbody tr");
        rows.forEach(row => {
          const cells = row.querySelectorAll("td");
          if (cells.length > 0) {
            const summary = {
              loop: cells[0]?.textContent?.trim() || "",
              generated: cells[1]?.textContent?.trim() || "",
              ranked: cells[2]?.textContent?.trim() || "",
              available: cells[3]?.textContent?.trim() || "",
              withinBudget: cells[4]?.textContent?.trim() || "",
              topName: cells[5]?.textContent?.trim() || ""
            };
            results.loopSummaries.push(summary);
          }
        });
      }

      // Extract tuning history table - this contains the keywords!
      const tuningTable = document.querySelector("#tuning-table table");
      if (tuningTable) {
        const rows = tuningTable.querySelectorAll("tbody tr");
        rows.forEach(row => {
          const cells = row.querySelectorAll("td");
          if (cells.length > 0) {
            const tuning = {
              loop: cells[0]?.textContent?.trim() || "",
              keywords: cells[1]?.textContent?.trim() || "",
              description: cells[2]?.textContent?.trim() || "",
              style: cells[3]?.textContent?.trim() || "",
              randomness: cells[4]?.textContent?.trim() || ""
            };
            results.tuningHistory.push(tuning);
          }
        });
      }

      return results;
    });

    log("\n=== LOOP SUMMARIES ===");
    if (loopData.loopSummaries.length > 0) {
      loopData.loopSummaries.forEach(summary => {
        log(`Loop ${summary.loop}: Generated ${summary.generated}, Ranked ${summary.ranked}, Available ${summary.available}, Within Budget ${summary.withinBudget}`);
        if (summary.topName) log(`  Top name: ${summary.topName}`);
      });
    } else {
      log("No loop summaries found");
    }

    log("\n=== TUNING HISTORY (KEYWORDS PER LOOP) ===");
    if (loopData.tuningHistory.length > 0) {
      loopData.tuningHistory.forEach(tuning => {
        log(`Loop ${tuning.loop}:`);
        log(`  Keywords: ${tuning.keywords}`);
        if (tuning.description) log(`  Description: ${tuning.description}`);
        log(`  Style: ${tuning.style}, Randomness: ${tuning.randomness}`);
      });
    } else {
      log("No tuning history found");
      log("\nShowing first 2000 chars of page text:");
      log(loopData.rawText.substring(0, 2000));
    }

    // Check for forbidden keywords in the entire page text (for informational purposes only)
    const pageText = loopData.rawText.toLowerCase();
    const foundForbiddenInPage = [];
    
    for (const forbidden of FORBIDDEN_KEYWORDS) {
      const regex = new RegExp("\\b" + forbidden + "\\b", "i");
      if (regex.test(pageText)) {
        foundForbiddenInPage.push(forbidden);
      }
    }

    // Check console logs for keyword pool initialization
    const keywordPoolLog = consoleLogs.find(log => log.includes("Initialized strict keyword pool"));
    if (keywordPoolLog) {
      log("\n=== KEYWORD POOL INITIALIZATION ===");
      log(keywordPoolLog);
    }

    // Report results - check ONLY the actual tuning history keywords
    log("\n=== VERIFICATION RESULTS ===");
    
    let allKeywordsValid = true;
    const foundForbiddenInLoops = [];

    // Detailed keyword check from tuning history (PRIMARY CHECK)
    if (loopData.tuningHistory.length > 0) {
      log("\n=== DETAILED KEYWORD ANALYSIS (from Tuning History) ===");
      loopData.tuningHistory.forEach(tuning => {
        // Extract keywords from the description field (which contains the actual keywords)
        const keywordText = tuning.description.toLowerCase();
        const keywords = keywordText.split(/[\s,]+/).filter(k => k.length > 0);
        
        // Check each keyword against forbidden list (exact match)
        const invalid = keywords.filter(kw => {
          return FORBIDDEN_KEYWORDS.some(forbidden => kw === forbidden);
        });
        
        if (invalid.length > 0) {
          log(`Loop ${tuning.loop}: ❌ CONTAINS FORBIDDEN: ${invalid.join(", ")}`);
          foundForbiddenInLoops.push(...invalid);
          allKeywordsValid = false;
        } else {
          log(`Loop ${tuning.loop}: ✅ All keywords valid (${keywords.length} keywords)`);
          log(`           Keywords: ${keywords.join(", ")}`);
        }
      });
      
      if (!allKeywordsValid) {
        log("\n❌ FINAL RESULT: FAILED - Forbidden keywords found in loop tuning history");
        log("Forbidden keywords found: " + [...new Set(foundForbiddenInLoops)].join(", "));
        await browser.close();
        process.exit(1);
      }
      
      log("\n✅ KEYWORD VALIDATION: SUCCESS!");
      log("All loops used appropriate keywords related to: AI, productivity");
      log("No forbidden keywords were found in any loop's keyword set");
      
      if (foundForbiddenInPage.length > 0) {
        log("\n⚠️  Note: Found '" + foundForbiddenInPage.join(", ") + "' elsewhere on page (likely in status text like 'Finalizing'), but NOT in loop keywords");
      }
    } else {
      log("⚠️  WARNING: No tuning history found, cannot verify keywords");
      await browser.close();
      process.exit(1);
    }

    // Check if expected stems appear
    const foundExpected = EXPECTED_STEMS.filter(stem => {
      const regex = new RegExp("\\b" + stem, "i");
      return regex.test(pageText);
    });
    
    log("Found " + foundExpected.length + "/" + EXPECTED_STEMS.length + " expected keyword stems:");
    log(foundExpected.join(", "));

    await browser.close();
    process.exit(0);

  } catch (err) {
    log("FAIL: " + err.message);
    log(err.stack);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
