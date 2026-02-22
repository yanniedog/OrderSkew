import {
  acquireRunLock,
  discoverCdrRegister,
  insertRunReport,
  runDateHobart,
} from "./discovery";
import { LENDER_KEYS, LENDERS } from "./config/lenders";

export interface Env {
  DB: D1Database;
  RAW_BUCKET: R2Bucket;
  COLLECT_QUEUE: Queue;
}

const KV_KEY = "last_queue_ping";
const DEPLOY_VERSION = "2026-02-22-phase1-discovery";
const WORKER_NAME = "home-loan-archive-dev";

function nowIso(): string {
  return new Date().toISOString();
}

function safeJsonParse(val: unknown): { parsed: unknown; ok: boolean } {
  try {
    if (val == null) return { parsed: null, ok: true };
    if (typeof val === "string") return { parsed: JSON.parse(val), ok: true };
    return { parsed: { raw: String(val) }, ok: false };
  } catch {
    return { parsed: { raw: String(val) }, ok: false };
  }
}

function jsonResponse(body: object, status = 200): Response {
  return Response.json(body, { status });
}

function errorResponse(errorId: string, error: string, status = 500): Response {
  return jsonResponse({ ok: false, errorId, error }, status);
}

/** GET /api/admin/lenders */
function handleAdminLenders(): Response {
  try {
    const lenders = LENDER_KEYS.map((key) => ({
      key,
      displayName: LENDERS[key].displayName,
      aliases: LENDERS[key].aliases ?? [],
    }));
    return jsonResponse({ ok: true, lenders });
  } catch (e: unknown) {
    console.error("FETCH_ERROR", "admin/lenders", (e as Error)?.stack ?? e);
    return errorResponse("admin_lenders", "Internal error");
  }
}

/** GET /api/admin/cdr/endpoints?lender_key=&limit= */
async function handleAdminCdrEndpoints(
  env: Env,
  url: URL
): Promise<Response> {
  try {
    const lenderKey = url.searchParams.get("lender_key") ?? "";
    const limit = Math.min(
      1000,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "200", 10) || 200)
    );
    const r = lenderKey
      ? await env.DB.prepare(
          "SELECT lender_key, brand_id, brand_name, api_base_url, products_url, last_seen_at FROM lender_endpoints_cache WHERE lender_key = ? LIMIT ?"
        )
          .bind(lenderKey, limit)
          .all()
      : await env.DB.prepare(
          "SELECT lender_key, brand_id, brand_name, api_base_url, products_url, last_seen_at FROM lender_endpoints_cache ORDER BY last_seen_at DESC LIMIT ?"
        )
          .bind(limit)
          .all();
    const rows = Array.isArray((r as any)?.results) ? (r as any).results : [];
    return jsonResponse({ ok: true, count: rows.length, rows });
  } catch (e: unknown) {
    console.error("FETCH_ERROR", "admin/cdr/endpoints", (e as Error)?.stack ?? e);
    return errorResponse("admin_cdr_endpoints", "Internal error");
  }
}

/** POST /api/admin/cdr/discover - enqueue manual discovery */
async function handleAdminCdrDiscover(env: Env): Promise<Response> {
  try {
    const runId = `manual-${nowIso().replace(/[:.]/g, "-")}`;
    await insertRunReport(env.DB, runId, "manual_discover");
    const payload = {
      type: "discover_cdr_register",
      runId,
      at: nowIso(),
      manual: true,
    };
    await env.COLLECT_QUEUE.send(payload);
    return jsonResponse({ ok: true, enqueued: payload });
  } catch (e: unknown) {
    console.error("FETCH_ERROR", "admin/cdr/discover", (e as Error)?.stack ?? e);
    return errorResponse("admin_cdr_discover", "Internal error");
  }
}

/** GET /api/admin/runs?limit= */
async function handleAdminRuns(env: Env, url: URL): Promise<Response> {
  try {
    const limit = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20)
    );
    const r = await env.DB.prepare(
      "SELECT run_id, run_type, started_at, finished_at, status, per_lender_json, errors_json FROM run_reports ORDER BY started_at DESC LIMIT ?"
    )
      .bind(limit)
      .all();
    const rows = Array.isArray((r as any)?.results) ? (r as any).results : [];
    return jsonResponse({ ok: true, count: rows.length, runs: rows });
  } catch (e: unknown) {
    console.error("FETCH_ERROR", "admin/runs", (e as Error)?.stack ?? e);
    return errorResponse("admin_runs", "Internal error");
  }
}

