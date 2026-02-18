import type { DomainResult, SearchRequest, ValueDriver } from "@/lib/types";

interface WeightedComponent {
  component: string;
  score: number;
  weight: number;
  detail: string;
}

export interface RankedMetrics {
  marketabilityScore: number;
  financialValueScore: number;
  overallScore: number;
  syllableCount: number;
  labelLength: number;
  valueDrivers: ValueDriver[];
  valueDetractors: ValueDriver[];
}

const TRUSTED_TLD_MODIFIERS: Record<string, number> = {
  com: 1,
  io: 0.95,
  co: 0.93,
  ai: 0.94,
  net: 0.9,
  org: 0.9,
  app: 0.92,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function tokenizeText(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/[\s-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function estimateSyllables(label: string): number {
  const parts = label.split("-").filter(Boolean);

  if (parts.length === 0) {
    return 1;
  }

  let total = 0;

  for (const part of parts) {
    const groups = part.match(/[aeiouy]+/g);
    total += Math.max(1, groups ? groups.length : 0);
  }

  return Math.max(1, total);
}

function calculatePronounceability(label: string): number {
  if (!label) {
    return 0;
  }

  const plain = label.replace(/-/g, "");
  const vowels = (plain.match(/[aeiouy]/g) ?? []).length;
  const vowelRatio = vowels / Math.max(1, plain.length);

  let consonantStreak = 0;
  let worstConsonantStreak = 0;

  for (const character of plain) {
    if (/[aeiouy]/.test(character)) {
      consonantStreak = 0;
      continue;
    }

    consonantStreak += 1;
    worstConsonantStreak = Math.max(worstConsonantStreak, consonantStreak);
  }

  const ratioScore = 100 - Math.abs(vowelRatio - 0.42) * 220;
  const streakPenalty = clamp((worstConsonantStreak - 2) * 14, 0, 60);

  return clamp(ratioScore - streakPenalty, 0, 100);
}

function calculateLengthScore(labelLength: number): number {
  const ideal = 9;
  const distance = Math.abs(labelLength - ideal);
  return clamp(100 - distance * 10, 0, 100);
}

function calculateSyllableScore(syllables: number): number {
  if (syllables >= 2 && syllables <= 3) {
    return 100;
  }

  if (syllables === 1 || syllables === 4) {
    return 78;
  }

  if (syllables === 5) {
    return 55;
  }

  return 35;
}

function calculateKeywordRelevance(label: string, keywordTokens: string[]): number {
  if (!label || keywordTokens.length === 0) {
    return 35;
  }

  let matches = 0;
  for (const token of keywordTokens) {
    if (label.includes(token)) {
      matches += 1;
    }
  }

  return clamp(30 + (matches / keywordTokens.length) * 70, 0, 100);
}

function calculateDistinctiveness(label: string): number {
  const plain = label.replace(/-/g, "");
  if (!plain) {
    return 0;
  }

  const unique = new Set(plain.split(""));
  const ratio = unique.size / plain.length;
  return clamp(ratio * 120, 0, 100);
}

function calculateAffordabilityScore(price: number | undefined, yearlyBudget: number): number {
  if (typeof price !== "number") {
    return 50;
  }

  const ratio = price / Math.max(1, yearlyBudget);
  return clamp(112 - ratio * 65, 0, 100);
}

function buildDrivers(components: WeightedComponent[]): {
  drivers: ValueDriver[];
  detractors: ValueDriver[];
} {
  const impacts: ValueDriver[] = components.map((component) => ({
    component: component.component,
    impact: round2((component.score - 50) * component.weight),
    detail: component.detail,
  }));

  const drivers = impacts
    .filter((entry) => entry.impact > 0)
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 4);

  const detractors = impacts
    .filter((entry) => entry.impact < 0)
    .sort((a, b) => a.impact - b.impact)
    .slice(0, 4);

  return {
    drivers,
    detractors,
  };
}

export function scoreDomainResult(result: DomainResult, input: SearchRequest): RankedMetrics {
  const parts = result.domain.toLowerCase().split(".");
  const label = parts.length > 1 ? parts[0] ?? "" : "";
  const tld = parts.length > 1 ? parts.slice(1).join(".") : input.tld.toLowerCase();

  const labelLength = label.length;
  const syllableCount = estimateSyllables(label);
  const keywordTokens = tokenizeText(`${input.keywords} ${input.description ?? ""}`);

  const marketComponents: WeightedComponent[] = [
    {
      component: "lengthPreference",
      score: calculateLengthScore(labelLength),
      weight: 0.22,
      detail: `Label length is ${labelLength} characters.`,
    },
    {
      component: "syllableFit",
      score: calculateSyllableScore(syllableCount),
      weight: 0.18,
      detail: `Estimated syllables: ${syllableCount}.`,
    },
    {
      component: "pronounceability",
      score: calculatePronounceability(label),
      weight: 0.2,
      detail: "Balanced vowel/consonant pattern improves spoken recall.",
    },
    {
      component: "keywordRelevance",
      score: calculateKeywordRelevance(label, keywordTokens),
      weight: 0.16,
      detail: "Measures overlap with prompt keywords and description.",
    },
    {
      component: "distinctiveness",
      score: calculateDistinctiveness(label),
      weight: 0.1,
      detail: "Higher character uniqueness tends to increase distinct brand recall.",
    },
    {
      component: "hyphenPenalty",
      score: label.includes("-") ? 28 : 100,
      weight: 0.08,
      detail: "Hyphenated names are often harder to communicate verbally.",
    },
    {
      component: "digitPenalty",
      score: /\d/.test(label) ? 24 : 100,
      weight: 0.06,
      detail: "Numbers usually reduce premium brand perception.",
    },
  ];

  const tldModifier = TRUSTED_TLD_MODIFIERS[tld] ?? 0.85;
  const baseMarketability = marketComponents.reduce(
    (total, component) => total + component.score * component.weight,
    0,
  );
  const marketabilityScore = round2(clamp(baseMarketability * tldModifier, 0, 100));

  const financialComponents: WeightedComponent[] = [
    {
      component: "availability",
      score: result.available ? 100 : 0,
      weight: 0.35,
      detail: result.available ? "Domain is currently available." : "Domain is unavailable.",
    },
    {
      component: "definitiveStatus",
      score: result.definitive ? 100 : 62,
      weight: 0.12,
      detail: result.definitive
        ? "Availability status is definitive."
        : "Availability status is non-definitive.",
    },
    {
      component: "affordability",
      score: calculateAffordabilityScore(result.price, input.yearlyBudget),
      weight: 0.38,
      detail:
        typeof result.price === "number"
          ? `Price ${result.price.toFixed(2)} vs budget ${input.yearlyBudget.toFixed(2)}.`
          : "Price unknown; neutral affordability score applied.",
    },
    {
      component: "premiumPenalty",
      score: result.isNamelixPremium ? 35 : 100,
      weight: 0.15,
      detail: result.isNamelixPremium
        ? "Premium label can increase acquisition risk."
        : "Not flagged as premium by Namelix.",
    },
  ];

  let financialValueScore = round2(
    clamp(
      financialComponents.reduce((total, component) => total + component.score * component.weight, 0),
      0,
      100,
    ),
  );

  if (result.overBudget) {
    financialValueScore = round2(financialValueScore * 0.82);
  }

  if (!result.available) {
    financialValueScore = round2(financialValueScore * 0.45);
  }

  const overallScore = round2(clamp(financialValueScore * 0.62 + marketabilityScore * 0.38, 0, 100));

  const { drivers: marketDrivers, detractors: marketDetractors } = buildDrivers(marketComponents);
  const { drivers: financialDrivers, detractors: financialDetractors } = buildDrivers(financialComponents);

  const valueDrivers = [...marketDrivers, ...financialDrivers]
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 4);
  const valueDetractors = [...marketDetractors, ...financialDetractors]
    .sort((a, b) => a.impact - b.impact)
    .slice(0, 4);

  return {
    marketabilityScore,
    financialValueScore,
    overallScore,
    syllableCount,
    labelLength,
    valueDrivers,
    valueDetractors,
  };
}

export function scoreRewardFromRankedScores(scores: number[]): number {
  if (scores.length === 0) {
    return 0;
  }

  const sorted = [...scores].sort((a, b) => b - a);
  const topSlice = sorted.slice(0, Math.min(5, sorted.length));
  const avg = topSlice.reduce((sum, score) => sum + score, 0) / topSlice.length;
  return round2(clamp(avg / 100, 0, 1));
}

export function tokenizeForLearning(input: string): string[] {
  return tokenizeText(input)
    .map((token) => token.slice(0, 24))
    .filter(Boolean);
}
