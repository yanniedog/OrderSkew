/**
 * CDR Register discovery: fetch banking register, parse brands, cache endpoints.
 * Never throws; returns outcome for run_reports and queue retry decisions.
 */

import { resolveLenderKey } from "./config/lenders";

const CDR_REGISTER_URL = "https://api.cdr.gov.au/cdr-register/v1/banking/register";
const LOCK_TTL_HOURS = 6;

export interface DiscoveryResult {
  ok: boolean;
  runId: string;
  error?: string;
  perLenderCounts?: Record<string, number>;
  warnings?: string[];
}

interface EndpointDetail {
  publicBaseUri?: string;
  resourceBaseUri?: string;
  version?: string;
}

interface LegalEntity {
  legalEntityName?: string;
}

interface RegisterBrand {
  dataHolderBrandId?: string;
  brandName?: string;
  legalEntity?: LegalEntity;
  endpointDetail?: EndpointDetail;
  status?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeBaseUrl(url: string): string {
  let u = (url || "").trim();
  if (!u) return "";
  try {
    const parsed = new URL(u);
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.origin + parsed.pathname;
  } catch {
    return u.replace(/\/+$/, "");
  }
}

function deriveProductsUrl(apiBaseUrl: string): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  return base ? `${base}/cds-au/v1/banking/products` : "";
}

/** Compute run date in Australia/Hobart (YYYY-MM-DD). */
export function runDateHobart(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Hobart",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

/** Acquire run lock; returns runId if acquired, null if already locked. */
export async function acquireRunLock(
  db: D1Database,
  lockKey: string,
  ttlHours: number = LOCK_TTL_HOURS
): Promise<{ acquired: boolean; runId?: string }> {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const runId = `run-${lockKey}-${now.getTime()}`;
  const nowStr = now.toISOString();
  const expiresStr = expires.toISOString();

  try {
    const existing = await db
      .prepare("SELECT lock_key, expires_at FROM run_locks WHERE lock_key = ?")
      .bind(lockKey)
      .first<{ lock_key: string; expires_at: string }>();

    if (existing) {
      const exp = existing.expires_at;
      if (exp && new Date(exp) > now) {
        return { acquired: false };
      }
    }

    await db
      .prepare(
        "INSERT OR REPLACE INTO run_locks (lock_key, run_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
      )
      .bind(lockKey, runId, nowStr, expiresStr)
      .run();

    return { acquired: true, runId };
  } catch (e) {
    console.error("acquireRunLock", e);
    return { acquired: false };
  }
}

/** Persist raw register payload and return content hash. */
async function saveRawPayload(
  db: D1Database,
  payloadJson: string,
  fetchedAt: string
): Promise<string> {
  const id = `cdr_register_${fetchedAt.replace(/[:.]/g, "-")}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payloadJson);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  try {
    await db
      .prepare(
        "INSERT INTO raw_payloads (id, source_type, fetched_at, source_url, content_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(id, "cdr_register", fetchedAt, CDR_REGISTER_URL, hashHex, payloadJson)
      .run();
  } catch (e) {
    console.error("saveRawPayload", e);
  }
  return hashHex;
}

/** Upsert one brand into lender_endpoints_cache. */
async function upsertEndpoint(
  db: D1Database,
  row: {
    lender_key: string;
    brand_id: string;
    brand_name: string;
    api_base_url: string;
    products_url: string;
    product_reference_data_api: string;
    last_seen_at: string;
    raw_json: string;
  }
): Promise<void> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO lender_endpoints_cache (
          lender_key, brand_id, brand_name, api_base_url, products_url,
          product_reference_data_api, discovered_at, expires_at, last_seen_at, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(lender_key, brand_id) DO UPDATE SET
          brand_name = excluded.brand_name,
          api_base_url = excluded.api_base_url,
          products_url = excluded.products_url,
          product_reference_data_api = excluded.product_reference_data_api,
          last_seen_at = excluded.last_seen_at,
          raw_json = excluded.raw_json`
      )
      .bind(
        row.lender_key,
        row.brand_id,
        row.brand_name,
        row.api_base_url,
        row.products_url,
        row.product_reference_data_api,
        row.last_seen_at,
        expiresAt,
        row.last_seen_at,
        row.raw_json
      )
      .run();
  } catch (e) {
    console.error("upsertEndpoint", e);
    throw e;
  }
}

