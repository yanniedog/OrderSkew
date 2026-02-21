import { normalizeBusinessNameToLabel, normalizeTld } from "@/lib/domain/normalize";
import {
  GoDaddyApiError,
  GoDaddyAuthError,
  GoDaddyRateLimitError,
  checkAvailabilityBulk,
} from "@/lib/godaddy/client";
import { getJob, markJobComplete, markJobFailed, markJobRunning, patchJob } from "@/lib/jobs/store";
import { NamelixScrapeError, scrapeNamelix } from "@/lib/namelix/scraper";
import { classifyRankedResults } from "@/lib/search/classify";
import { loadOptimizerModelState, saveOptimizerModelState } from "@/lib/search/model-store";
import { DomainSearchOptimizer } from "@/lib/search/optimizer";
import { scoreDomainResult, scoreRewardFromRankedScores } from "@/lib/search/scoring";
import { sortRankedDomains } from "@/lib/search/sort";
import type {
  DomainResult,
  JobError,
  JobPhase,
  LoopSummary,
  RankedDomainResult,
  RawDomainResult,
  SearchResults,
  SearchRequest,
  TuningStep,
} from "@/lib/types";

interface DomainCandidate {
  domain: string;
  sourceName: string;
  isNamelixPremium: boolean;
}

interface IterationResults {
  ranked: RankedDomainResult[];
  availableCount: number;
  withinBudgetCount: number;
  averageOverallScore: number;
  topDomain?: string;
  topScore?: number;
}

interface LoopRunState {
  rawAvailable: RawDomainResult[];
  consideredCount: number;
  batchCount: number;
  limitHit: boolean;
  quotaMet: boolean;
  skipReason?: string;
}

const LOOP_CONSIDERED_LIMIT = 251;
const LOOP_MAX_STALLED_BATCHES = 3;
const LOOP_MAX_BATCH_ATTEMPTS = 12;

