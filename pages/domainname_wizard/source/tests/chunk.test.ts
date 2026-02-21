import { describe, expect, it } from "vitest";

import { chunkDomains } from "@/lib/godaddy/client";

describe("GoDaddy chunking", () => {
  it("never exceeds chunk size", () => {
    const domains = Array.from({ length: 251 }, (_, idx) => `name-${idx}.com`);
    const chunks = chunkDomains(domains, 100);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[1]).toHaveLength(100);
    expect(chunks[2]).toHaveLength(51);
  });
});

