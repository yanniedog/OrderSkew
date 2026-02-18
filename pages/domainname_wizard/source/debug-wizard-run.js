/**
 * Automated debug reproduction for wizard "Failed to fetch".
 * Clears debug-89960b.log, ensures dev server is up, runs wizard submit via Playwright, exits.
 * Run: node debug-wizard-run.js
 * Then read debug-89960b.log for analysis.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const LOG_FILE = path.join(__dirname, "debug-89960b.log");
const BASE_URL = "http://localhost:3000";
const WIZARD_URL = BASE_URL + "/wizard.html";
const READINESS_TIMEOUT_MS = 60000;
const POLL_MS = 500;
const PLAYWRIGHT_TIMEOUT_MS = 120000;
const LOG_FLUSH_MS = 3000;

function writeRunnerLog(message, data) {
  try {
    const line = JSON.stringify({
      sessionId: "89960b",
      location: "debug-wizard-run.js",
      message,
      data: data || {},
      timestamp: Date.now(),
      hypothesisId: "runner",
    }) + "\n";
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {
    console.error("Could not write runner log:", e.message);
  }
}

function clearLog() {
  try {
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
  } catch (e) {
    console.error("Could not clear log file:", e.message);
  }
}

function checkServerUp() {
  return new Promise((resolve) => {
    const req = http.get(BASE_URL, (res) => {
      resolve(res.statusCode > 0);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + READINESS_TIMEOUT_MS;
    function poll() {
      checkServerUp().then((up) => {
        if (up) return resolve();
        if (Date.now() > deadline) return reject(new Error("Dev server did not become ready in time"));
        setTimeout(poll, POLL_MS);
      });
    }
    poll();
  });
}

function startDevServer() {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "npm.cmd" : "npm";
  const child = spawn(cmd, ["run", "dev"], {
    cwd: __dirname,
    shell: false,
    stdio: "pipe",
  });
  child.on("error", (err) => console.error("Dev server spawn error:", err.message));
  return child;
}

async function runPlaywright() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let outcome = "timeout";
  let timeoutDiagnostics = null;
  try {
    await page.goto(WIZARD_URL, { waitUntil: "networkidle", timeout: 15000 });
    await page.fill('input[name="keywords"]', "test");
    await page.click('button[type="submit"]');
    const result = await Promise.race([
      page.waitForSelector('#submit-error[style*="block"]', { timeout: PLAYWRIGHT_TIMEOUT_MS }).then(() => "error"),
      page.waitForSelector("#results .table-wrap", { timeout: PLAYWRIGHT_TIMEOUT_MS }).then(() => "success"),
      page.waitForSelector('#job-error[style*="block"]', { timeout: PLAYWRIGHT_TIMEOUT_MS }).then(() => "job-error"),
    ]).then((r) => (outcome = r)).catch(async () => {
      try {
        const submitErr = await page.locator("#submit-error").textContent().catch(() => null);
        const jobErr = await page.locator("#job-error").textContent().catch(() => null);
        const phaseLabel = await page.locator("#phase-label").textContent().catch(() => null);
        timeoutDiagnostics = { submitError: submitErr && submitErr.trim() || null, jobError: jobErr && jobErr.trim() || null, phaseLabel: phaseLabel && phaseLabel.trim() || null };
      } catch (_) {}
    });
    if (timeoutDiagnostics) writeRunnerLog("playwright timeout diagnostics", timeoutDiagnostics);
  } finally {
    await new Promise((r) => setTimeout(r, LOG_FLUSH_MS));
    await browser.close();
  }
  return outcome;
}

async function main() {
  clearLog();
  const up = await checkServerUp();
  let devChild;
  if (!up) {
    console.log("Starting dev server...");
    devChild = startDevServer();
    await waitForServer();
  }
  console.log("Running wizard reproduction...");
  writeRunnerLog("playwright started", { baseUrl: BASE_URL });
  const outcome = await runPlaywright();
  writeRunnerLog("playwright finished", { outcome });
  if (devChild) devChild.kill();
  console.log("Outcome:", outcome);
  console.log("Log file:", LOG_FILE);
  if (fs.existsSync(LOG_FILE)) {
    console.log("--- Log contents ---");
    console.log(fs.readFileSync(LOG_FILE, "utf8"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
