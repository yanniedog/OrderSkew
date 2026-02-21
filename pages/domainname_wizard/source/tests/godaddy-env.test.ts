import { describe, expect, it } from "vitest";

import { resolveBaseUrl } from "@/lib/godaddy/client";

describe("GoDaddy env resolution", () => {
  it("defaults to OTE when env is missing", () => {
    expect(resolveBaseUrl({})).toBe("https://api.ote-godaddy.com");
  });

  it("uses production API for PROD", () => {
    expect(resolveBaseUrl({ GODADDY_ENV: "PROD" })).toBe("https://api.godaddy.com");
  });

  it("uses production API for PRODUCTION", () => {
    expect(resolveBaseUrl({ GODADDY_ENV: "PRODUCTION" })).toBe("https://api.godaddy.com");
  });

  it("supports GODADDY_API_ENV alias", () => {
    expect(resolveBaseUrl({ GODADDY_API_ENV: "LIVE" })).toBe("https://api.godaddy.com");
  });
});