/** GET /api/debug/version */
function handleDebugVersion(env: Env): Response {
  const hasBindings = {
    DB: !!(env?.DB != null),
    RAW_BUCKET: !!(env?.RAW_BUCKET != null),
    COLLECT_QUEUE: !!(env?.COLLECT_QUEUE != null),
  };
  return jsonResponse({
    ok: true,
    version: DEPLOY_VERSION,
    workerName: WORKER_NAME,
    hasBindings,
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/api/health") {
        if (env?.DB == null) {
          console.error("FETCH_ERROR", "env or env.DB missing");
          return errorResponse("health", "DB binding missing");
        }
        const tables = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
        ).all();
        const key = `health/${crypto.randomUUID()}.txt`;
        await env.RAW_BUCKET.put(key, "ok");
        await env.RAW_BUCKET.delete(key);
        return jsonResponse({
          ok: true,
          tables: Array.isArray((tables as any)?.results)
            ? (tables as any).results.map((x: any) => x?.name)
            : [],
          r2: "ok",
          queue: "bound",
        });
      }

      if (url.pathname === "/api/queue-test" && req.method === "POST") {
        const payload = { type: "ping", at: nowIso() };
        await env.COLLECT_QUEUE.send(payload);
        return jsonResponse({ ok: true, enqueued: payload });
      }

      if (url.pathname === "/api/queue-test/result" && req.method === "GET") {
        if (env?.DB == null) {
          return jsonResponse({
            ok: true,
            last_queue_ping: null,
            updated_at: null,
            error: "DB missing",
          });
        }
        let row: Record<string, unknown> | null = null;
        try {
          const r = await env.DB.prepare(
            "SELECT value, updated_at FROM app_kv WHERE key = ? LIMIT 1;"
          )
            .bind(KV_KEY)
            .all();
          const arr = Array.isArray((r as any)?.results) ? (r as any).results : [];
          const first = arr.length > 0 ? arr[0] : null;
          if (first != null && typeof first === "object" && !Array.isArray(first)) {
            row = first as Record<string, unknown>;
          }
        } catch (d1Err: unknown) {
          console.error("FETCH_ERROR", "queue-test/result D1", (d1Err as Error)?.stack ?? d1Err);
          return jsonResponse({
            ok: true,
            last_queue_ping: null,
            updated_at: null,
            error: "query failed",
          });
        }
        const rawValue = row && "value" in row ? row.value : undefined;
        const { parsed } = safeJsonParse(rawValue);
        const updatedAt =
          row != null && "updated_at" in row ? (row.updated_at as string | null) : null;
        return jsonResponse({
          ok: true,
          last_queue_ping: parsed ?? null,
          updated_at: updatedAt ?? null,
        });
      }

      if (url.pathname === "/api/debug/app_kv" && req.method === "GET") {
        const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM app_kv;").all();
        const rows = await env.DB.prepare(
          "SELECT key, updated_at, substr(value,1,120) AS value_prefix FROM app_kv ORDER BY updated_at DESC LIMIT 5;"
        ).all();
        const countArr = Array.isArray((count as any)?.results) ? (count as any).results : [];
        const firstCount = countArr.length > 0 ? countArr[0] : null;
        const c =
          firstCount != null && typeof firstCount === "object" && "c" in firstCount
            ? (firstCount as any).c
            : null;
        return jsonResponse({
          ok: true,
          count: c,
          rows: Array.isArray((rows as any)?.results) ? (rows as any).results : [],
        });
      }

      if (url.pathname === "/api/debug/version" && req.method === "GET") {
        return handleDebugVersion(env);
      }

      if (url.pathname === "/api/admin/lenders" && req.method === "GET") {
        return handleAdminLenders();
      }

      if (url.pathname === "/api/admin/cdr/endpoints" && req.method === "GET") {
        return handleAdminCdrEndpoints(env, url);
      }

      if (url.pathname === "/api/admin/cdr/discover" && req.method === "POST") {
        return handleAdminCdrDiscover(env);
      }

      if (url.pathname === "/api/admin/runs" && req.method === "GET") {
        return handleAdminRuns(env, url);
      }

      return new Response("Not Found", { status: 404 });
    } catch (err: unknown) {
      const errorId = `fetch-${Date.now()}`;
      console.error("FETCH_ERROR", { errorId, stack: (err as Error)?.stack, err });
      return errorResponse(errorId, "Internal error");
    }
  },

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const runDate = runDateHobart();
          const lockKey = `daily:${runDate}`;
          const { acquired, runId } = await acquireRunLock(env.DB, lockKey);
          if (!acquired || !runId) {
            console.error("scheduled", "lock not acquired", { lockKey });
            return;
          }
          await insertRunReport(env.DB, runId, "daily", lockKey);
          const payload = {
            type: "discover_cdr_register",
            runId,
            at: nowIso(),
            lockKey,
          };
          await env.COLLECT_QUEUE.send(payload);
          console.error("scheduled", "enqueued", { runId, lockKey });
        } catch (e: unknown) {
          console.error("scheduled", (e as Error)?.stack ?? e);
        }
      })()
    );
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const m of batch.messages) {
      try {
        const body = m.body as Record<string, unknown>;
        const msgType = (body?.type as string) ?? "unknown";

        if (msgType === "ping") {
          const record = { receivedAt: nowIso(), body: m.body };
          await env.DB.prepare(
            "INSERT OR REPLACE INTO app_kv (key, value, updated_at) VALUES (?, ?, ?);"
          )
            .bind(KV_KEY, JSON.stringify(record), nowIso())
            .run();
          m.ack();
          continue;
        }

        if (msgType === "discover_cdr_register") {
          const runId = (body.runId as string) ?? `unknown-${Date.now()}`;
          const result = await discoverCdrRegister(env.DB, runId);
          if (result.ok) {
            m.ack();
          } else {
            const transient =
              result.error != null &&
              (result.error.includes("HTTP 5") ||
                result.error.includes("fetch") ||
                result.error.includes("network"));
            if (transient) {
              console.error("QUEUE_ERROR", { runId, type: msgType, error: result.error });
              m.retry();
            } else {
              console.error("QUEUE_ERROR", { runId, type: msgType, error: result.error });
              m.ack();
            }
          }
          continue;
        }

        console.error("QUEUE_ERROR", { type: msgType, body: m.body });
        m.ack();
      } catch (err: unknown) {
        console.error("QUEUE_ERROR", { stack: (err as Error)?.stack, err });
        m.retry();
      }
    }
  },
};
