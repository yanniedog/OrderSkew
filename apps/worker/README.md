# Orderskew Bootstrap Worker (Phase 1)

## Endpoints

- `GET /api/health`
- `GET /api/version`

## Includes

- D1, R2, Queue, Durable Object bindings
- D1 migration (`migrations/0001_init.sql`)
- Shared config loader (`packages/shared/src/config.ts`)
- Structured logs with request IDs (`x-request-id`)

## Local

1. `npm install`
2. Configure resource IDs in `wrangler.toml`
3. Apply D1 migrations:
   - `wrangler d1 migrations apply orderskew_bootstrap --local`
   - `wrangler d1 migrations apply orderskew_bootstrap --remote`
4. `npm run dev`

## Deploy

- `npm run deploy`