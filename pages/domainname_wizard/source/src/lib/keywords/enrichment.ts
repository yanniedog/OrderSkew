export const ENRICH_TIMEOUT_MS = 1800;
export const MAX_SEEDS = 6;
export const MAX_EXPANDED_TERMS = 12;
export const DATAMUSE_MAX_PER_QUERY = 20;
export const DATAMUSE_MAX_PER_SEED = 4;
export const WORDNIK_MAX_PER_SEED = 3;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "your",
  "from",
  "into",
  "onto",
  "that",
  "this",
  "those",
  "these",
  "you",
  "our",
  "their",
  "his",
  "her",
  "its",
  "they",
  "them",
  "have",
  "will",
  "are",
  "was",
  "were",
  "been",
  "being",
  "make",
  "made",
  "more",
  "most",
  "very",
  "just",
  "also",
  "about",
  "over",
  "under",
  "below",
  "above",
  "best",
  "good",
  "great",
  "new",
  "old",
  "now",
  "today",
  "brand",
  "company",
]);

const ALLOWED_WORDNIK_POS = new Set(["noun", "verb", "adjective"]);

type FetchLike = typeof fetch;

export interface ExpandedToken {
  token: string;
  seed: string;
  source: "datamuse-ml" | "datamuse-rel_syn" | "wordnik";
  score: number;
  frequency?: number;
  pos?: string[];
  lexicalRelationStrong?: boolean;
}

export interface KeywordEnrichmentResult {
  originalKeywords: string;
  expandedKeywords: string;
  usedDatamuse: boolean;
  usedWordnik: boolean;
  fallbackReason?: string;
  debug: {
    seedTokens: string[];
    selectedRelated: string[];
    rejected: string[];
  };
}

interface DatamuseWord {
  word?: string;
  score?: number;
  tags?: string[];
}

interface WordnikRelatedResponse {
  relationshipType?: string;
  words?: string[];
}

interface WordnikDefinition {
  partOfSpeech?: string;
}

export interface EnrichmentOptions {
  blacklist?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxSeeds?: number;
  maxExpandedTerms?: number;
  requestDelayMs?: number;
  requestJitterMs?: number;
  wordnikApiKey?: string;
}

interface InternalExpandOptions extends EnrichmentOptions {
  seedTokens: string[];
  blacklistSet: Set<string>;
  rejected: string[];
}

function normalizeToken(token: string): string {
  return token.toLowerCase().trim().replace(/[^a-z0-9]+/g, "");
}

function isDomainSafeToken(token: string): boolean {
  return /^[a-z0-9]+$/.test(token);
}

function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

function parseBlacklistSet(blacklist?: string): Set<string> {
  const entries = (blacklist ?? "")
    .split(/[,\s]+/)
    .map((value) => normalizeToken(value))
    .filter(Boolean);
  return new Set(entries);
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, reason: string): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(reason)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function seedProximityBoost(token: string, seeds: string[]): number {
  let best = 0;
  for (const seed of seeds) {
    if (!seed || token === seed) {
      continue;
    }
    if (token.includes(seed) || seed.includes(token)) {
      best = Math.max(best, 220);
      continue;
    }
    if (token.length >= 4 && seed.length >= 4 && token.slice(0, 3) === seed.slice(0, 3)) {
      best = Math.max(best, 120);
    }
  }
  return best;
}

function shouldRejectToken(token: string, ctx: { seeds: string[]; blacklist: Set<string>; rejected: string[] }): boolean {
  if (token.length < 3) {
    ctx.rejected.push(`${token}:too-short`);
    return true;
  }
  if (token.length > 24) {
    ctx.rejected.push(`${token}:too-long`);
    return true;
  }
  if (!isDomainSafeToken(token)) {
    ctx.rejected.push(`${token}:unsafe`);
    return true;
  }
  if (ctx.blacklist.has(token)) {
    ctx.rejected.push(`${token}:blacklist`);
    return true;
  }
  if (isStopword(token)) {
    ctx.rejected.push(`${token}:stopword`);
    return true;
  }
  if (ctx.seeds.includes(token)) {
    ctx.rejected.push(`${token}:seed-duplicate`);
    return true;
  }
  return false;
}

function rankAndCapBySeed(
  scored: ExpandedToken[],
  maxPerSeed: number,
  maxTotal: number,
): ExpandedToken[] {
  const grouped = new Map<string, ExpandedToken[]>();
  for (const item of scored) {
    const list = grouped.get(item.seed) ?? [];
    list.push(item);
    grouped.set(item.seed, list);
  }

  const perSeed: ExpandedToken[] = [];
  for (const entries of grouped.values()) {
    entries.sort((a, b) => b.score - a.score || a.token.localeCompare(b.token));
    perSeed.push(...entries.slice(0, maxPerSeed));
  }

  perSeed.sort((a, b) => b.score - a.score || a.token.localeCompare(b.token));
  return perSeed.slice(0, maxTotal);
}

