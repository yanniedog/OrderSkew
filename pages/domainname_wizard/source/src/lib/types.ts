export const STYLE_VALUES = [
  "default",
  "brandable",
  "twowords",
  "threewords",
  "compound",
  "spelling",
  "nonenglish",
  "dictionary",
] as const;

export const RANDOMNESS_VALUES = ["low", "medium", "high"] as const;
export const MUTATION_INTENSITY_VALUES = ["low", "medium", "high"] as const;

export type StyleValue = (typeof STYLE_VALUES)[number];
export type RandomnessValue = (typeof RANDOMNESS_VALUES)[number];
export type MutationIntensityValue = (typeof MUTATION_INTENSITY_VALUES)[number];

export interface SearchRequest {
  keywords: string;
  description?: string;
  style: StyleValue;
  randomness: RandomnessValue;
  blacklist?: string;
  maxLength: number;
  tld: string;
  maxNames: number;
  yearlyBudget: number;
  loopCount: number;
}

export interface NamelixLogo {
  businessName: string;
  description?: string;
  name?: string;
  domains?: string;
  hasDomain?: boolean;
}

export interface RawDomainResult {
  domain: string;
  sourceName: string;
  isNamelixPremium: boolean;
  available: boolean;
  definitive: boolean;
  priceMicros?: number;
  currency?: string;
  period?: number;
  reason?: string;
}

export interface DomainResult extends RawDomainResult {
  price?: number;
  overBudget: boolean;
}

export interface ValueDriver {
  component: string;
  impact: number;
  detail: string;
}

export interface RankedDomainResult extends DomainResult {
  marketabilityScore: number;
  financialValueScore: number;
  overallScore: number;
  syllableCount: number;
  labelLength: number;
  valueDrivers: ValueDriver[];
  valueDetractors: ValueDriver[];
  firstSeenLoop: number;
  lastSeenLoop: number;
  timesDiscovered: number;
}

export interface LoopSummary {
  loop: number;
  keywords: string;
  description: string;
  style: StyleValue;
  randomness: RandomnessValue;
  mutationIntensity: MutationIntensityValue;
  requiredQuota: number;
  quotaMet: boolean;
  skipped: boolean;
  limitHit: boolean;
  skipReason?: string;
  consideredCount: number;
  batchCount: number;
  discoveredCount: number;
  availableCount: number;
  withinBudgetCount: number;
  averageOverallScore: number;
  topDomain?: string;
  topScore?: number;
}

export interface TuningStep {
  loop: number;
  sourceLoop?: number;
  keywords: string;
  description: string;
  selectedStyle: StyleValue;
  selectedRandomness: RandomnessValue;
  selectedMutationIntensity: MutationIntensityValue;
  reward: number;
  /** Average repetition penalty (0-1) applied to selected keywords for this run */
  repetitionPenaltyApplied?: number | null;
}

export interface SearchResults {
  withinBudget: RankedDomainResult[];
  overBudget: RankedDomainResult[];
  unavailable: RankedDomainResult[];
  allRanked: RankedDomainResult[];
  loopSummaries: LoopSummary[];
  tuningHistory: TuningStep[];
}

export type JobStatus = "queued" | "running" | "done" | "failed";
export type JobPhase = "namelix" | "godaddy" | "looping" | "finalize" | null;

export interface JobError {
  code: string;
  message: string;
}

export interface SearchJob {
  id: string;
  status: JobStatus;
  phase: JobPhase;
  progress: number;
  input: SearchRequest;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  currentLoop?: number;
  totalLoops?: number;
  results?: SearchResults;
  error?: JobError;
}

export interface CachedSearchResult {
  rawResults: RawDomainResult[];
  createdAt: number;
  expiresAt: number;
}
