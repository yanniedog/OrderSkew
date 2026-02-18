import type {
  DomainResult,
  RankedDomainResult,
  RawDomainResult,
  SearchResults,
  TuningStep,
  ValueDriver,
  LoopSummary,
} from "@/lib/types";

function microsToPrice(micros?: number): number | undefined {
  if (typeof micros !== "number") {
    return undefined;
  }

  return Number((micros / 1_000_000).toFixed(2));
}

function sortByPriceAscending(a: DomainResult, b: DomainResult): number {
  const aPrice = a.price ?? Number.POSITIVE_INFINITY;
  const bPrice = b.price ?? Number.POSITIVE_INFINITY;

  if (aPrice !== bPrice) {
    return aPrice - bPrice;
  }

  return a.domain.localeCompare(b.domain);
}

function toRanked(result: DomainResult): RankedDomainResult {
  const neutralDriver: ValueDriver = {
    component: "unscored",
    impact: 0,
    detail: "Legacy classification path without scoring engine.",
  };

  return {
    ...result,
    marketabilityScore: 0,
    financialValueScore: 0,
    overallScore: 0,
    syllableCount: 0,
    labelLength: 0,
    valueDrivers: [neutralDriver],
    valueDetractors: [],
    firstSeenLoop: 1,
    lastSeenLoop: 1,
    timesDiscovered: 1,
  };
}

function sortRankedByPriceAscending(a: RankedDomainResult, b: RankedDomainResult): number {
  return sortByPriceAscending(a, b);
}

export function classifyDomainResults(
  rawResults: RawDomainResult[],
  yearlyBudget: number,
): SearchResults {
  const withinBudget: RankedDomainResult[] = [];
  const overBudget: RankedDomainResult[] = [];
  const unavailable: RankedDomainResult[] = [];

  for (const item of rawResults) {
    const price = microsToPrice(item.priceMicros);
    const overBudgetFlag = item.available && typeof price === "number" ? price > yearlyBudget : false;

    const result: DomainResult = {
      ...item,
      price,
      overBudget: overBudgetFlag,
    };
    const ranked = toRanked(result);

    if (!item.available || overBudgetFlag) {
      continue;
    }

    withinBudget.push(ranked);
  }

  withinBudget.sort(sortRankedByPriceAscending);

  return {
    withinBudget,
    overBudget,
    unavailable,
    allRanked: [...withinBudget],
    loopSummaries: [],
    tuningHistory: [],
  };
}

export function classifyRankedResults(
  rankedResults: RankedDomainResult[],
  loopSummaries: LoopSummary[],
  tuningHistory: TuningStep[],
): SearchResults {
  const availableRanked = rankedResults.filter((result) => result.available && !result.overBudget);
  const withinBudget = availableRanked
    .filter((result) => !result.overBudget)
    .sort(sortRankedByPriceAscending);
  const overBudget: RankedDomainResult[] = [];

  return {
    withinBudget,
    overBudget,
    unavailable: [],
    allRanked: availableRanked,
    loopSummaries,
    tuningHistory,
  };
}