export function tokenizeSeedKeywords(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(input ?? "").split(/[^a-zA-Z0-9]+/)) {
    const token = normalizeToken(raw);
    if (!token || token.length < 2 || token.length > 24 || seen.has(token)) {
      continue;
    }
    seen.add(token);
    out.push(token);
    if (out.length >= MAX_SEEDS) {
      break;
    }
  }
  return out;
}

async function fetchJsonSafe<T>(url: string, fetchImpl: FetchLike, rejected: string[]): Promise<T | null> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      rejected.push(`request-failed:${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    rejected.push(`request-error:${message}`);
    return null;
  }
}

export async function expandWithDatamuse(
  seeds: string[],
  options: EnrichmentOptions = {},
): Promise<ExpandedToken[]> {
  const seedTokens = seeds.slice(0, options.maxSeeds ?? MAX_SEEDS).map((seed) => normalizeToken(seed)).filter(Boolean);
  const ctx: InternalExpandOptions = {
    ...options,
    seedTokens,
    blacklistSet: parseBlacklistSet(options.blacklist),
    rejected: [],
  };
  return expandWithDatamuseInternal(ctx);
}

async function expandWithDatamuseInternal(options: InternalExpandOptions): Promise<ExpandedToken[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const deduped = new Map<string, ExpandedToken>();
  const baseDelay = options.requestDelayMs ?? 35;
  const jitterMax = options.requestJitterMs ?? 15;
  const maxTotal = options.maxExpandedTerms ?? MAX_EXPANDED_TERMS;

  for (const seed of options.seedTokens.slice(0, options.maxSeeds ?? MAX_SEEDS)) {
    const endpoints: Array<{ source: ExpandedToken["source"]; url: string; bonus: number }> = [
      {
        source: "datamuse-ml",
        url: `https://api.datamuse.com/words?ml=${encodeURIComponent(seed)}&max=${DATAMUSE_MAX_PER_QUERY}`,
        bonus: 0,
      },
      {
        source: "datamuse-rel_syn",
        url: `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(seed)}&max=${DATAMUSE_MAX_PER_QUERY}`,
        bonus: 140,
      },
    ];

    for (const endpoint of endpoints) {
      const payload = await fetchJsonSafe<DatamuseWord[]>(endpoint.url, fetchImpl, options.rejected);
      if (Array.isArray(payload)) {
        for (const row of payload) {
          const token = normalizeToken(row.word ?? "");
          if (!token) {
            continue;
          }
          if (
            shouldRejectToken(token, {
              seeds: options.seedTokens,
              blacklist: options.blacklistSet,
              rejected: options.rejected,
            })
          ) {
            continue;
          }

          const proximity = seedProximityBoost(token, options.seedTokens);
          const baseScore = Number.isFinite(row.score) ? Number(row.score) : 0;
          const score = baseScore + proximity + endpoint.bonus;
          const next: ExpandedToken = {
            token,
            seed,
            source: endpoint.source,
            score,
          };
          const existing = deduped.get(token);
          if (!existing || next.score > existing.score) {
            deduped.set(token, next);
          }
        }
      }

      const jitter = jitterMax > 0 ? Math.floor(Math.random() * (jitterMax + 1)) : 0;
      await delay(baseDelay + jitter);
    }
  }

  return rankAndCapBySeed(Array.from(deduped.values()), DATAMUSE_MAX_PER_SEED, maxTotal);
}

async function fetchWordnikPos(token: string, apiKey: string, fetchImpl: FetchLike): Promise<string[]> {
  const url = `https://api.wordnik.com/v4/word.json/${encodeURIComponent(token)}/definitions?limit=5&useCanonical=true&api_key=${encodeURIComponent(apiKey)}`;
  const payload = await fetchJsonSafe<WordnikDefinition[]>(url, fetchImpl, []);
  if (!Array.isArray(payload)) {
    return [];
  }
  const out = new Set<string>();
  for (const item of payload) {
    const pos = String(item?.partOfSpeech ?? "").toLowerCase().trim();
    if (pos) {
      out.add(pos);
    }
  }
  return Array.from(out);
}

