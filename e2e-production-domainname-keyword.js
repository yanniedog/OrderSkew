/**
 * Wrapper: run Domain Name Wizard keyword verification E2E only when PRODUCTION_KEYWORD_VERIFY=1 (long run).
 * Usage: node e2e-production-domainname-keyword.js [baseUrl]
 * Exits 0 when skipped or when keyword E2E passes; 1 when E2E fails.
 */

const { spawnSync } = require("child_process");
const path = require("path");
const { getBaseUrl } = require("./e2e-production-config.js");

const LOG = "[keyword-verify-wrapper]";
function log(msg) {
  console.error(LOG, msg);
}

if (process.env.PRODUCTION_KEYWORD_VERIFY !== "1") {
  log("SKIP: set PRODUCTION_KEYWORD_VERIFY=1 to run Domain Name Wizard keyword verification E2E");
  process.exit(0);
}

const baseUrl = getBaseUrl();
const wizardBase = baseUrl.replace(/\/$/, "") + "/pages/domainname_wizard/";
const scriptPath = path.join(__dirname, "pages", "domainname_wizard", "source", "e2e-keyword-verification.js");

log("Running keyword verification E2E against " + wizardBase);
const result = spawnSync(process.execPath, [scriptPath, wizardBase], {
  cwd: __dirname,
  stdio: "inherit",
  shell: false,
  timeout: 25 * 60 * 1000,
});

if (result.status !== 0) {
  log("FAILED: keyword verification E2E exit " + (result.status != null ? result.status : "signal"));
  process.exit(result.status != null ? result.status : 1);
}
log("Keyword verification E2E passed.");
process.exit(0);
