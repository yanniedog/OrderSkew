/**
 * Production asset check: fetch critical Domain Name Wizard URLs and verify status + content.
 * Usage: node e2e-production-asset-check.js [baseUrl]
 * Example: node e2e-production-asset-check.js https://www.orderskew.com/pages/domainname_wizard
 * Exits 0 if all checks pass, 1 otherwise.
 */

const https = require("https");
const baseUrl = (process.argv[2] || "https://www.orderskew.com/pages/domainname_wizard").replace(/\/$/, "");

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: "GET", timeout: 15000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

async function main() {
  const log = (msg) => console.error("[asset-check]", msg);
  let failed = 0;

  const assets = [
    { path: "/index.html", name: "index.html", expectStatus: [200, 308], expectHtml: true },
    { path: "/app.js", name: "app.js", expectStatus: 200, expectJs: true },
    { path: "/domainname_wizard_utils.js", name: "domainname_wizard_utils.js", expectStatus: 200 },
    { path: "/engine.worker.js", name: "engine.worker.js", expectStatus: 200, expectImportScripts: true },
    { path: "/worker-utils.js", name: "worker-utils.js", expectStatus: 200 },
    { path: "/worker-scoring.js", name: "worker-scoring.js", expectStatus: 200 },
    { path: "/worker-optimizer.js", name: "worker-optimizer.js", expectStatus: 200, noDuplicatePlaysInNoveltyPool: true },
    { path: "/worker-api.js", name: "worker-api.js", expectStatus: 200 },
    { path: "/styles.css", name: "styles.css", expectStatus: 200 },
  ];

  for (const a of assets) {
    const url = baseUrl + a.path;
    try {
      const { status, body } = await get(url);
      const okStatus = Array.isArray(a.expectStatus) ? a.expectStatus.includes(status) : (status === (a.expectStatus || 200));
      if (!okStatus) {
        log("FAIL: " + a.name + " status " + status + " (expected " + JSON.stringify(a.expectStatus || 200) + ")");
        failed++;
        continue;
      }
      if (a.expectHtml && status === 200 && body.indexOf("<!") === -1) {
        log("FAIL: " + a.name + " does not look like HTML");
        failed++;
        continue;
      }
      if (a.expectJs && body.indexOf("Worker") === -1 && body.indexOf("worker") === -1) {
        log("WARN: " + a.name + " may not be app.js (no worker reference)");
      }
      if (a.expectImportScripts && body.indexOf("importScripts") === -1) {
        log("FAIL: " + a.name + " missing importScripts");
        failed++;
        continue;
      }
      if (a.noDuplicatePlaysInNoveltyPool) {
        const noveltyPoolStart = body.indexOf("_noveltyPool(candidates, loop)");
        if (noveltyPoolStart === -1) {
          log("WARN: " + a.name + " _noveltyPool not found");
        } else {
          const block = body.slice(noveltyPoolStart, noveltyPoolStart + 1200);
          const constPlaysMatches = block.match(/const plays = /g);
          if (constPlaysMatches && constPlaysMatches.length > 1) {
            log("FAIL: " + a.name + " duplicate 'const plays' in _noveltyPool (importScripts error)");
            failed++;
          }
        }
      }
      log("OK: " + a.name + " " + status + " (" + body.length + " bytes)");
    } catch (err) {
      log("FAIL: " + a.name + " " + (err.message || err));
      failed++;
    }
  }

  if (failed) {
    log("Total failures: " + failed);
    process.exit(1);
  }
  log("All asset checks passed.");
  process.exit(0);
}

main();
