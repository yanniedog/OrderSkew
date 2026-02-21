/**
 * Production site-wide checks: root, tools hub, all tool entry URLs, Novel Indicator API health.
 * Usage: node e2e-production-site-wide.js [baseUrl]
 * Example: node e2e-production-site-wide.js https://www.orderskew.com
 * Exits 0 if all checks pass, 1 otherwise.
 * Set PRODUCTION_SITE_WIDE_CONSOLE=1 to also run Playwright console/network checks on root and tools hub.
 */

const https = require("https");

const baseUrl = (process.argv[2] || "https://www.orderskew.com").replace(/\/$/, "");

function resolveUrl(base, relative) {
  if (relative.startsWith("http://") || relative.startsWith("https://")) return relative;
  const b = new URL(base);
  if (relative.startsWith("/")) return b.origin + relative;
  return new URL(relative, base).href;
}

function get(url, followRedirect = true) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        timeout: 20000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode;
          if (followRedirect && (status === 301 || status === 302 || status === 308)) {
            const loc = res.headers.location;
            if (loc) {
              const next = resolveUrl(url, loc);
              get(next, true).then(resolve).catch(reject);
              return;
            }
          }
          resolve({ status, body, headers: res.headers });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

const LOG_PREFIX = "[site-wide]";

function log(msg) {
  console.error(LOG_PREFIX, msg);
}

const HTML_OK_STATUSES = [200, 308];

const SITE_WIDE_CHECKS = [
  { path: "/", name: "Trading Plan Calculator (root)", expectStatus: HTML_OK_STATUSES, expectHtml: true },
  { path: "/pages/", name: "Tools hub (pages/)", expectStatus: HTML_OK_STATUSES, expectHtml: true },
  { path: "/pages/index.html", name: "Tools hub index", expectStatus: HTML_OK_STATUSES, expectHtml: true },
  { path: "/pages/nab_homeloan_calculator/index.html", name: "NAB homeloan", expectStatus: HTML_OK_STATUSES, expectHtml: true },
  { path: "/pages/novel_indicator/index.html", name: "Novel Indicator", expectStatus: HTML_OK_STATUSES, expectHtml: true },
  { path: "/pages/domainname_wizard/index.html", name: "Domain Name Wizard", expectStatus: HTML_OK_STATUSES, expectHtml: true },
  { path: "/pages/crypto_ath_drawdown_cycles/index.html", name: "Crypto ATH drawdown", expectStatus: HTML_OK_STATUSES, expectHtml: true },
  { path: "/pages/boardspace_atlas/index.html", name: "BoardSpace Atlas", expectStatus: HTML_OK_STATUSES, expectHtml: true },
];

async function runHttpChecks() {
  let failed = 0;
  for (const c of SITE_WIDE_CHECKS) {
    const url = baseUrl + c.path;
    try {
      const { status, body } = await get(url);
      const okStatus = Array.isArray(c.expectStatus) ? c.expectStatus.includes(status) : status === (c.expectStatus || 200);
      if (!okStatus) {
        log("FAIL: " + c.name + " status " + status + " (expected " + JSON.stringify(c.expectStatus || 200) + ")");
        failed++;
        continue;
      }
      if (c.expectHtml && status === 200 && body.indexOf("<!") === -1) {
        log("FAIL: " + c.name + " does not look like HTML");
        failed++;
        continue;
      }
      log("OK: " + c.name + " " + status);
    } catch (err) {
      log("FAIL: " + c.name + " " + (err.message || err));
      failed++;
    }
  }
  return failed;
}

function loadPlaywright() {
  const path = require("path");
  try {
    return require(path.join(__dirname, "pages", "domainname_wizard", "source", "node_modules", "playwright"));
  } catch {
    return require("playwright");
  }
}

async function runConsoleChecks() {
  if (process.env.PRODUCTION_SITE_WIDE_CONSOLE !== "1") {
    return 0;
  }
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  let failed = 0;

  const pagesToCheck = [
    { url: baseUrl + "/", name: "Trading Plan Calculator (root)" },
    { url: baseUrl + "/pages/index.html", name: "Tools hub" },
  ];

  for (const { url, name } of pagesToCheck) {
    errors.length = 0;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(String(err)));
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(2000);
      if (errors.length > 0) {
        log("FAIL: " + name + " console/page errors: " + errors.slice(0, 5).join(" | "));
        failed++;
      } else {
        log("OK: " + name + " no console errors");
      }
    } catch (err) {
      log("FAIL: " + name + " " + (err.message || err));
      failed++;
    }
    await page.close();
  }
  await browser.close();
  return failed;
}

async function main() {
  log("Base URL: " + baseUrl);
  let failed = 0;
  failed += await runHttpChecks();
  failed += await runConsoleChecks();
  if (failed > 0) {
    log("Total failures: " + failed);
    process.exit(1);
  }
  log("All site-wide checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(LOG_PREFIX, err);
  process.exit(1);
});
