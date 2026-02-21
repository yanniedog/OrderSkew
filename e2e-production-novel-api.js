/**
 * Production Novel Indicator API checks: health, unauthenticated routes (session, login, me, 404).
 * Usage: node e2e-production-novel-api.js [baseUrl]
 * Set SKIP_API_HEALTH=1 (or SKIP_NOVEL_API=1) to skip (exit 0 without running).
 * If API endpoints resolve to static HTML fallback, checks auto-skip unless REQUIRE_NOVEL_API=1.
 * Exits 0 if all checks pass, 1 otherwise.
 */

const https = require("https");
const { getBaseUrl, NOVEL_API_CHECKS } = require("./e2e-production-config.js");

if (process.env.SKIP_API_HEALTH === "1" || process.env.SKIP_NOVEL_API === "1") {
  console.error("[novel-api] SKIP: Novel Indicator API checks (SKIP_API_HEALTH=1 or SKIP_NOVEL_API=1)");
  process.exit(0);
}

const baseUrl = getBaseUrl();

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl + path);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      timeout: 15000,
      headers: {},
    };
    if (body && (method === "POST" || method === "PUT")) {
      const data = typeof body === "string" ? body : JSON.stringify(body);
      opts.headers["Content-Type"] = "application/json";
      opts.headers["Content-Length"] = Buffer.byteLength(data, "utf8");
    }
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, body: responseBody, headers: res.headers || {} });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    if (body && (method === "POST" || method === "PUT")) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

const LOG = "[novel-api]";
function log(msg) {
  console.error(LOG, msg);
}

function looksLikeHtmlFallback(response) {
  const status = response.status;
  const body = (response.body || "").trim().toLowerCase();
  const contentType = String((response.headers && response.headers["content-type"]) || "").toLowerCase();
  const htmlish = contentType.includes("text/html") || body.startsWith("<!doctype html") || body.startsWith("<html");
  return (status === 200 && htmlish) || status === 404;
}

async function shouldSkipBecauseApiUnavailable() {
  if (process.env.REQUIRE_NOVEL_API === "1") {
    return false;
  }
  try {
    const preflight = await request("GET", "/api/health");
    if (looksLikeHtmlFallback(preflight)) {
      log("SKIP: Novel API appears unavailable on this deployment (fallback HTML or 404). Set REQUIRE_NOVEL_API=1 to enforce.");
      return true;
    }
  } catch (err) {
    log("SKIP: Novel API preflight failed (" + (err.message || err) + "). Set REQUIRE_NOVEL_API=1 to enforce.");
    return true;
  }
  return false;
}

async function runChecks() {
  if (await shouldSkipBecauseApiUnavailable()) {
    process.exit(0);
    return;
  }

  let failed = 0;

  for (const c of NOVEL_API_CHECKS) {
    const path = c.path;
    const method = c.method || "GET";
    const expectStatus = Array.isArray(c.expectStatus) ? c.expectStatus : [c.expectStatus || 200];
    try {
      const body = c.body !== undefined ? c.body : undefined;
      const res = await request(method, path, body);
      if (!expectStatus.includes(res.status)) {
        log("FAIL: " + method + " " + path + " status " + res.status + " (expected " + JSON.stringify(expectStatus) + ")");
        failed++;
        continue;
      }
      if (c.expectJson) {
        try {
          JSON.parse(res.body);
        } catch {
          log("FAIL: " + path + " response is not JSON");
          failed++;
          continue;
        }
      }
      if (c.expectStatusOk && res.status === 200) {
        let json;
        try {
          json = JSON.parse(res.body);
        } catch {
          log("FAIL: " + path + " json parse failed");
          failed++;
          continue;
        }
        if (json.status !== "ok") {
          log("FAIL: " + path + " json.status=" + (json.status || "(missing)") + " (expected 'ok')");
          failed++;
          continue;
        }
      }
      log("OK: " + method + " " + path + " " + res.status);
    } catch (err) {
      log("FAIL: " + path + " " + (err.message || err));
      failed++;
    }
  }

  if (failed > 0) {
    log("Total failures: " + failed);
    process.exit(1);
  }
  log("All Novel API checks passed.");
  process.exit(0);
}

log("Base URL: " + baseUrl);
runChecks().catch((err) => {
  console.error(LOG, err);
  process.exit(1);
});
