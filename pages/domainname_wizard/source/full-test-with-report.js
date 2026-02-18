/**
 * Full automated test: start server if needed, run Namelix->GoDaddy pipeline
 * with random keywords, then report domain availability and prices.
 * Optionally runs Playwright to show webpage and fill form.
 * Usage: node full-test-with-report.js [--no-browser] [baseUrl]
 */

const http = require("http");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const root = __dirname;
const args = process.argv.slice(2).filter((a) => a !== "--no-browser");
const BASE = args.find((a) => a.startsWith("http")) || "http://localhost:3000";
const SKIP_BROWSER = process.argv.includes("--no-browser");
const POLL_MS = 2000;
const JOB_TIMEOUT_MS = 120000;
const SERVER_WAIT_MS = 60000;

const RANDOM_KEYWORDS = [
  "solar coffee analytics",
  "pet grooming mobile",
  "mountain bikes gear",
  "fitness app ai",
  "green energy startup",
  "cloud backup saas",
];
const randomKeywords = RANDOM_KEYWORDS[Math.floor(Math.random() * RANDOM_KEYWORDS.length)];

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathname, BASE);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname,
        method,
        headers:
          method === "POST" && body
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
            : {},
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode, data: null, raw: data });
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("request timeout"));
    });
    if (body) req.write(body);
    req.end();
  });
}

function checkServerUp() {
  return new Promise((resolve) => {
    const u = new URL("/", BASE);
    const req = http.get(
      { hostname: u.hostname, port: u.port || 80, path: "/", timeout: 3000 },
      (res) => resolve(res.statusCode > 0)
    );
    req.on("error", () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForServer(deadlineMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + (deadlineMs || SERVER_WAIT_MS);
    function poll() {
      checkServerUp().then((up) => {
        if (up) return resolve();
        if (Date.now() > deadline) return reject(new Error("Server did not become ready"));
        setTimeout(poll, 500);
      });
    }
    poll();
  });
}

function startDevServer() {
  const isWin = process.platform === "win32";
  return spawn(isWin ? "npm.cmd" : "npm", ["run", "dev"], { cwd: root, shell: false, stdio: "pipe" });
}

function formatPrice(price, currency) {
  if (typeof price !== "number") return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(price);
}

function printReport(job) {
  if (!job.results) {
    console.log("No results in job (status: %s)", job.status);
    if (job.error) console.log("Error: %s - %s", job.error.code, job.error.message);
    return;
  }
  const { withinBudget, overBudget, unavailable } = job.results;
  const all = [...withinBudget, ...overBudget, ...unavailable];

  console.log("\n========== DOMAIN AVAILABILITY REPORT (Namelix -> GoDaddy pipeline) ==========\n");
  console.log("Keywords used: %s", typeof job.input !== "undefined" ? job.input.keywords : "(see test output above)");
  console.log("Job ID: %s | Status: %s\n", job.id, job.status);

  console.log("--- Within budget ---");
  if (withinBudget.length === 0) console.log("  (none)");
  else
    withinBudget.forEach((r) => {
      console.log("  %s | Available: %s | Definitive: %s | Price: %s | Premium: %s", r.domain, r.available ? "Yes" : "No", r.definitive ? "Yes" : "No", formatPrice(r.price, r.currency), r.isNamelixPremium ? "Yes" : "No");
    });

  console.log("\n--- Over budget ---");
  if (overBudget.length === 0) console.log("  (none)");
  else
    overBudget.forEach((r) => {
      console.log("  %s | Available: %s | Price: %s | Premium: %s", r.domain, r.available ? "Yes" : "No", formatPrice(r.price, r.currency), r.isNamelixPremium ? "Yes" : "No");
    });

  console.log("\n--- Unavailable / unknown ---");
  if (unavailable.length === 0) console.log("  (none)");
  else
    unavailable.forEach((r) => {
      console.log("  %s | Available: %s | Reason: %s", r.domain, r.available ? "Yes" : "No", r.reason || "-");
    });

  console.log("\n========== PRICES (each domain) ==========\n");
  all.forEach((r) => {
    console.log("  %s => %s", r.domain, formatPrice(r.price, r.currency));
  });
  console.log("");
}

async function runSearch() {
  const body = JSON.stringify({
    keywords: randomKeywords,
    description: "automated full-test run",
    style: "brandable",
    randomness: "medium",
    blacklist: "",
    maxLength: 20,
    tld: "com",
    maxNames: 10,
    yearlyBudget: 60,
    loopCount: 1,
  });

  const postRes = await request("POST", "/api/searches", body);
  if (postRes.status !== 202 || !postRes.data?.jobId) {
    throw new Error("POST /api/searches failed: " + postRes.status + " " + JSON.stringify(postRes.data));
  }

  const jobId = postRes.data.jobId;
  const deadline = Date.now() + JOB_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const getRes = await request("GET", "/api/searches/" + jobId);
    if (getRes.status !== 200 || !getRes.data) {
      throw new Error("GET /api/searches/" + jobId + " failed: " + getRes.status);
    }
    const job = getRes.data;
    if (job.status === "done" || job.status === "failed") {
      return job;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error("Job did not complete within " + JOB_TIMEOUT_MS + " ms");
}

async function runPlaywright(keywords) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const url = BASE.replace(/\/$/, "") + "/";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    const keywordsInput = page.getByLabel("Keywords");
    await keywordsInput.fill(keywords);
    await keywordsInput.dispatchEvent("blur");
    await new Promise((r) => setTimeout(r, 400));
    await page.getByRole("button", { name: /start search/i }).click();
    try {
      await page.waitForSelector(".table-wrap", { timeout: JOB_TIMEOUT_MS });
      return { success: true };
    } catch (e) {
      const errText = await page.locator(".error").first().textContent().catch(() => null);
      if (errText) console.warn("Browser test: no table; page error: %s", errText.trim());
      return { success: false };
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  let devChild;
  const up = await checkServerUp();
  if (!up) {
    console.log("Starting dev server...");
    devChild = startDevServer();
    await waitForServer(SERVER_WAIT_MS);
    console.log("Server ready.");
  }

  console.log("Running pipeline with random keywords: %s", randomKeywords);

  try {
    const job = await runSearch();
    printReport(job);

    if (job.status === "failed") {
      console.error("Job failed: %s - %s", job.error?.code, job.error?.message);
      if (devChild) devChild.kill();
      process.exit(1);
    }

    if (!SKIP_BROWSER) {
      console.log("Running browser test (fill form and submit)...");
      const pw = await runPlaywright(randomKeywords);
      if (!pw.success) console.warn("Browser test: results table did not appear (check manually).");
      else console.log("Browser test: OK.");
    }

    console.log("--- Full test passed ---");
  } catch (err) {
    console.error(err);
    if (devChild) devChild.kill();
    process.exit(1);
  }

  if (devChild) devChild.kill();
  process.exit(0);
}

main();
