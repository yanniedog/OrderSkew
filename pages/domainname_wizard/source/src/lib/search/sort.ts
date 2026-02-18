import type { RankedDomainResult } from "@/lib/types";

export type DomainSortMode =
  | "marketability"
  | "financialValue"
  | "alphabetical"
  | "syllableCount"
  | "labelLength";

function compareOverallTieBreak(a: RankedDomainResult, b: RankedDomainResult): number {
  if (a.overallScore !== b.overallScore) {
    return b.overallScore - a.overallScore;
  }

  return a.domain.localeCompare(b.domain);
}

function compareMarketability(a: RankedDomainResult, b: RankedDomainResult): number {
  if (a.marketabilityScore !== b.marketabilityScore) {
    return b.marketabilityScore - a.marketabilityScore;
  }

  return compareOverallTieBreak(a, b);
}

function compareFinancialValue(a: RankedDomainResult, b: RankedDomainResult): number {
  if (a.financialValueScore !== b.financialValueScore) {
    return b.financialValueScore - a.financialValueScore;
  }

  return compareOverallTieBreak(a, b);
}

function compareAlphabetical(a: RankedDomainResult, b: RankedDomainResult): number {
  const primary = a.domain.localeCompare(b.domain);
  if (primary !== 0) {
    return primary;
  }

  return compareOverallTieBreak(a, b);
}

function compareSyllableCount(a: RankedDomainResult, b: RankedDomainResult): number {
  if (a.syllableCount !== b.syllableCount) {
    return a.syllableCount - b.syllableCount;
  }

  return compareOverallTieBreak(a, b);
}

function compareLabelLength(a: RankedDomainResult, b: RankedDomainResult): number {
  if (a.labelLength !== b.labelLength) {
    return a.labelLength - b.labelLength;
  }

  return compareOverallTieBreak(a, b);
}

export function sortRankedDomains(
  rows: RankedDomainResult[],
  mode: DomainSortMode = "marketability",
): RankedDomainResult[] {
  const next = [...rows];

  const comparator =
    mode === "financialValue"
      ? compareFinancialValue
      : mode === "alphabetical"
        ? compareAlphabetical
        : mode === "syllableCount"
          ? compareSyllableCount
          : mode === "labelLength"
            ? compareLabelLength
            : compareMarketability;

  return next.sort(comparator);
}
