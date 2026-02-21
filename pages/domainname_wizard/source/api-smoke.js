/**
 * API smoke test: POST /api/searches, then GET /api/searches/:id until done/failed or timeout.
 * Requires dev server on port 3000. Run: node api-smoke.js
 */

const http = require("http");

const BASE = "http://localhost:3000";
const POLL_MS = 1500;
const JOB_TIMEOUT_MS = 60000;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname,
        method,
        headers: method === "POST" && body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {},
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
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("request timeout"));
    });
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const body = JSON.stringify({
    keywords: "test",
    description: "",
    style: "default",
    randomness: "medium",
    blacklist: "",
    maxLength: 25,
    tld: "com",
    maxNames: 2,
    yearlyBudget: 50,
    loopCount: 1,
  });
  const postRes = await request("POST", "/api/searches", body);
  if (postRes.status !== 202 || !postRes.data || !postRes.data.jobId) {
    console.error("POST /api/searches failed:", postRes.status, postRes.data);
    process.exit(1);
  }
  const jobId = postRes.data.jobId;
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const getRes = await request("GET", "/api/searches/" + jobId);
    if (getRes.status !== 200 || !getRes.data) {
      console.error("GET /api/searches/" + jobId + " failed:", getRes.status);
      process.exit(1);
    }
    const status = getRes.data.status;
    if (status === "done" || status === "failed") {
      console.log("API smoke OK: job", jobId, "ended with status", status);
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  console.error("Job did not complete within", JOB_TIMEOUT_MS, "ms");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
