/**
 * Run all production tests for www.orderskew.com. Exits 0 only if every step passes; 1 on first failure.
 * Usage: node test-production-all.js [baseUrl]
 * Example: node test-production-all.js https://www.orderskew.com
 * Steps: (1) site-wide HTTP + API health, (2) Domain Name Wizard production tests, (3) Chess Tree production smoke.
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
  "Site-wide (root, tools hub, tool URLs, API health)",
  "node e2e-production-site-wide.js " + baseUrl.replace(/\/$/, "")
);

run(
  "Domain Name Wizard production (assets + static wizard + curated coverage)",
  "npm run test:domainname_wizard:production:all"
);

run("Chess Tree production smoke", "npm run test:chess_tree:prod");

console.error("[test-production-all] All production checks passed.");
process.exit(0);
