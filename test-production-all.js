/**
 * Run all production tests for www.orderskew.com. Exits 0 only if every step passes; 1 on first failure.
 * Usage: node test-production-all.js [baseUrl]
 * Example: node test-production-all.js https://www.orderskew.com
 * Steps: site-wide HTTP, asset checks, link checker + 404, Novel Indicator API, optional E2E, Domain Name Wizard production, keyword verify (optional), Domain Name Wizard backend health (optional).
 */

const { execSync } = require("child_process");

const baseUrl = process.argv[2] || "https://www.orderskew.com";
const rootDir = __dirname;

function run(name, command, cwd = rootDir) {
  console.error("[test-production-all] Step: " + name);
  try {
    execSync(command, {
      cwd,
      stdio: "inherit",
      shell: true,
    });
  } catch (err) {
    console.error("[test-production-all] FAILED: " + name);
    process.exit(1);
  }
}

console.error("[test-production-all] Base URL: " + baseUrl);
console.error("[test-production-all] Root: " + rootDir);

run(
  "Site-wide (root, tools hub, tool URLs)",
  "node e2e-production-site-wide.js " + baseUrl.replace(/\/$/, "")
);

run(
  "Production asset checks (root, NAB, Crypto ATH, BoardSpace Atlas, Novel Indicator)",
  "node e2e-production-assets.js " + baseUrl.replace(/\/$/, "")
);

run(
  "Link checker and 404 checks",
  "node e2e-production-links.js " + baseUrl.replace(/\/$/, "")
);

run(
  "Novel Indicator API (health, session, login, me, 404); set SKIP_NOVEL_API=1 to skip or REQUIRE_NOVEL_API=1 to enforce",
  "node e2e-production-novel-api.js " + baseUrl.replace(/\/$/, "")
);

run(
  "Optional E2E (root, NAB, Crypto ATH, Novel); set PRODUCTION_FULL_E2E=1 to run",
  "node e2e-production-optional-e2e.js " + baseUrl.replace(/\/$/, "")
);

run(
  "Domain Name Wizard production (assets + static wizard + curated coverage)",
  "npm run test:domainname_wizard:production:all"
);

run(
  "Domain Name Wizard keyword verification (long); set PRODUCTION_KEYWORD_VERIFY=1 to run",
  "node e2e-production-domainname-keyword.js " + baseUrl.replace(/\/$/, "")
);

run(
  "Domain Name Wizard backend health; set DOMAINNAME_WIZARD_BACKEND_URL to run",
  "node e2e-production-domainname-backend.js"
);

console.error("[test-production-all] All production checks passed.");
process.exit(0);
