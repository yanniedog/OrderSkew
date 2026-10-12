# OrderSkew project instructions

OrderSkew is the standalone Trading Plan Calculator. Former tools are preserved in https://github.com/yanniedog/orderskew-tools-archive and must not be reintroduced here.

## Required verification

- Node 22+, no root dependencies to install.
- Run `npm run test:calculator` and JavaScript syntax checks before merge.
- Before claiming a deploy complete, run `npm run test:production:all` from the repository root. It must exit 0. Fix, redeploy and rerun on failure.
- Final deploy reports must include the exact command, exit code and pass/fail summary by check group. Never describe unrun checks as passed.
- The production suite verifies www/apex calculator availability, all current asset references, MIME types, hashes and local parity, plus real 404/410 responses for retired tool/hub/API routes. It has no skip flags or backend/tool tests.
- Browser QA must cover desktop/mobile calculator edits, light/dark themes, live graph/table updates and console errors.

## Hosting

Production: https://www.orderskew.com. Static deploys follow main pushes. Root `404.html` prevents the static host's SPA fallback from serving the calculator at former tool paths. Do not restore redirects to the tools hub.

The former Vercel Domain Name Wizard backend project is disconnected from this Git repository. Its historical deployments and data are retained separately; it must not deploy from OrderSkew or gate calculator changes.

## Calculator


- **Entry**: root `index.html`; static, CDN deps. No build step. Local dev: e.g. `python -m http.server 8000`.
- **Workspace design**: `workspace.css` owns tokens and the shell; `workspace.controls.css`, `workspace.results.css`, `workspace.responsive.css` and `workspace.dialogs.css` separate controls, output, breakpoints and dialogs. The root page has its own header/footer and does not load the shared subpage frame. Keep calculator interactions instant. Check light/dark themes, direct mode buttons, mobile section links, visible settings, overview accounting, menus and dialogs after UI changes.
- **Asset versions**: Edit the root source files, then run `npm run assets:calculator` and commit both `index.html` and generated `calculator-assets/`. Each deployed filename includes a hash of its content; do not edit generated copies. Production overrides short cache lifetimes, so query versions and revalidation headers alone did not protect returning sessions. Content filenames make long caching safe. `npm run test:calculator` rejects stale references, missing/tampered artifacts and obsolete generated filenames. Hashes normalize CRLF/LF for portable checkouts.
- **Readability and disclosure**: Keep primary labels and table values at least 16px, supporting text at least 14px, and inputs at least 44px high. Show the four core inputs first; range/spacing, allocation, fees, chart/table options and order rows use labelled native disclosures. `main.disclosure.js` keeps collapsed summaries aligned with current settings and opens orders for section links. Changing modes, loading a plan or using guided setup must preserve accurate summaries; invalid settings must reveal the affected field. Narrow layouts reflow instead of shrinking text.
- **Calculator checks**: Node 22+, no root dependencies to install. Run `npm run test:calculator` for accounting, validation, precision, configuration and CSV regressions. CI runs this command and JavaScript syntax checks. Browser QA must also cover the root calculator at desktop and mobile widths; the numerical suite does not establish browser or production correctness.


## Code Quality Standards


- **Max file size**: 300 lines (flag for review), 500+ lines (trigger refactor).
- **Max function size**: 50 lines.
- **DRY**: No duplicate code across 3+ locations.
- **Modularity**: Single responsibility per file/function.