async function fetchWordnikFrequency(token: string, apiKey: string, fetchImpl: FetchLike): Promise<number | undefined> {
  const currentYear = new Date().getUTCFullYear();
  const startYear = Math.max(currentYear - 8, 2016);
  const url = `https://api.wordnik.com/v4/word.json/${encodeURIComponent(token)}/frequency?startYear=${startYear}&endYear=${currentYear}&useCanonical=true&api_key=${encodeURIComponent(apiKey)}`;
  const payload = await fetchJsonSafe<{ totalCount?: number }>(url, fetchImpl, []);
  if (!payload || typeof payload.totalCount !== "number" || !Number.isFinite(payload.totalCount)) {
    return undefined;
  }
  return payload.totalCount;
}

export async function expandWithWordnik(
  seeds: string[],
  options: EnrichmentOptions = {},
): Promise<ExpandedToken[]> {
  const apiKey = (options.wordnikApiKey ?? "").trim();
  if (!apiKey) {
    return [];
  }

  const seedTokens = seeds.slice(0, options.maxSeeds ?? MAX_SEEDS).map((seed) => normalizeToken(seed)).filter(Boolean);
  const rejected: string[] = [];
  const blacklistSet = parseBlacklistSet(options.blacklist);
  const fetchImpl = options.fetchImpl ?? fetch;
  const deduped = new Map<string, ExpandedToken>();
  const maxTotal = options.maxExpandedTerms ?? MAX_EXPANDED_TERMS;
  const baseDelay = options.requestDelayMs ?? 35;
  const jitterMax = options.requestJitterMs ?? 15;

  for (const seed of seedTokens) {
    const url = `https://api.wordnik.com/v4/word.json/${encodeURIComponent(seed)}/relatedWords?relationshipTypes=synonym,equivalent,similar&limitPerRelationshipType=10&useCanonical=true&api_key=${encodeURIComponent(apiKey)}`;
    const payload = await fetchJsonSafe<WordnikRelatedResponse[]>(url, fetchImpl, rejected);
    if (!Array.isArray(payload)) {
      await delay(baseDelay);
      continue;
    }

    for (const relation of payload) {
      const relationType = String(relation?.relationshipType ?? "").toLowerCase();
      const strongLexicalRelation = relationType === "synonym" || relationType === "equivalent";
      const words = Array.isArray(relation?.words) ? relation.words : [];
      for (const rawWord of words.slice(0, 10)) {
        const token = normalizeToken(rawWord);
        if (!token) {
          continue;
        }
        if (shouldRejectToken(token, { seeds: seedTokens, blacklist: blacklistSet, rejected })) {
          continue;
        }

        const [pos, frequency] = await Promise.all([
          fetchWordnikPos(token, apiKey, fetchImpl),
          fetchWordnikFrequency(token, apiKey, fetchImpl),
        ]);
        if (pos.length > 0 && !pos.some((entry) => ALLOWED_WORDNIK_POS.has(entry))) {
          rejected.push(`${token}:pos-filter`);
          continue;
        }
        if (typeof frequency === "number" && frequency < 1) {
          rejected.push(`${token}:low-frequency`);
          continue;
        }

        const relationBonus = strongLexicalRelation ? 320 : 80;
        const frequencyBoost =
          typeof frequency === "number" && frequency > 0 ? Math.min(180, Math.log10(frequency + 1) * 55) : 0;
        const score = relationBonus + frequencyBoost + seedProximityBoost(token, seedTokens);

        const next: ExpandedToken = {
          token,
          seed,
          source: "wordnik",
          score,
          frequency,
          pos,
          lexicalRelationStrong: strongLexicalRelation,
        };
        const existing = deduped.get(token);
        if (!existing || next.score > existing.score) {
          deduped.set(token, next);
        }
      }
    }
    const jitter = jitterMax > 0 ? Math.floor(Math.random() * (jitterMax + 1)) : 0;
    await delay(baseDelay + jitter);
  }

  return rankAndCapBySeed(Array.from(deduped.values()), WORDNIK_MAX_PER_SEED, maxTotal);
}

