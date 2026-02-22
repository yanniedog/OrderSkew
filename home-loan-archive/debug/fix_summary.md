# Fix summary: GET /api/queue-test/result 1101 and hardening

## Tail error

No exception was captured during `wrangler tail home-loan-archive-dev` while hitting `/api/queue-test/result`. Both requests returned HTTP 200. The previously reported 1101 was not reproducible. See `debug/last_tail_error.txt` for the tail session notes.

## Root cause (inferred)

Mitigated defensively in code:

1. **D1 result shape** – D1 `.all()` can return `results: null` (per docs). Accessing `r.results[0]` when `results` is null would throw and produce 1101. The handler now treats `results` as optional and uses `Array.isArray(r?.results) ? r.results : []`.

2. **Row shape** – Row objects are assumed to have `value` and `updated_at`. Unexpected or missing keys could cause throws. The handler now treats the first element as a generic object and uses `"value" in row` / `"updated_at" in row` and a safe JSON parse.

3. **Missing bindings** – If `env` or `env.DB` were undefined on some paths, the handler could throw before the try/catch. The handler now checks `env` and `env.DB` for DB-using routes and returns 500 JSON instead of throwing.

## Code changes

- **Env validation** – For `/api/health`, `/api/queue-test/result`, and `/api/debug/app_kv`, if `env` or `env.DB` is missing, return `Response.json({ ok: false, error: "DB binding missing" }, { status: 500 })` and log.
- **GET /api/queue-test/result** – Use only safe D1 access: `Array.isArray(r?.results)`, row as generic object, `"value"` / `"updated_at"` via `in` checks. Wrap the D1 query in an inner try/catch; on failure log and return 200 with `last_queue_ping: null`. Use `safeJsonParse()` so non-string or invalid JSON never throws; on parse failure return `{ raw: String(val) }`. Always respond with `Response.json({ ok: true, last_queue_ping, updated_at })` (200).
- **GET /api/debug/app_kv** – Use `Array.isArray(count?.results)` and safe first-row/count access; use `Array.isArray(rows?.results)` for rows.
- **Top-level catch** – Keep `console.error("FETCH_ERROR", err?.stack || err)` and return `Response.json({ ok: false, error: "Internal error" }, { status: 500 })` so uncaught errors are logged and return 500 instead of 1101.
- **GET /api/debug/version** – New endpoint: `ok: true`, `version: "2026-02-22T07:30Z-fix-result-1"`, `env: "dev"`, `hasBindings: { DB, RAW_BUCKET, COLLECT_QUEUE }`.
- **Health** – Use `Array.isArray(tables.results)` before mapping.
- **Shared** – Added `safeJsonParse(val)` and `DEPLOY_VERSION` constant.

No new dependencies; wrangler bindings and queue producer/consumer config unchanged.

## Proof: sample curl outputs

### GET /api/queue-test/result (status 200)

```
HTTP_CODE:200
{"ok":true,"last_queue_ping":{"receivedAt":"2026-02-22T07:29:13.614Z","body":{"type":"ping","at":"2026-02-22T07:29:07.260Z"}},"updated_at":"2026-02-22T07:29:13.614Z"}
```

### GET /api/debug/version (status 200)

```
HTTP_CODE:200
{"ok":true,"version":"2026-02-22T07:30Z-fix-result-1","env":"dev","hasBindings":{"DB":true,"RAW_BUCKET":true,"COLLECT_QUEUE":true}}
```

### Other endpoints (all 200)

- POST /api/queue-test – 200, `{"ok":true,"enqueued":{...}}`
- GET /api/debug/app_kv – 200, `{"ok":true,"count":1,"rows":[...]}`

Deployed with `wrangler deploy --env dev`; Worker version ID: 3dde030c-9a8d-4fba-aa3d-0f6df2790eb6.
