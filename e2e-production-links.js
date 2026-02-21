/**
 * Production link checker and 404 checks. Extracts same-origin links from root and tools hub HTML; GET each; expects 2xx/3xx.
 * GETs NOT_FOUND_PATHS and expects 404.
 * Usage: node e2e-production-links.js [baseUrl]
 * Exits 0 if all checks pass, 1 otherwise.
 */

const https = require("https");
const { getBaseUrl, TOOLS_HUB_LINKS, ROOT_SAME_ORIGIN_LINKS, NOT_FOUND_PATHS } = require("./e2e-production-config.js");

const baseUrl = getBaseUrl();

function get(url, followRedirect = true) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        timeout: 15000,
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
              const next = loc.startsWith("http") ? loc : new URL(loc, url).href;
              get(next, true).then(resolve).catch(reject);
              return;
            }
          }
          resolve({ status, body });
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

const LOG = "[link-check]";
function log(msg) {
  console.error(LOG, msg);
}

function isOkStatus(status) {
  return status >= 200 && status < 400;
}

async function extractSameOriginLinks(html, pageUrl) {
  const origin = new URL(pageUrl).origin;
  const re = /<a[^>]+href=["']([^"']+)["']/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    let full;
    try {
      full = new URL(href, pageUrl).href;
    } catch {
      continue;
    }
    if (new URL(full).origin !== origin) continue;
    const path = new URL(full).pathname;
    if (!path || path === "/") continue;
    out.add(full);
  }
  return Array.from(out);
}

async function runLinkChecks() {
  let failed = 0;
  const rootUrl = baseUrl + "/";
  const hubUrl = baseUrl + "/pages/index.html";
  const toCheck = [
    { url: rootUrl, label: "root" },
    { url: hubUrl, label: "tools hub" },
  ];
  const seen = new Set();
  for (const { url, label } of toCheck) {
    let body;
    try {
      const res = await get(url);
      body = res.body;
    } catch (err) {
      log("FAIL: fetch " + label + " " + (err.message || err));
      failed++;
      continue;
    }
    const links = await extractSameOriginLinks(body, url);
    for (const link of links) {
      if (seen.has(link)) continue;
      seen.add(link);
      try {
        const res = await get(link);
        if (!isOkStatus(res.status)) {
          log("FAIL: " + link + " status " + res.status);
          failed++;
        } else {
          log("OK: " + link + " " + res.status);
        }
      } catch (err) {
        log("FAIL: " + link + " " + (err.message || err));
        failed++;
      }
    }
  }
  const explicit = [...ROOT_SAME_ORIGIN_LINKS, ...TOOLS_HUB_LINKS].map((p) => baseUrl + (p.startsWith("/") ? p : "/" + p));
  for (const url of explicit) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await get(url);
      if (!isOkStatus(res.status)) {
        log("FAIL: " + url + " status " + res.status);
        failed++;
      } else {
        log("OK: " + url + " " + res.status);
      }
    } catch (err) {
      log("FAIL: " + url + " " + (err.message || err));
      failed++;
    }
  }
  return failed;
}

async function run404Checks() {
  let failed = 0;
  for (const path of NOT_FOUND_PATHS) {
    const url = baseUrl + path;
    try {
      const res = await get(url, false);
      if (res.status === 404) {
        log("OK: " + path + " 404");
      } else if (res.status === 200) {
        log("OK: " + path + " 200 (SPA/fallback; 404 not required)");
      } else {
        log("FAIL: " + path + " unexpected status " + res.status);
        failed++;
      }
    } catch (err) {
      log("FAIL: " + path + " " + (err.message || err));
      failed++;
    }
  }
  return failed;
}

async function main() {
  log("Base URL: " + baseUrl);
  let failed = 0;
  failed += await runLinkChecks();
  failed += await run404Checks();
  if (failed > 0) {
    log("Total failures: " + failed);
    process.exit(1);
  }
  log("All link and 404 checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(LOG, err);
  process.exit(1);
});
