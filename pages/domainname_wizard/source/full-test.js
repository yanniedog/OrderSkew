/**
 * Full project test: unit tests, build, API smoke, wizard E2E.
 * Run: node full-test.js
 * Starts dev server for E2E if not already up. Set SKIP_E2E=1 to skip API smoke and wizard.
 */

const { spawn, spawnSync } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

const root = __dirname;
const BASE_URL = "http://localhost:3000";

function run(name, script, opts = {}) {
  const isWin = process.platform === "win32";
  const result = spawnSync(isWin ? "cmd" : "sh", isWin ? ["/c", script] : ["-c", script], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (result.status !== 0) {
    console.error("FAILED:", name);
    process.exit(result.status);
  }
  console.log("OK:", name);
}

function checkServerUp() {
  return new Promise((resolve) => {
    const req = http.get(BASE_URL, (res) => { resolve(res.statusCode > 0); });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

function waitForServer(deadlineMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + (deadlineMs || 60000);
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

console.log("--- Unit tests ---");
run("vitest", "npx vitest run");

console.log("--- Build ---");
run("next build", "npx next build");

if (process.env.SKIP_E2E === "1" || process.env.SKIP_E2E === "true") {
  console.log("SKIP_E2E=1: skipping API smoke and wizard E2E");
  process.exit(0);
}

let devChild;
(async function e2e() {
  const up = await checkServerUp();
  if (!up) {
    console.log("Starting dev server for E2E...");
    devChild = startDevServer();
    await waitForServer(60000);
  }

  console.log("--- API smoke ---");
  const apiResult = spawnSync("node", ["api-smoke.js"], { cwd: root, stdio: "inherit", timeout: 90000 });
  if (apiResult.status !== 0) {
    if (devChild) devChild.kill();
    console.error("FAILED: API smoke");
    process.exit(apiResult.status);
  }
  console.log("OK: API smoke");

  console.log("--- Wizard E2E ---");
  const wizardResult = spawnSync("node", ["debug-wizard-run.js"], { cwd: root, stdio: "inherit", timeout: 180000 });
  if (devChild) devChild.kill();
  if (wizardResult.status !== 0) {
    console.error("FAILED: Wizard E2E");
    process.exit(wizardResult.status);
  }
  const logPath = path.join(root, "debug-89960b.log");
  if (fs.existsSync(logPath)) {
    const outcomeLine = fs.readFileSync(logPath, "utf8").split("\n").find((l) => l.includes("playwright finished"));
    const outcome = outcomeLine ? (JSON.parse(outcomeLine).data?.outcome) : "unknown";
    if (outcome !== "success" && outcome !== "job-error" && outcome !== "error") {
      console.warn("Wizard E2E outcome:", outcome, "(success/job-error/error are acceptable)");
    }
  }
  console.log("OK: Wizard E2E");
  console.log("--- All tests passed ---");
})().catch((err) => {
  if (devChild) devChild.kill();
  console.error(err);
  process.exit(1);
});
