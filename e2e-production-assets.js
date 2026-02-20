/**
 * Production asset checks: root, NAB, Crypto ATH, Chess Tree, Novel Indicator (parse index for assets), shared assets.
 * Usage: node e2e-production-assets.js [baseUrl]
 * Exits 0 if all checks pass, 1 otherwise.
 */

const https = require("https");
const { getBaseUrl, ROOT_ASSETS, TOOL_ASSETS } = require("./e2e-production-config.js");

const baseUrl = getBaseUrl();

function resolvePath(basePath, relative) {
  const parts = basePath.replace(/\/$/, "").split("/").filter(Boolean);
  const rel = relative.split("/");
  for (const p of rel) {
    if (p === "..") parts.pop();
    else if (p !== "." && p !== "") parts.push(p);
  }
  return "/" + parts.join("/");
}

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

const LOG = "[asset-check]";
function log(msg) {
  console.error(LOG, msg);
}

const OK_STATUSES = [200, 308];

function checkOne(url, name, opts = {}) {
  return get(url).then(
    ({ status, body }) => {
      const ok = Array.isArray(opts.expectStatus) ? opts.expectStatus.includes(status) : (opts.expectStatus || 200) === status;
      if (!ok) {
        log("FAIL: " + name + " status " + status);
        return 1;
      }
      if (opts.expectHtml && status === 200 && body.indexOf("<!") === -1) {
        log("FAIL: " + name + " does not look like HTML");
        return 1;
      }
      if (opts.expectJs && status === 200 && body.indexOf("Worker") === -1 && body.indexOf("worker") === -1) {
        log("WARN: " + name + " may not be JS (no worker reference)");
      }
      log("OK: " + name + " " + status);
      return 0;
    },
    (err) => {
      log("FAIL: " + name + " " + (err.message || err));
      return 1;
    }
  );
}

async function checkRootAssets() {
  let failed = 0;
  failed += await checkOne(baseUrl + "/styles.css", "root styles.css", { expectStatus: OK_STATUSES });
  for (const asset of ROOT_ASSETS) {
    if (asset === "styles.css") continue;
    failed += await checkOne(baseUrl + "/" + asset, "root " + asset, { expectStatus: OK_STATUSES });
  }
  return failed;
}

async function checkToolAssets() {
  let failed = 0;
  for (const [tool, { basePath, assets }] of Object.entries(TOOL_ASSETS)) {
    for (const asset of assets) {
      const path = asset.startsWith(".") ? resolvePath(basePath, asset) : basePath + "/" + asset;
      const url = baseUrl + path;
      const name = tool + " " + asset;
      const expectHtml = asset === "index.html";
      failed += await checkOne(url, name, { expectStatus: OK_STATUSES, expectHtml });
    }
  }
  return failed;
}

async function checkNovelIndicatorAssets() {
  let failed = 0;
  const indexUrl = baseUrl + "/pages/novel_indicator/index.html";
  const { status, body } = await get(indexUrl).catch((e) => {
    log("FAIL: novel_indicator index " + (e.message || e));
    return { status: 0, body: "" };
  });
  if (status !== 200 && !OK_STATUSES.includes(status)) {
    log("FAIL: novel_indicator index status " + status);
    return 1;
  }
  const basePath = "/pages/novel_indicator";
  const scriptRe = /<script[^>]+src=["']([^"']+)["']/gi;
  const linkRe = /<link[^>]+href=["']([^"']+)["']/gi;
  const urls = new Set();
  let m;
  while ((m = scriptRe.exec(body))) urls.add(m[1]);
  while ((m = linkRe.exec(body))) urls.add(m[1]);
  for (const ref of urls) {
    if (ref.startsWith("http") || ref.startsWith("//") || ref.startsWith("data:")) continue;
    const path = ref.startsWith("/") ? ref : basePath + (ref.startsWith("./") ? ref.slice(1) : "/" + ref);
    const url = baseUrl + path;
    failed += await checkOne(url, "novel_indicator " + ref, { expectStatus: OK_STATUSES });
  }
  return failed;
}

async function main() {
  log("Base URL: " + baseUrl);
  let failed = 0;
  failed += await checkRootAssets();
  failed += await checkToolAssets();
  failed += await checkNovelIndicatorAssets();
  if (failed > 0) {
    log("Total failures: " + failed);
    process.exit(1);
  }
  log("All asset checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(LOG, err);
  process.exit(1);
});
