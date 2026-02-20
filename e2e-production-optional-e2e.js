/**
 * Optional minimal E2E: root (Trading Plan Calculator), NAB, Crypto ATH, Novel Indicator.
 * Run only when PRODUCTION_FULL_E2E=1. Exits 0 if all pass, 1 otherwise.
 * Usage: node e2e-production-optional-e2e.js [baseUrl]
 */

const path = require("path");
const { getBaseUrl } = require("./e2e-production-config.js");

function loadPlaywright() {
  try {
    return require(path.join(__dirname, "pages", "domainname_wizard", "source", "node_modules", "playwright"));
  } catch {
    return require("playwright");
  }
}

const LOG = "[optional-e2e]";
function log(msg) {
  console.error(LOG, msg);
}

async function checkPage(browser, url, name, check) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2000);
    const ok = await check(page);
    if (!ok) {
      log("FAIL: " + name + " check failed");
      await page.close();
      return 1;
    }
    if (errors.length > 0) {
      log("FAIL: " + name + " console/page errors: " + errors.slice(0, 3).join(" | "));
      await page.close();
      return 1;
    }
    log("OK: " + name);
    await page.close();
    return 0;
  } catch (err) {
    log("FAIL: " + name + " " + (err.message || err));
    await page.close().catch(() => {});
    return 1;
  }
}

async function main() {
  if (process.env.PRODUCTION_FULL_E2E !== "1") {
    log("SKIP: set PRODUCTION_FULL_E2E=1 to run optional E2E");
    process.exit(0);
  }
  const baseUrl = getBaseUrl();
  log("Base URL: " + baseUrl);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  let failed = 0;

  failed += await checkPage(
    browser,
    baseUrl + "/",
    "Trading Plan Calculator (root)",
    async (page) => {
      const intro = await page.$("#intro-layer");
      const main = await page.$("main");
      return !!(intro || main);
    }
  );

  failed += await checkPage(
    browser,
    baseUrl + "/pages/nab_homeloan_calculator/index.html",
    "NAB homeloan",
    async (page) => {
      const upload = await page.$("#uploadBtn");
      const analyze = await page.$("#analyzeBtn");
      return !!(upload && analyze);
    }
  );

  failed += await checkPage(
    browser,
    baseUrl + "/pages/crypto_ath_drawdown_cycles/index.html",
    "Crypto ATH",
    async (page) => {
      const btn = await page.getByRole("button", { name: /run analysis/i }).first();
      return (await btn.count()) > 0;
    }
  );

  failed += await checkPage(
    browser,
    baseUrl + "/pages/novel_indicator/index.html",
    "Novel Indicator",
    async (page) => {
      const root = await page.$("#root");
      if (!root) return false;
      const inner = await root.evaluate((el) => el && el.innerHTML && el.innerHTML.length > 0);
      return !!inner;
    }
  );

  await browser.close();
  if (failed > 0) {
    log("Total failures: " + failed);
    process.exit(1);
  }
  log("All optional E2E passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(LOG, err);
  process.exit(1);
});
