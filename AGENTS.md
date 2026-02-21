# Order Skew Project Configuration

Order Skew is a monorepo containing the Trading Plan Calculator (root), a tools hub at `pages/`, and multiple subprojects with different deploy and test flows.

## Hard Enforcement Rules (Must Always Be Followed)

These rules are mandatory and override any conflicting preference.

1. Before claiming any deploy-related task is complete, run from repo root:
   - `npm run test:production:all`
2. If the command exits non-zero:
   - Do not mark the task complete.
   - Fix the failure, redeploy the affected subproject, and rerun `npm run test:production:all`.
   - Repeat until the command exits `0`.
3. In the final response for deploy-related tasks, include evidence:
   - Exact command run.
   - Exit code.
   - Brief pass/fail summary by major check group.
4. Deploy or production-impacting changes are not complete unless all required checks pass or the user explicitly instructs to skip checks.
5. Allowed skip flags must be explicitly stated when used:
   - `SKIP_API_HEALTH=1`
   - `SKIP_NOVEL_API=1`
   - `PRODUCTION_SITE_WIDE_CONSOLE=1`
   - `PRODUCTION_FULL_E2E=1`
   - `PRODUCTION_KEYWORD_VERIFY=1`
6. Never present assumptions as verification.
   - If a check was not run, state it was not run.

## Production and Hosting

- **Production URL**: https://www.orderskew.com
- **Hosting model**: Static site + optional backends. Main app and tools hub are static; Novel Indicator uses Cloudflare Worker + D1 for auth/profile; Domain Name Wizard backend can be Vercel (Next.js) or Cloudflare Worker.
- **Tools hub**: `pages/index.html` links to NAB homeloan calculator, Novel Indicator, Domain Name Wizard, and Top 20 Ex-Stable ATH Drawdown Cycles. All under `pages/<tool>/`.

## Repo-Level Commands

| Purpose | Command | Notes |
|-----|---|---|
| Full production test (exhaustive battery) | `npm run test:production:all` | From repo root. Runs site-wide HTTP, asset checks (root + all tools), link checker, 404 checks, Novel Indicator API, Domain Name Wizard E2E. Optional: `SKIP_API_HEALTH=1` or `SKIP_NOVEL_API=1` to skip API; `PRODUCTION_SITE_WIDE_CONSOLE=1` for root/hub console checks; `PRODUCTION_FULL_E2E=1` for optional E2E (root, NAB, Crypto ATH, Novel); `PRODUCTION_KEYWORD_VERIFY=1` for Domain Name Wizard keyword E2E. Requires Playwright (e.g. in `pages/domainname_wizard/source/`). |
| Domain Wizard full test (unit + E2E) | `npm run test:domainname_wizard` | From repo root. Requires `npm install` and `npx playwright install chromium` in `pages/domainname_wizard/source/`. |

## Subproject: Novel Indicator

- **Frontend**: `tools/novel_indicator/frontend` (Vite + React, TypeScript).
  - **Build**: `npm run build` (runs `tsc -b && vite build`).
  - **Deploy to Order Skew**: run `tools/novel_indicator/deploy-to-orderskew.ps1`. This typechecks and tests the Cloudflare API, builds the frontend, then copies `frontend/dist/*` into `pages/novel_indicator/`.
- **API**: `tools/novel_indicator/cloudflare_api` (Cloudflare Worker + D1).
  - **Typecheck**: `npm run typecheck`
  - **Test**: `npm run test` (vitest run)
  - **Deploy**: `npm run deploy` (wrangler deploy). Route must be `orderskew.com/api/*` (see `wrangler.toml`). Requires D1 DB, migrations applied, and secrets (e.g. SESSION_SECRET, GOOGLE_CLIENT_SECRET).
- **CI**: `.github/workflows/novel-indicator-ci.yml` (on changes under `tools/novel_indicator/**`, `pages/index.html`, `README.md`). Runs frontend build, API typecheck + tests, D1 migration check, and guardrails below.

### Novel Indicator Guardrails (CI and local)

- No Binance host references (`api.binance.com`, `binance.com`) in `tools/novel_indicator/cloudflare_api/src`.
- No `localhost` or `127.0.0.1` in `tools/novel_indicator/frontend/src` or `frontend/dist`.
- No demo fallback markers (e.g. "demo mode", "demo artifacts", "/demo/", "loadDemo", "retry engine") in frontend source.
- At least one SQL file in `tools/novel_indicator/cloudflare_api/migrations`.

## Subproject: Domain Name Wizard

