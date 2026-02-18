import {
  MUTATION_INTENSITY_VALUES,
  RANDOMNESS_VALUES,
  STYLE_VALUES,
  type MutationIntensityValue,
  type RandomnessValue,
  type SearchRequest,
  type StyleValue,
  type TuningStep,
} from "@/lib/types";
import { tokenizeForLearning } from "@/lib/search/scoring";

interface ArmStats {
  plays: number;
  reward: number;
}

type BanditRecord<TArm extends string> = Record<TArm, ArmStats>;

export interface OptimizerModelState {
  version: number;
  runCount: number;
  updatedAt: number;
  styleBandit: BanditRecord<StyleValue>;
  randomnessBandit: BanditRecord<RandomnessValue>;
  mutationBandit: BanditRecord<MutationIntensityValue>;
  tokenStats: Record<string, ArmStats>;
}

export interface LoopPlan {
  loop: number;
  sourceLoop?: number;
  selectedStyle: StyleValue;
  selectedRandomness: RandomnessValue;
  selectedMutationIntensity: MutationIntensityValue;
  input: SearchRequest;
}

const MODEL_VERSION = 1;
const STYLE_EPSILON = 0.24;
const RANDOMNESS_EPSILON = 0.24;
const MUTATION_EPSILON = 0.28;

function createArmStats(): ArmStats {
  return {
    plays: 0,
    reward: 0,
  };
}

function createBanditRecord<TArm extends string>(arms: readonly TArm[]): BanditRecord<TArm> {
  return Object.fromEntries(arms.map((arm) => [arm, createArmStats()])) as BanditRecord<TArm>;
}

export function createDefaultOptimizerModelState(): OptimizerModelState {
  return {
    version: MODEL_VERSION,
    runCount: 0,
    updatedAt: Date.now(),
    styleBandit: createBanditRecord(STYLE_VALUES),
    randomnessBandit: createBanditRecord(RANDOMNESS_VALUES),
    mutationBandit: createBanditRecord(MUTATION_INTENSITY_VALUES),
    tokenStats: {},
  };
}

function averageReward(stats: ArmStats): number {
  if (stats.plays === 0) {
    return 0.55;
  }

  return stats.reward / stats.plays;
}

function sanitizeArmStats(value: unknown): ArmStats {
  if (
    typeof value === "object" &&
    value !== null &&
    "plays" in value &&
    typeof value.plays === "number" &&
    value.plays >= 0 &&
    "reward" in value &&
    typeof value.reward === "number" &&
    Number.isFinite(value.reward)
  ) {
    return {
      plays: Math.floor(value.plays),
      reward: value.reward,
    };
  }

  return createArmStats();
}

function sanitizeBanditRecord<TArm extends string>(
  source: unknown,
  arms: readonly TArm[],
): BanditRecord<TArm> {
  const defaults = createBanditRecord(arms);

  if (!source || typeof source !== "object") {
    return defaults;
  }

  for (const arm of arms) {
    defaults[arm] = sanitizeArmStats((source as Record<string, unknown>)[arm]);
  }

  return defaults;
}

