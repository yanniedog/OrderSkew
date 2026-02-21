# AU Home Loan Rates Cloudflare API (Phase 1)

Cloudflare-native scaffolding for Australian home-loan rate collection.

## Stack

- Worker runtime: TypeScript + Hono
- Storage: D1 (normalized + metadata), R2 (raw payloads)
- Scheduling: Cron triggers
- Fan-out: Cloudflare Queues
- Coordination: Durable Objects lock

## API Routes

Public:
- `GET /api/home-loan-rates/health`
- `GET /api/home-loan-rates/filters`
- `GET /api/home-loan-rates/latest`
- `GET /api/home-loan-rates/timeseries`

Admin (Bearer token or Cloudflare Access JWT):
- `POST /api/home-loan-rates/admin/runs/daily`
- `POST /api/home-loan-rates/admin/runs/backfill`
- `GET /api/home-loan-rates/admin/runs`
- `GET /api/home-loan-rates/admin/runs/:runId`

## Setup

1. Install deps:
   - `npm install`
2. Create Cloudflare resources:
   - D1 DB
   - R2 bucket
   - Queue + DLQ
3. Update `wrangler.toml` IDs/names.
4. Apply migrations:
   - `wrangler d1 migrations apply au_home_loan_rates --local`
   - `wrangler d1 migrations apply au_home_loan_rates --remote`
5. Set secret:
   - `wrangler secret put ADMIN_API_TOKEN`
6. Optional Access vars in `wrangler.toml`:
   - `CF_ACCESS_TEAM_DOMAIN`
   - `CF_ACCESS_AUD`

## Local

- `npm run dev`

## Deploy

- `npm run deploy`

## Notes

- Phase 1 is scaffold-first and idempotent.
- Lender discovery/fetch/parsing pipelines are intentionally stubbed for Phase 2 expansion.
- Queue consumers persist raw payload stubs into R2 + D1 metadata to prove end-to-end flow.