/** Fetch CDR register, parse brands, upsert into lender_endpoints_cache and raw_payloads. */
export async function discoverCdrRegister(
  db: D1Database,
  runId: string
): Promise<DiscoveryResult> {
  const startedAt = nowIso();
  const warnings: string[] = [];
  const perLenderCounts: Record<string, number> = {};

  try {
    const resp = await fetch(CDR_REGISTER_URL, {
      headers: { Accept: "application/json" },
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("discoverCdrRegister fetch", resp.status, text?.slice(0, 500));
      await updateRunReport(db, runId, "failed", startedAt, null, [
        `Fetch failed: ${resp.status} ${text?.slice(0, 200)}`,
      ]);
      return { ok: false, runId, error: `HTTP ${resp.status}` };
    }

    const rawText = await resp.text();
    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      console.error("discoverCdrRegister parse", e);
      await updateRunReport(db, runId, "failed", startedAt, null, [
        "Invalid JSON from CDR register",
      ]);
      return { ok: false, runId, error: "JSON parse error" };
    }

    await saveRawPayload(db, rawText, startedAt);

    const brands = extractBrands(data);
    if (brands.length === 0) {
      warnings.push("No data holder brands found in register response");
    }

    const lastSeen = nowIso();
    for (const b of brands) {
      const publicUri = b.endpointDetail?.publicBaseUri ?? b.endpointDetail?.resourceBaseUri ?? "";
      if (!publicUri) {
        warnings.push(`No endpoint for brand ${b.dataHolderBrandId ?? b.brandName ?? "?"}`);
        continue;
      }

      const apiBaseUrl = normalizeBaseUrl(publicUri);
      const productsUrl = deriveProductsUrl(apiBaseUrl);
      const brandName = (b.brandName ?? "").trim() || "Unknown";
      const legalName = b.legalEntity?.legalEntityName ?? "";
      const lenderKey = resolveLenderKey(brandName, legalName);
      const brandId = (b.dataHolderBrandId ?? `${lenderKey}-${brandName}`).trim() || "unknown";

      perLenderCounts[lenderKey] = (perLenderCounts[lenderKey] ?? 0) + 1;

      try {
        await upsertEndpoint(db, {
          lender_key: lenderKey,
          brand_id: brandId,
          brand_name: brandName,
          api_base_url: apiBaseUrl,
          products_url: productsUrl,
          product_reference_data_api: apiBaseUrl,
          last_seen_at: lastSeen,
          raw_json: JSON.stringify({
            dataHolderBrandId: b.dataHolderBrandId,
            brandName: b.brandName,
            legalEntityName: legalName,
            status: b.status,
          }),
        });
      } catch (e) {
        console.error("upsertEndpoint", brandId, e);
        warnings.push(`Failed to upsert ${brandId}: ${(e as Error)?.message}`);
      }
    }

    const status = warnings.length > 0 ? "completed_with_warnings" : "completed";
    await updateRunReport(db, runId, status, startedAt, perLenderCounts, warnings);

    return {
      ok: true,
      runId,
      perLenderCounts,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error("discoverCdrRegister", e);
    await updateRunReport(db, runId, "failed", startedAt, null, [msg]);
    return { ok: false, runId, error: msg };
  }
}

function extractBrands(data: unknown): RegisterBrand[] {
  if (Array.isArray(data)) return data as RegisterBrand[];
  if (data != null && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data as RegisterBrand[];
    if (Array.isArray(o.dataHolderBrands)) return o.dataHolderBrands as RegisterBrand[];
    if (Array.isArray(o.brands)) return o.brands as RegisterBrand[];
    if (Array.isArray(o.dataHolderBrandsSummary)) return o.dataHolderBrandsSummary as RegisterBrand[];
  }
  return [];
}

async function updateRunReport(
  db: D1Database,
  runId: string,
  status: string,
  startedAt: string,
  perLenderJson: Record<string, number> | null,
  errorsJson: string[]
): Promise<void> {
  const finishedAt = nowIso();
  try {
    await db
      .prepare(
        "UPDATE run_reports SET status = ?, finished_at = ?, per_lender_json = ?, errors_json = ? WHERE run_id = ?"
      )
      .bind(
        status,
        finishedAt,
        perLenderJson ? JSON.stringify(perLenderJson) : null,
        errorsJson.length > 0 ? JSON.stringify(errorsJson) : null,
        runId
      )
      .run();
  } catch (e) {
    console.error("updateRunReport", e);
  }
}

/** Create run_reports row for a run (scheduled or manual). */
export async function insertRunReport(
  db: D1Database,
  runId: string,
  runType: string,
  lockKey?: string
): Promise<void> {
  const startedAt = nowIso();
  try {
    await db
      .prepare(
        "INSERT OR REPLACE INTO run_reports (run_id, run_type, started_at, status) VALUES (?, ?, ?, ?)"
      )
      .bind(runId, runType, startedAt, "running")
      .run();
  } catch (e) {
    console.error("insertRunReport", e);
  }
}
