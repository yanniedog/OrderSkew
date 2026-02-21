import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { normalizeBusinessNameKey } from "@/lib/domain/normalize";
import { runNamelixQueued, sleep } from "@/lib/rate-limit";
import type { NamelixLogo, SearchRequest } from "@/lib/types";

const NAMELIX_APP_URL = "https://namelix.com/app/";
const MAX_RETRIES = 2;

export class NamelixScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NamelixScrapeError";
  }
}

let browserPromise: Promise<Browser> | null = null;
let contextPromise: Promise<BrowserContext> | null = null;

async function getSharedBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }

  return browserPromise;
}

async function getSharedContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    const browser = await getSharedBrowser();
    contextPromise = browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    });
  }

  return contextPromise;
}

async function applyFormInputs(page: Page, input: SearchRequest): Promise<void> {
  const tld = input.tld.toLowerCase().replace(/^\./, "");

  await page.locator(`#style-${input.style}`).check({ force: true });

  // Radio is hidden with opacity:0 / 0x0 size; set via JS so Playwright visibility check does not fail.
  await page.evaluate((randomness: string) => {
    const el = document.querySelector(`#radio-random-${randomness}`) as HTMLInputElement | null;
    if (el && el.type === "radio") {
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, input.randomness);

  // Form inputs can be hidden (opacity/off-screen); set via JS so Playwright visibility does not block.
  await page.evaluate(
    (payload: { keywords: string; description: string; blacklist: string; lengthRange: string }) => {
      const setInput = (id: string, value: string) => {
        const el = document.querySelector(`#${id}`) as HTMLInputElement | null;
        if (el) {
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      };
      setInput("keywords", payload.keywords);
      setInput("description", payload.description);
      setInput("blacklist", payload.blacklist);
      setInput("length_range", payload.lengthRange);
    },
    {
      keywords: input.keywords,
      description: input.description ?? "",
      blacklist: input.blacklist ?? "",
      lengthRange: String(input.maxLength),
    },
  );

  await page.evaluate((normalizedTld) => {
    const app = (window as unknown as { namelix?: any }).namelix;

    if (!app) {
      return;
    }

    app.extensions = [normalizedTld];
    app.styles = app.styles || "default";
    app.random = app.random || "medium";
  }, tld);

  await page.evaluate((extId: string) => {
    const el = document.querySelector(`#ext-${extId}`) as HTMLInputElement | null;
    if (el && (el.type === "radio" || el.type === "checkbox")) {
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, tld);
}

async function triggerGeneration(page: Page): Promise<void> {
  const generateButton = page
    .locator("a.nav-link")
    .filter({ hasText: /Generate/i })
    .first();

  if ((await generateButton.count()) > 0) {
    await generateButton.click({ force: true });
  } else {
    await page.evaluate(() => {
      const app = (window as unknown as { namelix?: any }).namelix;
      if (!app || typeof app.reload !== "function") {
        throw new Error("Namelix app reload function was not found.");
      }
      app.reload();
    });
  }
}

async function loadMoreUntilTarget(page: Page, maxNames: number): Promise<void> {
  let previousCount = 0;
  let stagnantCycles = 0;

  while (true) {
    const snapshot = await page.evaluate(() => {
      const app = (window as unknown as { namelix?: any }).namelix;

      if (!app) {
        return {
          count: 0,
          loading: false,
        };
      }

      return {
        count: Array.isArray(app.logos) ? app.logos.length : 0,
        loading: Boolean(app.loading_logos || app.loading_request),
      };
    });

    if (snapshot.count >= maxNames) {
      return;
    }

    if (snapshot.count <= previousCount) {
      stagnantCycles += 1;
    } else {
      stagnantCycles = 0;
    }

    if (stagnantCycles >= 3) {
      return;
    }

    previousCount = snapshot.count;

    await page.evaluate(() => {
      const app = (window as unknown as { namelix?: any }).namelix;

      if (!app || app.loading_logos || app.loading_request) {
        return;
      }

      if (typeof app.load_logos === "function") {
        app.load_logos();
      }
    });

    try {
      await page.waitForFunction(
        (previous) => {
          const app = (window as unknown as { namelix?: any }).namelix;
          if (!app) {
            return false;
          }

          const currentCount = Array.isArray(app.logos) ? app.logos.length : 0;
          return currentCount > previous || (!app.loading_logos && !app.loading_request);
        },
        previousCount,
        { timeout: 15_000 },
      );
    } catch {
      await sleep(500);
    }
  }
}

async function scrapeNamelixOnce(input: SearchRequest): Promise<NamelixLogo[]> {
  const context = await getSharedContext();
  const page = await context.newPage();

  try {
    page.setDefaultTimeout(45_000);

    await page.goto(NAMELIX_APP_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#namelix", { state: "attached" });

    await page.waitForFunction(() => {
      const app = (window as unknown as { namelix?: any }).namelix;
      return Boolean(app);
    });

    await applyFormInputs(page, input);
    await triggerGeneration(page);

    await page.waitForFunction(() => {
      const app = (window as unknown as { namelix?: any }).namelix;
      if (!app) {
        return false;
      }

      const hasLogos = Array.isArray(app.logos) && app.logos.length > 0;
      return hasLogos && !app.loading_logos && !app.loading_request;
    }, { timeout: 90_000 });

    await loadMoreUntilTarget(page, input.maxNames);

    const rawLogos = await page.evaluate((maxNames) => {
      const app = (window as unknown as { namelix?: any }).namelix;
      const logos = Array.isArray(app?.logos) ? app.logos.slice(0, maxNames) : [];

      return logos.map((logo: any) => ({
        businessName: String(logo.businessName ?? "").trim(),
        description: typeof logo.description === "string" ? logo.description : "",
        name: typeof logo.name === "string" ? logo.name : undefined,
        domains: typeof logo.domains === "string" ? logo.domains : undefined,
        hasDomain: Boolean(logo.hasDomain),
      }));
    }, input.maxNames);

    const deduped: NamelixLogo[] = [];
    const seen = new Set<string>();

    for (const logo of rawLogos as NamelixLogo[]) {
      if (!logo.businessName) {
        continue;
      }

      const key = normalizeBusinessNameKey(logo.businessName) || logo.businessName.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      deduped.push(logo);
    }

    return deduped;
  } finally {
    await page.close();
  }
}

export async function scrapeNamelix(input: SearchRequest): Promise<NamelixLogo[]> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const logos = await runNamelixQueued(() => scrapeNamelixOnce(input));

      if (logos.length === 0) {
        throw new NamelixScrapeError("Namelix returned no generated names for the provided inputs.");
      }

      return logos;
    } catch (error) {
      lastError = error;

      if (attempt >= MAX_RETRIES) {
        break;
      }

      const backoffMs = 1000 * 2 ** attempt + Math.floor(Math.random() * 400);
      await sleep(backoffMs);
    }
  }

  if (lastError instanceof Error) {
    throw new NamelixScrapeError(lastError.message);
  }

  throw new NamelixScrapeError("Namelix scraping failed for an unknown reason.");
}