- **Static UI**: `pages/domainname_wizard/` (e.g. `index.html`). Browser-native; worker runs in client. Can be served from any static host (e.g. same as orderskew.com or Cloudflare Pages).
- **Backend options**: Vercel (Next.js in `pages/domainname_wizard/source`) or Cloudflare Worker (`source/cloudflare-availability-worker.js`). See `pages/domainname_wizard/DEPLOY.md` and `pages/domainname_wizard/CLOUDFLARE.md`.
- **Source**: `pages/domainname_wizard/source/`.
  - **Build**: `npm run build` (next build).
  - **Unit tests**: `npm test` (vitest run).
  - **Full test from root**: `node test-domainname-wizard.js` (unit + static server + E2E Playwright). Requires `npm install` and `npx playwright install chromium` in `source/`.

## Subproject: Trading Plan Calculator (root)

- **Entry**: root `index.html`; static, CDN deps. No build step. Local dev: e.g. `python -m http.server 8000`.

## Deployment Verification Checklist

- All relevant tests pass before deploy:
  - Novel Indicator: `deploy-to-orderskew.ps1` (API typecheck + test + frontend build) and, if changing API, `npm run deploy` in `cloudflare_api` succeeds.
  - Domain Wizard: `npm run test:domainname_wizard` from root (and, if changing backend, deploy backend per DEPLOY.md/CLOUDFLARE.md).
- No console errors on production (www.orderskew.com) for main app and tools hub.
- Critical user flows: Trading Plan Calculator, tools hub links, Novel Indicator (login/run), Domain Name Wizard (backend URL + search).
- API: Novel Indicator `orderskew.com/api/*` returns expected status (e.g. 200 for session, 401 where appropriate); no 405 from missing route.
- No broken links or images on tools hub and linked tools.
- D1 migrations applied when changing Cloudflare API schema.

## Full Production Test and Fix-Redeploy Loop

- **Run all production checks**: From repo root, `npm run test:production:all` (or `node test-production-all.js [baseUrl]`). Steps: (1) site-wide HTTP (root, tools hub, all tool entry URLs), (2) production asset checks (root, NAB, Crypto ATH, BoardSpace Atlas, Novel Indicator assets), (3) link checker and 404 checks, (4) Novel Indicator API (health, session, login, me, 404), (5) optional E2E when `PRODUCTION_FULL_E2E=1`, (6) Domain Name Wizard production (assets + static wizard + curated coverage E2E). Exit code 0 only if every step passes; 1 on first failure.
- **Optional env**:
  - `SKIP_API_HEALTH=1` or `SKIP_NOVEL_API=1`: Skip all Novel Indicator API checks (use when API is not deployed or unreachable).
  - `PRODUCTION_SITE_WIDE_CONSOLE=1`: Run Playwright console/network checks on root and tools hub (slower).
  - `PRODUCTION_FULL_E2E=1`: Run optional minimal E2E for root (Trading Plan Calculator), NAB, Crypto ATH, and Novel Indicator (load and key elements visible).
  - `PRODUCTION_KEYWORD_VERIFY=1`: Run Domain Name Wizard keyword verification E2E (long; runs e2e-keyword-verification.js against production).
  - `DOMAINNAME_WIZARD_BACKEND_URL`: When set, run a GET health check against this backend URL (or its /api/health); skip when unset.
  - `BASE_URL`: Override base URL (default https://www.orderskew.com); can also pass as first argv to scripts.
- **Fix-redeploy-retest**: If any check fails, fix the cause in the repo, redeploy the affected part, then run `npm run test:production:all` again. Repeat until all pass.
- **Redeploy by subproject**:
  - **Static site** (root, tools hub, NAB, Domain Name Wizard static, Crypto ATH): Deploy is typically push to host (e.g. Cloudflare Pages / git push). No script in repo; push and wait for host build.
  - **Novel Indicator frontend**: Run `tools/novel_indicator/deploy-to-orderskew.ps1` (copies `frontend/dist` to `pages/novel_indicator`). Then push if the host deploys from repo.
  - **Novel Indicator API**: `npm run deploy` in `tools/novel_indicator/cloudflare_api` (wrangler). Required if `/api/health` or auth fails.

## Code Quality Standards

- **Max file size**: 300 lines (flag for review), 500+ lines (trigger refactor).
- **Max function size**: 50 lines.
- **DRY**: No duplicate code across 3+ locations.
- **Modularity**: Single responsibility per file/function.

## Files and Directories That Should NOT Be Refactored

- Build/config: `webpack.config.js`, `vite.config.ts`, `next.config.js`, `tsconfig.json`, `wrangler.toml`, `vitest.config.ts`.
- Generated: Database migrations, Prisma client, GraphQL types, `frontend/dist`, `.next`, `node_modules`.
- Config: `.env`, `.env.local`, `package.json`.
- Single-purpose entry points: `main.ts`, `index.ts` when they only bootstrap or re-export.
- Project-specific deploy/CI: `deploy-to-orderskew.ps1`, `run-dev.ps1`, `.github/workflows/novel-indicator-ci.yml`.
- Legacy reference: `tools/novel_indicator/backend` (Python; not used at runtime).