import { enrichKeywords, type EnrichmentOptions, type KeywordEnrichmentResult } from "@/lib/keywords/enrichment";
import type { RandomnessValue, StyleValue } from "@/lib/types";

export interface SearchFormPayload {
  keywords: string;
  description: string;
  style: StyleValue;
  randomness: RandomnessValue;
  blacklist: string;
  maxLength: number;
  tld: string;
  maxNames: number;
  yearlyBudget: number;
  loopCount: number;
}

export interface PreparedSearchPayload {
  payload: SearchFormPayload;
  enrichment: KeywordEnrichmentResult | null;
}

interface PreparePayloadOptions {
  env?: NodeJS.ProcessEnv;
  enrichFn?: (keywords: string, options?: EnrichmentOptions) => Promise<KeywordEnrichmentResult>;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export function isKeywordEnrichmentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env.NEXT_PUBLIC_ENABLE_KEYWORD_ENRICHMENT ?? "").trim().toLowerCase();
  if (TRUE_VALUES.has(raw)) {
    return true;
  }
  if (FALSE_VALUES.has(raw)) {
    return false;
  }
  return env.NODE_ENV !== "production";
}

export async function prepareSearchPayloadWithKeywordEnrichment(
  form: SearchFormPayload,
  options: PreparePayloadOptions = {},
): Promise<PreparedSearchPayload> {
  const env = options.env ?? process.env;
  const basePayload: SearchFormPayload = {
    ...form,
    keywords: String(form.keywords ?? "").trim(),
  };

  if (!isKeywordEnrichmentEnabled(env)) {
    return {
      payload: basePayload,
      enrichment: null,
    };
  }

  const enrichFn = options.enrichFn ?? enrichKeywords;
  const wordnikApiKey = String(env.NEXT_PUBLIC_WORDNIK_API_KEY ?? "").trim();
  const enrichment = await enrichFn(basePayload.keywords, {
    blacklist: basePayload.blacklist,
    wordnikApiKey,
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Keyword enrichment failed.";
    return {
      originalKeywords: basePayload.keywords,
      expandedKeywords: basePayload.keywords,
      usedDatamuse: false,
      usedWordnik: false,
      fallbackReason: message,
      debug: {
        seedTokens: [],
        selectedRelated: [],
        rejected: [`submit:${message}`],
      },
    } satisfies KeywordEnrichmentResult;
  });

  return {
    payload: {
      ...basePayload,
      keywords: enrichment.expandedKeywords || basePayload.keywords,
    },
    enrichment,
  };
}
