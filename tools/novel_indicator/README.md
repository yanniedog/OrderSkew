# Novel Indicator (Browser-Local + Cloudflare Auth/Profile)

Production architecture for the Novel Indicator web app:
- Optimization, indicator search, telemetry generation, report export, and Pine export run in the end-user browser (Web Worker).
- Binance market-data calls are made directly from the browser to Binance.
- Cloudflare Worker + D1 handle authentication and user profile persistence only.

No end user runs Python, localhost services, or local backend processes.

## Public Runtime Guarantees

1. Users open the page and run optimization in-browser only.
2. Binance requests are never proxied by your site backend.
3. If Binance rate limits occur, they apply to that user egress IP.
4. Server stores account/profile data plus retained run summaries/plots only.
5. Server does not store raw historical OHLCV market arrays.

## Architecture

- Frontend SPA: `tools/novel_indicator/frontend` (deployed to `pages/novel_indicator`).
- Browser compute engine: `tools/novel_indicator/frontend/src/engine/worker.ts`.
- Cloudflare API: `tools/novel_indicator/cloudflare_api`.
- D1 schema migrations: `tools/novel_indicator/cloudflare_api/migrations`.

## API Scope (Cloudflare Worker)

Auth:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/email/verify/request`
- `POST /api/auth/email/verify/confirm`
- `POST /api/auth/password/forgot`
- `POST /api/auth/password/reset`
- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- `GET /api/auth/session`

Profile:
- `GET /api/me`
- `GET /api/me/preferences`
- `PUT /api/me/preferences`
- `GET /api/me/runs`
- `POST /api/me/runs`
- `GET /api/me/runs/:runId`
- `DELETE /api/me/runs/:runId`

Explicit non-goal:
- No `/api` route fetches Binance.

## Data Policy

Persisted in D1:
- users, credentials, oauth links, sessions, verification/reset tokens
- user preferences
- retained run summaries and selected plot payloads

Rejected by API:
- raw OHLCV candle payloads
- oversized payloads beyond configured limits

## Local Development (Maintainers)

Frontend:
```powershell
cd frontend
npm install
npm run dev
```

Cloudflare API:
```powershell
cd cloudflare_api
npm install
npm run typecheck
npm run test
npm run dev
```

One-command helper (opens both frontend + worker dev shells):
```powershell
.\run-dev.ps1
```

## Deploy Static Frontend Into OrderSkew Pages

```powershell
.\deploy-to-orderskew.ps1
```

This script:
1. Typechecks/tests Cloudflare API package.
2. Builds frontend bundle.
3. Cleans and repopulates `pages/novel_indicator` from `frontend/dist`.

Cloudflare deployment of auth/profile Worker is performed with Wrangler in `cloudflare_api`.

## CI Guardrails

Workflow: `.github/workflows/novel-indicator-ci.yml`

Checks include:
1. Frontend build.
2. Cloudflare API typecheck + tests.
3. D1 migration presence check.
4. Forbidden string scan for Binance host usage in server code.
5. Forbidden localhost scan in frontend source + production bundle.
6. Forbidden demo-fallback markers in frontend source.

## Legacy Python Backend

`tools/novel_indicator/backend` remains in-repo as legacy research code reference. It is not required for public runtime of the hosted Novel Indicator app.
