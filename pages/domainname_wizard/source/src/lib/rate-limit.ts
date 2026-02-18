import PQueue from "p-queue";

const NAMELIX_BASE_COOLDOWN_MS = 20_000;
const NAMELIX_MAX_JITTER_MS = 5_000;

const GODADDY_INTERVAL_CAP = 30;
const GODADDY_INTERVAL_MS = 60_000;

const namelixQueue = new PQueue({ concurrency: 1 });
const goDaddyQueue = new PQueue({
  concurrency: 3,
  intervalCap: GODADDY_INTERVAL_CAP,
  interval: GODADDY_INTERVAL_MS,
  carryoverConcurrencyCount: true,
});

let namelixLastRunAt = 0;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runNamelixQueued<T>(task: () => Promise<T>): Promise<T> {
  return namelixQueue.add(async () => {
    const jitter = Math.floor(Math.random() * NAMELIX_MAX_JITTER_MS);
    const targetStart = namelixLastRunAt + NAMELIX_BASE_COOLDOWN_MS + jitter;
    const waitMs = Math.max(0, targetStart - Date.now());

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    namelixLastRunAt = Date.now();
    return task();
  }) as Promise<T>;
}

export async function runGoDaddyQueued<T>(task: () => Promise<T>): Promise<T> {
  return goDaddyQueue.add(task) as Promise<T>;
}