export function sanitizeOptimizerModelState(source: unknown): OptimizerModelState {
  const defaults = createDefaultOptimizerModelState();
  if (!source || typeof source !== "object") {
    return defaults;
  }

  const root = source as Record<string, unknown>;
  const tokenStatsRaw = root.tokenStats;
  const tokenStats: Record<string, ArmStats> = {};

  if (tokenStatsRaw && typeof tokenStatsRaw === "object") {
    for (const [key, value] of Object.entries(tokenStatsRaw as Record<string, unknown>)) {
      if (!key || key.length > 32) {
        continue;
      }

      tokenStats[key] = sanitizeArmStats(value);
    }
  }

  return {
    version: MODEL_VERSION,
    runCount: typeof root.runCount === "number" && Number.isFinite(root.runCount) ? root.runCount : 0,
    updatedAt:
      typeof root.updatedAt === "number" && Number.isFinite(root.updatedAt)
        ? root.updatedAt
        : Date.now(),
    styleBandit: sanitizeBanditRecord(root.styleBandit, STYLE_VALUES),
    randomnessBandit: sanitizeBanditRecord(root.randomnessBandit, RANDOMNESS_VALUES),
    mutationBandit: sanitizeBanditRecord(root.mutationBandit, MUTATION_INTENSITY_VALUES),
    tokenStats,
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function chooseArm<TArm extends string>(
  bandit: BanditRecord<TArm>,
  arms: readonly TArm[],
  epsilon: number,
  random: () => number,
): TArm {
  if (random() < epsilon) {
    return arms[Math.floor(random() * arms.length)] as TArm;
  }

  let best = arms[0] as TArm;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const arm of arms) {
    const stats = bandit[arm];
    const score = averageReward(stats);

    if (score > bestScore) {
      best = arm;
      bestScore = score;
      continue;
    }

    if (score === bestScore && random() > 0.5) {
      best = arm;
    }
  }

  return best;
}

function updateArmStats(stats: ArmStats, reward: number): void {
  stats.plays += 1;
  stats.reward += reward;
}

function tokenizeAndLimit(input: string): string[] {
  return tokenizeForLearning(input).slice(0, 12);
}

function mutateTokenSet(
  currentTokens: string[],
  mutationIntensity: MutationIntensityValue,
  baseTokens: string[],
  positiveTokens: string[],
  weakTokens: Set<string>,
  random: () => number,
): string[] {
  const next = [...currentTokens];
  const maxMutations = mutationIntensity === "high" ? 3 : mutationIntensity === "medium" ? 2 : 1;

  for (let i = 0; i < maxMutations; i += 1) {
    if (next.length > 2) {
      const weakIdx = next.findIndex((token) => weakTokens.has(token));
      const removeIndex = weakIdx >= 0 ? weakIdx : Math.floor(random() * next.length);
      next.splice(removeIndex, 1);
    }

    const tokenPool = positiveTokens.length > 0 && random() > 0.2 ? positiveTokens : baseTokens;
    const candidate = tokenPool[Math.floor(random() * tokenPool.length)];
    if (candidate && !next.includes(candidate)) {
      next.push(candidate);
    }
  }

  if (mutationIntensity === "high" && next.length > 3) {
    next.sort(() => (random() > 0.5 ? 1 : -1));
  }

  return next.slice(0, 8);
}

function summarizeDescription(tokens: string[], fallback: string): string {
  if (tokens.length === 0) {
    return fallback;
  }

  return tokens.slice(0, 10).join(" ");
}

export class DomainSearchOptimizer {
  private readonly model: OptimizerModelState;
  private readonly random: () => number;
  private readonly baseInput: SearchRequest;
  private currentKeywordTokens: string[];
  private currentDescriptionTokens: string[];
  private bestLoop?: number;
  private bestReward = Number.NEGATIVE_INFINITY;

  constructor(baseInput: SearchRequest, modelState: OptimizerModelState, seed: number = Date.now()) {
    this.model = sanitizeOptimizerModelState(modelState);
    this.baseInput = {
      ...baseInput,
      description: baseInput.description ?? "",
      blacklist: baseInput.blacklist ?? "",
    };
    this.random = mulberry32(seed);
    this.currentKeywordTokens = tokenizeAndLimit(this.baseInput.keywords);
    this.currentDescriptionTokens = tokenizeAndLimit(this.baseInput.description ?? "");
  }

  nextLoop(loop: number): LoopPlan {
    const selectedStyle = chooseArm(this.model.styleBandit, STYLE_VALUES, STYLE_EPSILON, this.random);
    const selectedRandomness = chooseArm(
      this.model.randomnessBandit,
      RANDOMNESS_VALUES,
      RANDOMNESS_EPSILON,
      this.random,
    );
    const selectedMutationIntensity = chooseArm(
      this.model.mutationBandit,
      MUTATION_INTENSITY_VALUES,
      MUTATION_EPSILON,
      this.random,
    );

    const rankedTokens = Object.entries(this.model.tokenStats)
      .map(([token, stats]) => ({
        token,
        averageReward: averageReward(stats),
      }))
      .sort((a, b) => b.averageReward - a.averageReward);

    const positiveTokens = rankedTokens
      .filter((entry) => entry.averageReward >= 0.58)
      .map((entry) => entry.token)
      .slice(0, 12);
    const weakTokens = new Set(
      rankedTokens.filter((entry) => entry.averageReward <= 0.4).map((entry) => entry.token).slice(0, 20),
    );

    const baseKeywordTokens = tokenizeAndLimit(this.baseInput.keywords);
    const baseDescriptionTokens = tokenizeAndLimit(this.baseInput.description ?? "");

    this.currentKeywordTokens = mutateTokenSet(
      this.currentKeywordTokens.length > 0 ? this.currentKeywordTokens : baseKeywordTokens,
      selectedMutationIntensity,
      baseKeywordTokens.length > 0 ? baseKeywordTokens : ["brand", "company"],
      positiveTokens,
      weakTokens,
      this.random,
    );

    this.currentDescriptionTokens = mutateTokenSet(
      this.currentDescriptionTokens.length > 0 ? this.currentDescriptionTokens : baseDescriptionTokens,
      selectedMutationIntensity,
      baseDescriptionTokens.length > 0 ? baseDescriptionTokens : baseKeywordTokens,
      positiveTokens,
      weakTokens,
      this.random,
    );

    const keywords = this.currentKeywordTokens.join(" ").trim();
    const description = summarizeDescription(this.currentDescriptionTokens, this.baseInput.description ?? "");

    return {
      loop,
      sourceLoop: this.bestLoop,
      selectedStyle,
      selectedRandomness,
      selectedMutationIntensity,
      input: {
        ...this.baseInput,
        style: selectedStyle,
        randomness: selectedRandomness,
        keywords: keywords.length >= 2 ? keywords : this.baseInput.keywords,
        description,
      },
    };
  }

  recordReward(plan: LoopPlan, reward: number): TuningStep {
    const boundedReward = Number.isFinite(reward) ? Math.min(1, Math.max(0, reward)) : 0;
    updateArmStats(this.model.styleBandit[plan.selectedStyle], boundedReward);
    updateArmStats(this.model.randomnessBandit[plan.selectedRandomness], boundedReward);
    updateArmStats(this.model.mutationBandit[plan.selectedMutationIntensity], boundedReward);

    const tokens = tokenizeAndLimit(`${plan.input.keywords} ${plan.input.description ?? ""}`);
    for (const token of tokens) {
      if (!this.model.tokenStats[token]) {
        this.model.tokenStats[token] = createArmStats();
      }

      updateArmStats(this.model.tokenStats[token], boundedReward);
    }

    if (boundedReward >= this.bestReward) {
      this.bestReward = boundedReward;
      this.bestLoop = plan.loop;
    }

    return {
      loop: plan.loop,
      sourceLoop: plan.sourceLoop,
      keywords: plan.input.keywords,
      description: plan.input.description ?? "",
      selectedStyle: plan.selectedStyle,
      selectedRandomness: plan.selectedRandomness,
      selectedMutationIntensity: plan.selectedMutationIntensity,
      reward: Number(boundedReward.toFixed(4)),
    };
  }

  snapshotModelState(): OptimizerModelState {
    const trimmedTokenStats = Object.entries(this.model.tokenStats)
      .sort((a, b) => averageReward(b[1]) - averageReward(a[1]))
      .slice(0, 300);

    this.model.tokenStats = Object.fromEntries(trimmedTokenStats);
    this.model.runCount += 1;
    this.model.updatedAt = Date.now();

    return {
      version: MODEL_VERSION,
      runCount: this.model.runCount,
      updatedAt: this.model.updatedAt,
      styleBandit: this.model.styleBandit,
      randomnessBandit: this.model.randomnessBandit,
      mutationBandit: this.model.mutationBandit,
      tokenStats: this.model.tokenStats,
    };
  }
}