export function buildDomainCandidates(
  input: SearchRequest,
  logos: Awaited<ReturnType<typeof scrapeNamelix>>,
) {
  const candidates: DomainCandidate[] = [];
  const invalid: RawDomainResult[] = [];
  const seenDomains = new Set<string>();
  const normalizedTld = normalizeTld(input.tld);

  if (!normalizedTld) {
    throw new Error("Invalid TLD after normalization.");
  }

  for (const logo of logos) {
    const sourceName = logo.businessName;
    const isNamelixPremium = logo.name === "premium";
    const label = normalizeBusinessNameToLabel(sourceName);

    if (!label) {
      invalid.push({
        domain: `${sourceName} (invalid)`,
        sourceName,
        isNamelixPremium,
        available: false,
        definitive: false,
        reason: "Unable to normalize business name into a valid domain label.",
      });
      continue;
    }

    if (label.length > input.maxLength) {
      invalid.push({
        domain: `${sourceName} (invalid)`,
        sourceName,
        isNamelixPremium,
        available: false,
        definitive: false,
        reason: `Normalized label length ${label.length} exceeds maxLength ${input.maxLength}.`,
      });
      continue;
    }

    const domain = `${label}.${normalizedTld}`;
    if (seenDomains.has(domain)) {
      continue;
    }

    seenDomains.add(domain);
    candidates.push({
      domain,
      sourceName,
      isNamelixPremium,
    });
  }

  return {
    candidates,
    invalid,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseDomainLabel(domain: string): string | null {
  const index = domain.indexOf(".");
  if (index <= 0) {
    return null;
  }

  return domain.slice(0, index);
}

function microsToPrice(micros?: number): number | undefined {
  if (typeof micros !== "number") {
    return undefined;
  }

  return Number((micros / 1_000_000).toFixed(2));
}

function toDomainResult(item: RawDomainResult, yearlyBudget: number): DomainResult {
  const price = microsToPrice(item.priceMicros);
  const overBudgetFlag = item.available && typeof price === "number" ? price > yearlyBudget : false;

  return {
    ...item,
    price,
    overBudget: overBudgetFlag,
  };
}

function shouldReplaceByScore(existing: RankedDomainResult, next: RankedDomainResult): boolean {
  if (next.overallScore !== existing.overallScore) {
    return next.overallScore > existing.overallScore;
  }

  if ((next.price ?? Number.POSITIVE_INFINITY) !== (existing.price ?? Number.POSITIVE_INFINITY)) {
    return (next.price ?? Number.POSITIVE_INFINITY) < (existing.price ?? Number.POSITIVE_INFINITY);
  }

  return next.domain.localeCompare(existing.domain) < 0;
}

function mergeAggregateEntry(
  existing: RankedDomainResult | undefined,
  candidate: RankedDomainResult,
  loop: number,
): RankedDomainResult {
  if (!existing) {
    return candidate;
  }

  const chosen = shouldReplaceByScore(existing, candidate) ? candidate : existing;
  return {
    ...chosen,
    firstSeenLoop: existing.firstSeenLoop,
    lastSeenLoop: loop,
    timesDiscovered: existing.timesDiscovered + 1,
  };
}

function mergeRowsIntoAggregate(
  aggregate: Map<string, RankedDomainResult>,
  rows: RankedDomainResult[],
  loop: number,
): void {
  for (const row of rows) {
    const label = parseDomainLabel(row.domain);
    if (!label) {
      continue;
    }

    const key = row.domain.toLowerCase();
    const merged = mergeAggregateEntry(aggregate.get(key), row, loop);
    aggregate.set(key, merged);
  }
}

function buildResultsSnapshot(
  aggregate: Map<string, RankedDomainResult>,
  loopSummaries: LoopSummary[],
  tuningHistory: TuningStep[],
): SearchResults {
  const allRanked = sortRankedDomains(Array.from(aggregate.values()), "marketability");
  return classifyRankedResults(allRanked, loopSummaries, tuningHistory);
}

function buildBatchMaxNames(requiredRemaining: number, configuredMaxNames: number): number {
  const candidate = Math.max(requiredRemaining * 3, requiredRemaining, Math.min(configuredMaxNames, 80));
  return clamp(Math.floor(candidate), requiredRemaining, 250);
}

function calculateLoopProgress(totalLoops: number, currentLoop: number, loopFraction: number): number {
  if (totalLoops <= 0) {
    return 100;
  }

  const completedLoops = Math.max(0, currentLoop - 1);
  const fractionWithinLoop = clamp(loopFraction, 0, 1);
  const normalized = (completedLoops + fractionWithinLoop) / totalLoops;
  return Math.round(5 + normalized * 90);
}

function scoreIterationResults(
  rawResults: RawDomainResult[],
  input: SearchRequest,
  loop: number,
): IterationResults {
  const ranked: RankedDomainResult[] = [];

  for (const item of rawResults) {
    const result = toDomainResult(item, input.yearlyBudget);
    if (!result.available || result.overBudget) {
      continue;
    }

    const label = parseDomainLabel(result.domain);
    if (!label || label.length > input.maxLength) {
      continue;
    }

    const metrics = scoreDomainResult(result, input);
    ranked.push({
      ...result,
      ...metrics,
      firstSeenLoop: loop,
      lastSeenLoop: loop,
      timesDiscovered: 1,
    });
  }

  const sorted = sortRankedDomains(ranked, "marketability");
  const top = sorted[0];
  const averageOverallScore =
    sorted.length > 0
      ? Number((sorted.reduce((sum, row) => sum + row.overallScore, 0) / sorted.length).toFixed(2))
      : 0;

  return {
    ranked: sorted,
    availableCount: sorted.length,
    withinBudgetCount: sorted.length,
    averageOverallScore,
    topDomain: top?.domain,
    topScore: top?.overallScore,
  };
}

function buildLoopSummary(
  loop: number,
  input: SearchRequest,
  selected: {
    style: LoopSummary["style"];
    randomness: LoopSummary["randomness"];
    mutationIntensity: LoopSummary["mutationIntensity"];
  },
  state: LoopRunState,
  scored: IterationResults,
): LoopSummary {
  return {
    loop,
    keywords: input.keywords,
    description: input.description ?? "",
    style: selected.style,
    randomness: selected.randomness,
    mutationIntensity: selected.mutationIntensity,
    requiredQuota: input.maxNames,
    quotaMet: state.quotaMet,
    skipped: !state.quotaMet,
    limitHit: state.limitHit,
    skipReason: state.skipReason,
    consideredCount: state.consideredCount,
    batchCount: state.batchCount,
    discoveredCount: scored.ranked.length,
    availableCount: scored.availableCount,
    withinBudgetCount: scored.withinBudgetCount,
    averageOverallScore: scored.averageOverallScore,
    topDomain: scored.topDomain,
    topScore: scored.topScore,
  };
}

function mapErrorToJobError(error: unknown): JobError {
  if (error instanceof NamelixScrapeError) {
    return {
      code: "NAMELIX_SCRAPE_FAILED",
      message: error.message,
    };
  }

  if (error instanceof GoDaddyAuthError) {
    return {
      code: "GODADDY_AUTH_FAILED",
      message: error.message,
    };
  }

  if (error instanceof GoDaddyRateLimitError) {
    return {
      code: "GODADDY_RATE_LIMIT",
      message: error.message,
    };
  }

  if (error instanceof GoDaddyApiError) {
    return {
      code: "GODADDY_API_ERROR",
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "Unexpected unknown error occurred during search execution.",
  };
}

function getLivePhase(batchCount: number): JobPhase {
  return batchCount === 0 ? "namelix" : "godaddy";
}

export async function runSearchJob(jobId: string): Promise<void> {
  const initialJob = getJob(jobId);
  if (!initialJob) {
    return;
  }

  const baseInput = initialJob.input;
  const totalLoops = baseInput.loopCount;
  const aggregate = new Map<string, RankedDomainResult>();
  const loopSummaries: LoopSummary[] = [];
  const tuningHistory: TuningStep[] = [];

  try {
    markJobRunning(jobId, "looping", 5);
    patchJob(jobId, {
      currentLoop: 0,
      totalLoops,
      results: buildResultsSnapshot(aggregate, loopSummaries, tuningHistory),
    });

    const modelState = await loadOptimizerModelState();
    const optimizer = new DomainSearchOptimizer(baseInput, modelState);

    for (let loop = 1; loop <= totalLoops; loop += 1) {
      const plan = optimizer.nextLoop(loop);
      const seenDomains = new Set<string>();
      const loopRawAvailable: RawDomainResult[] = [];
      let consideredCount = 0;
      let batchCount = 0;
      let limitHit = false;
      let stalledBatches = 0;
      let skipReason: string | undefined;

      while (loopRawAvailable.length < plan.input.maxNames) {
        if (consideredCount >= LOOP_CONSIDERED_LIMIT) {
          limitHit = true;
          skipReason = `Considered-name cap of ${LOOP_CONSIDERED_LIMIT} reached.`;
          break;
        }

        if (batchCount >= LOOP_MAX_BATCH_ATTEMPTS) {
          skipReason = `Batch attempt cap (${LOOP_MAX_BATCH_ATTEMPTS}) reached before quota.`;
          break;
        }

        const remaining = plan.input.maxNames - loopRawAvailable.length;
        const loopFractionPreScrape = 0.05 + 0.8 * (loopRawAvailable.length / Math.max(1, plan.input.maxNames));
        patchJob(jobId, {
          status: "running",
          phase: "namelix",
          progress: calculateLoopProgress(totalLoops, loop, loopFractionPreScrape),
          currentLoop: loop,
          totalLoops,
          results: buildResultsSnapshot(aggregate, loopSummaries, tuningHistory),
        });

        const batchInput: SearchRequest = {
          ...plan.input,
          maxNames: buildBatchMaxNames(remaining, plan.input.maxNames),
        };
        const logos = await scrapeNamelix(batchInput);
        const { candidates } = buildDomainCandidates(plan.input, logos);

        const freshCandidates = candidates.filter((candidate) => {
          const key = candidate.domain.toLowerCase();
          if (seenDomains.has(key)) {
            return false;
          }

          seenDomains.add(key);
          return true;
        });

        consideredCount += freshCandidates.length;
        batchCount += 1;

        if (consideredCount >= LOOP_CONSIDERED_LIMIT) {
          limitHit = true;
          skipReason = `Considered-name cap of ${LOOP_CONSIDERED_LIMIT} reached.`;
        }

        if (freshCandidates.length === 0) {
          stalledBatches += 1;
        } else {
          patchJob(jobId, {
            status: "running",
            phase: "godaddy",
            progress: calculateLoopProgress(totalLoops, loop, loopFractionPreScrape + 0.04),
            currentLoop: loop,
            totalLoops,
            results: buildResultsSnapshot(aggregate, loopSummaries, tuningHistory),
          });

          const availabilityMap = await checkAvailabilityBulk(freshCandidates.map((candidate) => candidate.domain));
          let batchQualifiedCount = 0;

          for (const candidate of freshCandidates) {
            const availability = availabilityMap.get(candidate.domain);
            if (!availability?.available) {
              continue;
            }

            const rawAvailable: RawDomainResult = {
              domain: candidate.domain,
              sourceName: candidate.sourceName,
              isNamelixPremium: candidate.isNamelixPremium,
              available: true,
              definitive: Boolean(availability.definitive),
              priceMicros: availability.priceMicros,
              currency: availability.currency,
              period: availability.period,
              reason: availability.reason,
            };

            const priced = toDomainResult(rawAvailable, plan.input.yearlyBudget);
            if (priced.overBudget) {
              continue;
            }

            batchQualifiedCount += 1;
            loopRawAvailable.push(rawAvailable);

            if (loopRawAvailable.length >= plan.input.maxNames) {
              break;
            }
          }

          stalledBatches = batchQualifiedCount === 0 ? stalledBatches + 1 : 0;
        }

        const liveState: LoopRunState = {
          rawAvailable: loopRawAvailable,
          consideredCount,
          batchCount,
          limitHit,
          quotaMet: loopRawAvailable.length >= plan.input.maxNames,
          skipReason,
        };
        const liveScored = scoreIterationResults(loopRawAvailable, plan.input, loop);
        const previewAggregate = new Map(aggregate);
        mergeRowsIntoAggregate(previewAggregate, liveScored.ranked, loop);
        const liveSummary = buildLoopSummary(
          loop,
          plan.input,
          {
            style: plan.selectedStyle,
            randomness: plan.selectedRandomness,
            mutationIntensity: plan.selectedMutationIntensity,
          },
          liveState,
          liveScored,
        );

        patchJob(jobId, {
          status: "running",
          phase: getLivePhase(batchCount),
          progress: calculateLoopProgress(
            totalLoops,
            loop,
            0.12 + 0.82 * (loopRawAvailable.length / Math.max(1, plan.input.maxNames)),
          ),
          currentLoop: loop,
          totalLoops,
          results: buildResultsSnapshot(previewAggregate, [...loopSummaries, liveSummary], tuningHistory),
        });

        if (limitHit) {
          break;
        }

        if (stalledBatches >= LOOP_MAX_STALLED_BATCHES) {
          skipReason = `No newly qualifying domains across ${LOOP_MAX_STALLED_BATCHES} consecutive batches.`;
          break;
        }
      }

      const loopState: LoopRunState = {
        rawAvailable: loopRawAvailable,
        consideredCount,
        batchCount,
        limitHit,
        quotaMet: loopRawAvailable.length >= plan.input.maxNames,
        skipReason,
      };

      const scored = scoreIterationResults(loopRawAvailable, plan.input, loop);
      mergeRowsIntoAggregate(aggregate, scored.ranked, loop);

      const reward = scoreRewardFromRankedScores(scored.ranked.map((row) => row.overallScore));
      const tuningStep = optimizer.recordReward(plan, reward);
      tuningHistory.push(tuningStep);

      const loopSummary = buildLoopSummary(
        loop,
        plan.input,
        {
          style: plan.selectedStyle,
          randomness: plan.selectedRandomness,
          mutationIntensity: plan.selectedMutationIntensity,
        },
        loopState,
        scored,
      );
      loopSummaries.push(loopSummary);

      patchJob(jobId, {
        status: "running",
        phase: "looping",
        progress: calculateLoopProgress(totalLoops, loop, 1),
        currentLoop: loop,
        totalLoops,
        results: buildResultsSnapshot(aggregate, loopSummaries, tuningHistory),
      });
    }

    const finalModelState = optimizer.snapshotModelState();
    await saveOptimizerModelState(finalModelState);

    const results = buildResultsSnapshot(aggregate, loopSummaries, tuningHistory);
    markJobComplete(jobId, results);
  } catch (error) {
    markJobFailed(jobId, mapErrorToJobError(error));
  }
}
