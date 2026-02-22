export interface Env {
	DB: D1Database;
	RAW_BUCKET: R2Bucket;
	COLLECT_QUEUE: Queue;
}

const KV_KEY = "last_queue_ping";
const DEPLOY_VERSION = "2026-02-22T07:30Z-fix-result-1";

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

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);

		try {
			// Routes that need DB: validate binding so we return 500 JSON instead of 1101
			const needsDb =
				url.pathname === "/api/health" ||
				url.pathname === "/api/queue-test/result" ||
				url.pathname === "/api/debug/app_kv";
			if (needsDb && (env == null || (env as any).DB == null)) {
				console.error("FETCH_ERROR", "env or env.DB missing");
				return Response.json(
					{ ok: false, error: "DB binding missing" },
					{ status: 500 }
				);
			}

			if (url.pathname === "/api/health") {
				const tables = await env.DB.prepare(
					"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
				).all();

				const key = `health/${crypto.randomUUID()}.txt`;
				await env.RAW_BUCKET.put(key, "ok");
				await env.RAW_BUCKET.delete(key);

				return Response.json({
					ok: true,
					tables: Array.isArray(tables.results)
						? (tables.results as any[]).map((x: any) => (x as any)?.name)
						: [],
					r2: "ok",
					queue: "bound"
				});
			}

			if (url.pathname === "/api/queue-test" && req.method === "POST") {
				const payload = { type: "ping", at: nowIso() };
				await env.COLLECT_QUEUE.send(payload);
				return Response.json({ ok: true, enqueued: payload });
			}

			if (url.pathname === "/api/queue-test/result" && req.method === "GET") {
				let row: Record<string, unknown> | null = null;
				try {
					const r = await env.DB.prepare(
						"SELECT value, updated_at FROM app_kv WHERE key = ? LIMIT 1;"
					)
						.bind(KV_KEY)
						.all();
					const arr = Array.isArray(r?.results) ? r.results : [];
					const first = arr.length > 0 ? arr[0] : null;
					if (first != null && typeof first === "object" && !Array.isArray(first)) {
						row = first as Record<string, unknown>;
					}
				} catch (d1Err: any) {
					console.error("FETCH_ERROR", "queue-test/result D1", d1Err?.stack || d1Err);
					return Response.json(
						{ ok: true, last_queue_ping: null, updated_at: null, error: "query failed" },
						{ status: 200 }
					);
				}

				const rawValue = row && "value" in row ? row.value : undefined;
				const { parsed } = safeJsonParse(rawValue);
				const updatedAt =
					row != null && "updated_at" in row ? (row.updated_at as string | null) : null;

				return Response.json({
					ok: true,
					last_queue_ping: parsed ?? null,
					updated_at: updatedAt ?? null
				});
			}

			if (url.pathname === "/api/debug/app_kv" && req.method === "GET") {
				const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM app_kv;").all();
				const rows = await env.DB.prepare(
					"SELECT key, updated_at, substr(value,1,120) AS value_prefix FROM app_kv ORDER BY updated_at DESC LIMIT 5;"
				).all();

				const countArr = Array.isArray(count?.results) ? count.results : [];
				const firstCount = countArr.length > 0 ? countArr[0] : null;
				const c =
					firstCount != null && typeof firstCount === "object" && "c" in firstCount
						? (firstCount as any).c
						: null;

				return Response.json({
					ok: true,
					count: c,
					rows: Array.isArray(rows?.results) ? rows.results : []
				});
			}

			if (url.pathname === "/api/debug/version" && req.method === "GET") {
				const hasBindings = {
					DB: !!(env != null && (env as any).DB != null),
					RAW_BUCKET: !!(env != null && (env as any).RAW_BUCKET != null),
					COLLECT_QUEUE: !!(env != null && (env as any).COLLECT_QUEUE != null)
				};
				return Response.json({
					ok: true,
					version: DEPLOY_VERSION,
					env: "dev",
					hasBindings
				});
			}

			return new Response("Not Found", { status: 404 });
		} catch (err: any) {
			console.error("FETCH_ERROR", err?.stack || err);
			return Response.json(
				{ ok: false, error: "Internal error" },
				{ status: 500 }
			);
		}
	},
  
	async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
	  for (const m of batch.messages) {
		try {
		  const record = {
			receivedAt: nowIso(),
			body: m.body
		  };
  
		  await env.DB.prepare(
			"INSERT OR REPLACE INTO app_kv (key, value, updated_at) VALUES (?, ?, ?);"
		  )
			.bind(KV_KEY, JSON.stringify(record), nowIso())
			.run();
  
		  m.ack();
		} catch (err: any) {
		  console.error("QUEUE_ERROR", err?.stack || err);
		  // Let retry happen if something is genuinely broken
		  m.retry();
		}
	  }
	}
  };