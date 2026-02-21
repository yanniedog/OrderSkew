/**
 * Optional Domain Name Wizard backend health check. Run when DOMAINNAME_WIZARD_BACKEND_URL is set.
 * GETs the backend URL (or /api/health) and expects 2xx. Skip when env not set.
 * Usage: node e2e-production-domainname-backend.js
 * Exits 0 when skipped or when backend responds 2xx; 1 on failure.
 */

const https = require("https");
const http = require("http");

const LOG = "[domainname-backend]";
function log(msg) {
  console.error(LOG, msg);
}

const backendUrl = process.env.DOMAINNAME_WIZARD_BACKEND_URL && process.env.DOMAINNAME_WIZARD_BACKEND_URL.trim();
if (!backendUrl) {
  log("SKIP: set DOMAINNAME_WIZARD_BACKEND_URL to run Domain Name Wizard backend health check");
  process.exit(0);
}

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        timeout: 10000,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
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

async function main() {
  const urlToCheck = backendUrl.replace(/\/$/, "");
  const healthUrl = urlToCheck + "/api/health";
  try {
    const res = await get(healthUrl);
    if (res.status >= 200 && res.status < 300) {
      log("OK: " + healthUrl + " " + res.status);
      process.exit(0);
    }
  } catch {
    // no-op
  }
  try {
    const res = await get(urlToCheck);
    if (res.status >= 200 && res.status < 300) {
      log("OK: " + urlToCheck + " " + res.status);
      process.exit(0);
    }
    log("FAIL: " + urlToCheck + " status " + res.status + " (expected 2xx)");
  } catch (err) {
    log("FAIL: " + urlToCheck + " " + (err.message || err));
  }
  process.exit(1);
}

main();
