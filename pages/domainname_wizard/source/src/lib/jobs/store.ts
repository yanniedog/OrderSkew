import { randomUUID } from "node:crypto";

import type { CachedSearchResult, JobError, SearchJob, SearchRequest, SearchResults } from "@/lib/types";

const JOB_RETENTION_MS = 30 * 60 * 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

type Store = {
  jobs: Map<string, SearchJob>;
  cache: Map<string, CachedSearchResult>;
  cleanupStarted: boolean;
};

const storeSymbol = Symbol.for("domainname-wizard.store");

type GlobalWithStore = typeof globalThis & {
  [storeSymbol]?: Store;
};

const globalStore = globalThis as GlobalWithStore;

function getStore(): Store {
  if (!globalStore[storeSymbol]) {
    globalStore[storeSymbol] = {
      jobs: new Map<string, SearchJob>(),
      cache: new Map<string, CachedSearchResult>(),
      cleanupStarted: false,
    };
  }

  const store = globalStore[storeSymbol];

  if (!store.cleanupStarted) {
    store.cleanupStarted = true;
    setInterval(() => {
      cleanupExpiredJobs(store.jobs);
      cleanupExpiredCache(store.cache);
    }, CLEANUP_INTERVAL_MS).unref();
  }

  return store;
}

function cleanupExpiredJobs(jobs: Map<string, SearchJob>): void {
  const now = Date.now();

  for (const [id, job] of jobs.entries()) {
    if ((job.status === "done" || job.status === "failed") && job.completedAt && now - job.completedAt > JOB_RETENTION_MS) {
      jobs.delete(id);
    }
  }
}

function cleanupExpiredCache(cache: Map<string, CachedSearchResult>): void {
  const now = Date.now();

  for (const [key, value] of cache.entries()) {
    if (value.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

export function createJob(input: SearchRequest): SearchJob {
  const store = getStore();
  const now = Date.now();

  const job: SearchJob = {
    id: randomUUID(),
    status: "queued",
    phase: null,
    progress: 0,
    input,
    createdAt: now,
    updatedAt: now,
  };

  store.jobs.set(job.id, job);
  return job;
}

export function getJob(jobId: string): SearchJob | undefined {
  return getStore().jobs.get(jobId);
}

export function patchJob(jobId: string, patch: Partial<SearchJob>): SearchJob | undefined {
  const store = getStore();
  const job = store.jobs.get(jobId);

  if (!job) {
    return undefined;
  }

  const next: SearchJob = {
    ...job,
    ...patch,
    id: job.id,
    input: job.input,
    updatedAt: Date.now(),
  };

  store.jobs.set(jobId, next);
  return next;
}

export function markJobRunning(jobId: string, phase: SearchJob["phase"], progress: number): SearchJob | undefined {
  const store = getStore();
  const job = store.jobs.get(jobId);

  if (!job) {
    return undefined;
  }

  const next: SearchJob = {
    ...job,
    status: "running",
    phase,
    progress,
    startedAt: job.startedAt ?? Date.now(),
    updatedAt: Date.now(),
  };

  store.jobs.set(jobId, next);
  return next;
}

export function markJobComplete(jobId: string, results: SearchResults): SearchJob | undefined {
  return patchJob(jobId, {
    status: "done",
    phase: "finalize",
    progress: 100,
    results,
    completedAt: Date.now(),
    error: undefined,
  });
}

export function markJobFailed(jobId: string, error: JobError): SearchJob | undefined {
  return patchJob(jobId, {
    status: "failed",
    phase: null,
    error,
    completedAt: Date.now(),
  });
}

export function getCachedSearchResult(cacheKey: string): CachedSearchResult | undefined {
  const store = getStore();
  const value = store.cache.get(cacheKey);

  if (!value) {
    return undefined;
  }

  if (value.expiresAt <= Date.now()) {
    store.cache.delete(cacheKey);
    return undefined;
  }

  return value;
}

export function setCachedSearchResult(cacheKey: string, rawResults: CachedSearchResult["rawResults"]): void {
  const now = Date.now();

  getStore().cache.set(cacheKey, {
    rawResults,
    createdAt: now,
    expiresAt: now + CACHE_TTL_MS,
  });
}