export function buildExpandedKeywordString(
  seeds: string[],
  datamuseTokens: ExpandedToken[],
  wordnikTokens: ExpandedToken[],
  options: Pick<EnrichmentOptions, "maxExpandedTerms" | "blacklist"> = {},
): string {
  const normalizedSeeds = seeds.map((seed) => normalizeToken(seed)).filter(Boolean);
  const blacklistSet = parseBlacklistSet(options.blacklist);
  const maxExpanded = options.maxExpandedTerms ?? MAX_EXPANDED_TERMS;

  const merged = [...datamuseTokens, ...wordnikTokens]
    .filter((item) => !blacklistSet.has(item.token))
    .map((item) => {
      const priorityBoost = item.source === "wordnik" ? (item.lexicalRelationStrong ? 210 : -120) : 0;
      return {
        ...item,
        rankScore: item.score + priorityBoost,
      };
    })
    .sort((a, b) => b.rankScore - a.rankScore || a.token.localeCompare(b.token));

  const out: string[] = [];
  const seen = new Set<string>();

  for (const seed of normalizedSeeds) {
    if (seed.length < 2 || seen.has(seed) || blacklistSet.has(seed)) {
      continue;
    }
    seen.add(seed);
    out.push(seed);
  }

  let additions = 0;
  for (const candidate of merged) {
    if (additions >= maxExpanded) {
      break;
    }
    if (seen.has(candidate.token)) {
      continue;
    }
    seen.add(candidate.token);
    out.push(candidate.token);
    additions += 1;
  }

  return out.join(" ").trim();
}

export async function enrichKeywords(
  inputKeywords: string,
  options: EnrichmentOptions = {},
): Promise<KeywordEnrichmentResult> {
  const startedAt = Date.now();
  const originalKeywords = String(inputKeywords ?? "").trim();
  const seedTokens = tokenizeSeedKeywords(originalKeywords).slice(0, options.maxSeeds ?? MAX_SEEDS);
  const rejected: string[] = [];
  const blacklistSet = parseBlacklistSet(options.blacklist);
  const timeoutMs = options.timeoutMs ?? ENRICH_TIMEOUT_MS;
  const wordnikApiKey = (options.wordnikApiKey ?? "").trim();

  if (seedTokens.length === 0) {
    return {
      originalKeywords,
      expandedKeywords: originalKeywords,
      usedDatamuse: false,
      usedWordnik: false,
      fallbackReason: "No valid seed keywords after normalization.",
      debug: {
        seedTokens: [],
        selectedRelated: [],
        rejected,
      },
    };
  }

  try {
    const datamusePromise = expandWithDatamuseInternal({
      ...options,
      seedTokens,
      blacklistSet,
      rejected,
    });
    const datamuseTokens = await withTimeout(datamusePromise, timeoutMs, "Datamuse timeout");

    let wordnikTokens: ExpandedToken[] = [];
    if (wordnikApiKey) {
      wordnikTokens = await withTimeout(
        expandWithWordnik(seedTokens, {
          ...options,
          wordnikApiKey,
          blacklist: Array.from(blacklistSet).join(" "),
        }),
        timeoutMs,
        "Wordnik timeout",
      ).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Wordnik failed";
        rejected.push(`wordnik:${message}`);
        return [];
      });
    }

    const expandedKeywords = buildExpandedKeywordString(seedTokens, datamuseTokens, wordnikTokens, {
      maxExpandedTerms: options.maxExpandedTerms ?? MAX_EXPANDED_TERMS,
      blacklist: Array.from(blacklistSet).join(" "),
    });

    const fallbackReason =
      expandedKeywords.length < 2
        ? "Enrichment returned no usable terms."
        : datamuseTokens.length === 0 && wordnikTokens.length === 0
          ? "No related terms found; using normalized seed keywords."
          : undefined;

    const selectedRelated = expandedKeywords
      .split(/\s+/)
      .map((value) => normalizeToken(value))
      .filter((token) => token && !seedTokens.includes(token));

    const result: KeywordEnrichmentResult = {
      originalKeywords,
      expandedKeywords: expandedKeywords.length >= 2 ? expandedKeywords : originalKeywords,
      usedDatamuse: datamuseTokens.length > 0,
      usedWordnik: wordnikApiKey.length > 0 && wordnikTokens.length > 0,
      fallbackReason,
      debug: {
        seedTokens,
        selectedRelated,
        rejected,
      },
    };

    if (process.env.NODE_ENV !== "production") {
      const durationMs = Date.now() - startedAt;
      console.debug("keyword-enrichment", {
        durationMs,
        seeds: seedTokens.length,
        selected: selectedRelated.length,
        rejected: rejected.length,
        usedDatamuse: result.usedDatamuse,
        usedWordnik: result.usedWordnik,
        fallbackReason: result.fallbackReason,
      });
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "enrichment-error";
    rejected.push(`fatal:${message}`);
    return {
      originalKeywords,
      expandedKeywords: originalKeywords,
      usedDatamuse: false,
      usedWordnik: false,
      fallbackReason: message,
      debug: {
        seedTokens,
        selectedRelated: [],
        rejected,
      },
    };
  }
}
