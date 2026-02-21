import { NextResponse } from "next/server";

import { checkAvailabilityBulk } from "@/lib/godaddy/client";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200, headers = {}) {
  return NextResponse.json(data, {
    status,
    headers: { ...CORS_HEADERS, ...headers },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const domains = Array.isArray(body.domains)
      ? (body.domains as string[]).filter((d) => typeof d === "string" && d.trim().length > 0)
      : [];

    if (domains.length === 0) {
      return json({ code: "INVALID_REQUEST", message: "domains must be a non-empty string array." }, 400);
    }

    if (domains.length > 100) {
      return json({ code: "INVALID_REQUEST", message: "At most 100 domains per request." }, 400);
    }

    const map = await checkAvailabilityBulk(domains);
    const results: Record<
      string,
      { available: boolean; definitive: boolean; price?: number; currency?: string; period?: number; reason?: string }
    > = {};

    for (const [domain, entry] of map) {
      const price =
        entry.priceMicros != null && Number.isFinite(entry.priceMicros)
          ? Number(Number(entry.priceMicros).toFixed(2))
          : undefined;
      results[domain] = {
        available: entry.available,
        definitive: entry.definitive,
        price: price !== undefined && Number.isFinite(price) ? price : undefined,
        currency: entry.currency,
        period: entry.period,
        reason: entry.reason,
      };
    }

    return json({ results });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "Availability check failed.";
    if (name === "GoDaddyAuthError") {
      return json({ code: "GODADDY_AUTH", message }, 502);
    }
    if (name === "GoDaddyRateLimitError") {
      return json({ code: "GODADDY_RATE_LIMIT", message }, 429);
    }
    if (name === "GoDaddyApiError") {
      return json({ code: "GODADDY_API", message }, 502);
    }
    return json({ code: "INTERNAL_ERROR", message }, 500);
  }
}
