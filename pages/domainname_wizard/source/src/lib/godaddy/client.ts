import { runGoDaddyQueued, sleep } from "@/lib/rate-limit";

export class GoDaddyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoDaddyAuthError";
  }
}

export class GoDaddyRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoDaddyRateLimitError";
  }
}

export class GoDaddyApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoDaddyApiError";
  }
}

interface GoDaddyDomainAvailableResponse {
  domain: string;
  available: boolean;
  definitive: boolean;
  price?: number;
  currency?: string;
  period?: number;
}

interface GoDaddyDomainError {
  code: string;
  domain: string;
  message?: string;
  status?: number;
}

interface GoDaddyBulkResponse {
  domains?: GoDaddyDomainAvailableResponse[];
  errors?: GoDaddyDomainError[];
}

export interface GoDaddyAvailability {
  domain: string;
  available: boolean;
  definitive: boolean;
  priceMicros?: number;
  currency?: string;
  period?: number;
  reason?: string;
}

const CHUNK_SIZE = 100;
const MAX_RETRIES = 4;
const GODADDY_PROD_BASE_URL = "https://api.godaddy.com";
const GODADDY_OTE_BASE_URL = "https://api.ote-godaddy.com";

function readEnvValue(env: NodeJS.ProcessEnv, keys: string[]): string {
  for (const key of keys) {
    const raw = env[key];
    if (typeof raw !== "string") {
      continue;
    }
    const value = raw.trim().replace(/^['"]|['"]$/g, "");
    if (value) {
      return value;
    }
  }
  return "";
}

export function chunkDomains(domains: string[], chunkSize: number = CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];

  for (let index = 0; index < domains.length; index += chunkSize) {
    chunks.push(domains.slice(index, index + chunkSize));
  }

  return chunks;
}

export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const mode = readEnvValue(env, ["GODADDY_ENV", "GODADDY_API_ENV"]).toUpperCase() || "OTE";
  if (mode === "PROD" || mode === "PRODUCTION" || mode === "LIVE") {
    return GODADDY_PROD_BASE_URL;
  }
  return GODADDY_OTE_BASE_URL;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsedSeconds = Number(value);
  if (Number.isFinite(parsedSeconds) && parsedSeconds >= 0) {
    return parsedSeconds * 1000;
  }

  const dateValue = Date.parse(value);
  if (Number.isFinite(dateValue)) {
    return Math.max(0, dateValue - Date.now());
  }

  return null;
}

async function requestAvailabilityChunk(domains: string[]): Promise<GoDaddyBulkResponse> {
  const apiKey = readEnvValue(process.env, ["GODADDY_API_KEY", "GODADDY_KEY"]);
  const apiSecret = readEnvValue(process.env, ["GODADDY_API_SECRET", "GODADDY_SECRET"]);

  if (!apiKey || !apiSecret) {
    throw new GoDaddyAuthError(
      "Missing GoDaddy API credentials. Set GODADDY_API_KEY/GODADDY_API_SECRET (or GODADDY_KEY/GODADDY_SECRET).",
    );
  }

  const endpoint = `${resolveBaseUrl()}/v1/domains/available?checkType=FAST`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `sso-key ${apiKey}:${apiSecret}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(domains),
      cache: "no-store",
    });

    if (response.status === 429) {
      if (attempt >= MAX_RETRIES) {
        throw new GoDaddyRateLimitError("GoDaddy rate limit reached and retry attempts were exhausted.");
      }

      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
      const fallbackBackoffMs = (2 ** attempt) * 1000 + Math.floor(Math.random() * 500);
      await sleep(retryAfterMs ?? fallbackBackoffMs);
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new GoDaddyAuthError(`GoDaddy authentication failed with status ${response.status}.`);
    }

    if (!response.ok) {
      const responseBody = await response.text();
      throw new GoDaddyApiError(
        `GoDaddy availability request failed (${response.status}). ${responseBody.slice(0, 300)}`,
      );
    }

    return (await response.json()) as GoDaddyBulkResponse;
  }

  throw new GoDaddyRateLimitError("GoDaddy rate limit retries were exhausted.");
}

export async function checkAvailabilityBulk(domains: string[]): Promise<Map<string, GoDaddyAvailability>> {
  const normalized = Array.from(new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean)));
  const chunks = chunkDomains(normalized, CHUNK_SIZE);
  const resultMap = new Map<string, GoDaddyAvailability>();

  await Promise.all(
    chunks.map((chunk) =>
      runGoDaddyQueued(async () => {
        const payload = await requestAvailabilityChunk(chunk);

        for (const domainInfo of payload.domains ?? []) {
          resultMap.set(domainInfo.domain.toLowerCase(), {
            domain: domainInfo.domain.toLowerCase(),
            available: Boolean(domainInfo.available),
            definitive: Boolean(domainInfo.definitive),
            priceMicros: typeof domainInfo.price === "number" ? domainInfo.price : undefined,
            currency: domainInfo.currency,
            period: domainInfo.period,
          });
        }

        for (const errorInfo of payload.errors ?? []) {
          resultMap.set(errorInfo.domain.toLowerCase(), {
            domain: errorInfo.domain.toLowerCase(),
            available: false,
            definitive: false,
            reason: errorInfo.message ?? errorInfo.code,
          });
        }
      }),
    ),
  );

  for (const domain of normalized) {
    if (!resultMap.has(domain)) {
      resultMap.set(domain, {
        domain,
        available: false,
        definitive: false,
        reason: "No availability response returned for this domain.",
      });
    }
  }

  return resultMap;
}
