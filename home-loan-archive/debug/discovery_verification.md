# Discovery verification (Phase 1)

Verification run after deploy to `home-loan-archive-dev` (2026-02-22).

## Commands run

1. `POST /api/admin/cdr/discover` – enqueue manual discovery
2. Wait 10–30s
3. `GET /api/admin/cdr/endpoints`
4. `GET /api/admin/runs?limit=5`
5. `GET /api/debug/version`
6. `POST /api/queue-test` and `GET /api/queue-test/result`
7. `GET /api/health`

## Results

### GET /api/debug/version
- **Status**: 200
- **Body**: `{"ok":true,"version":"2026-02-22-phase1-discovery","workerName":"home-loan-archive-dev","hasBindings":{"DB":true,"RAW_BUCKET":true,"COLLECT_QUEUE":true}}`

### POST /api/admin/cdr/discover
- **Status**: 200
- **Body**: `{"ok":true,"enqueued":{"type":"discover_cdr_register","runId":"manual-2026-02-22T07-49-10-297Z","at":"2026-02-22T07:49:10.343Z","manual":true}}`

### GET /api/admin/cdr/endpoints?limit=10 (after ~20s)
- **Status**: 200
- **Body**: `{"ok":true,"count":0,"rows":[]}`
- **Note**: Count 0 because the CDR register API returned HTTP 500 for this run; discovery correctly recorded the failure and did not populate the cache.

### GET /api/admin/runs?limit=5
- **Status**: 200
- **Body**: `{"ok":true,"count":1,"runs":[{"run_id":"manual-2026-02-22T07-49-10-297Z","run_type":"manual_discover","started_at":"2026-02-22T07:49:10.297Z","finished_at":"2026-02-22T07:49:21.191Z","status":"failed","per_lender_json":null,"errors_json":"[\"Fetch failed: 500 \"]"}]}`
- **Summary**: Manual discover run was recorded; status `failed` with error "Fetch failed: 500" (upstream CDR API 500).

### GET /api/admin/lenders
- **Status**: 200
- **Body**: Lenders list with keys: cba, westpac, nab, anz, macquarie, bendigo, suncorp, bankwest, ing, amp; each with displayName and aliases where applicable.

### POST /api/queue-test and GET /api/queue-test/result
- **POST**: 200, `{"ok":true,"enqueued":{"type":"ping","at":"..."}}`
- **GET**: 200, `last_queue_ping` and `updated_at` populated (queue consumer wrote to app_kv).

### GET /api/health
- **Status**: 200
- **Body**: `{"ok":true,"tables":["_cf_KV","app_kv","d1_migrations","lender_endpoints_cache","raw_payloads","run_locks","run_reports","sqlite_sequence"],"r2":"ok","queue":"bound"}`

## Summary

- All admin and debug endpoints return JSON and expected status codes.
- Manual discover enqueues and is processed; run_reports shows the run with status and errors (failure due to CDR API 500).
- Queue ping path works; consumer updates app_kv.
- No 1101; errors are returned as JSON and logged.
- When the CDR register API returns 200, discovery will populate `lender_endpoints_cache` and `raw_payloads`; re-run POST /api/admin/cdr/discover when the API is healthy to verify cache population.

---

## Upgrade: retry, fallback, failure capture, health (2026-02-22)

### Changes
- **Retry**: Up to 3 attempts per URL with delay (1.5s * attempt); 20s fetch timeout.
- **Fallback**: Primary `.../banking/register`, fallback `.../banking/data-holders/brands`; tries fallback when primary returns non-2xx.
- **Failure payload capture**: On non-2xx or parse error, row in `raw_payloads` with `source_type='cdr_register_failure'`, `http_status`, `payload_json` (truncated to 50k).
- **Run statuses**: `completed`, `completed_with_warnings`, `partial` (some brands upserted), `failed`, `failed_payload_captured`.
- **GET /api/admin/cdr/health**: Returns `lastRun`, `cachedEndpointsCount`, `lastSuccessAt`, `statusCounts`.

### Verification
- **GET /api/admin/cdr/health**: 200, `{"ok":true,"lastRun":{...},"cachedEndpointsCount":0,"lastSuccessAt":null,"statusCounts":{"failed":1,"failed_payload_captured":1}}`.
- **POST /api/admin/cdr/discover** then wait ~45s: new run has `status: "failed_payload_captured"`, `errors_json: ["Fetch failed: 500 from last attempted URL"]` (primary and fallback tried).
- **GET /api/admin/runs**: Both runs visible; latest shows `failed_payload_captured`.
- **GET /api/debug/version**: `version": "2026-02-22-discovery-retry-health"`.
