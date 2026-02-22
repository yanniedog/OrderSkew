/**
 * Static lender keys and display names (importable config).
 * Sync with config/lenders.json if that file is used elsewhere.
 */
export interface LenderConfig {
  displayName: string;
  aliases?: string[];
}

export const LENDER_KEYS = [
  "cba",
  "westpac",
  "nab",
  "anz",
  "macquarie",
  "bendigo",
  "suncorp",
  "bankwest",
  "ing",
  "amp",
] as const;

export type LenderKey = (typeof LENDER_KEYS)[number];

export const LENDERS: Record<LenderKey, LenderConfig> = {
  cba: { displayName: "Commonwealth Bank" },
  westpac: {
    displayName: "Westpac",
    aliases: ["St George", "Bank of Melbourne", "BankSA"],
  },
  nab: { displayName: "NAB" },
  anz: { displayName: "ANZ" },
  macquarie: { displayName: "Macquarie" },
  bendigo: { displayName: "Bendigo Bank" },
  suncorp: { displayName: "Suncorp" },
  bankwest: { displayName: "Bankwest" },
  ing: { displayName: "ING" },
  amp: { displayName: "AMP" },
};

/** Map display name / brand name (case-insensitive) to lender_key */
const DISPLAY_NAME_TO_KEY: Map<string, LenderKey> = new Map();
const ALIAS_TO_KEY: Map<string, LenderKey> = new Map();
for (const [key, cfg] of Object.entries(LENDERS)) {
  const k = key as LenderKey;
  DISPLAY_NAME_TO_KEY.set(cfg.displayName.toLowerCase(), k);
  if (cfg.aliases) {
    for (const a of cfg.aliases) {
      ALIAS_TO_KEY.set(a.toLowerCase(), k);
    }
  }
}

/** Resolve brand/display name to lender_key; returns 'unknown' if unmapped. */
export function resolveLenderKey(brandName: string, displayName?: string): string {
  const b = (brandName || "").trim().toLowerCase();
  const d = (displayName || "").trim().toLowerCase();
  if (b && ALIAS_TO_KEY.has(b)) return ALIAS_TO_KEY.get(b)!;
  if (d && ALIAS_TO_KEY.has(d)) return ALIAS_TO_KEY.get(d)!;
  if (b && DISPLAY_NAME_TO_KEY.has(b)) return DISPLAY_NAME_TO_KEY.get(b)!;
  if (d && DISPLAY_NAME_TO_KEY.has(d)) return DISPLAY_NAME_TO_KEY.get(d)!;
  // Partial/fuzzy: check if any display name or alias is contained
  for (const [alias, k] of ALIAS_TO_KEY) {
    if (b.includes(alias) || alias.includes(b)) return k;
  }
  for (const [name, k] of DISPLAY_NAME_TO_KEY) {
    if (b.includes(name) || name.includes(b) || d.includes(name) || name.includes(d))
      return k;
  }
  // Known legal entity name mappings
  if (
    b.includes("commonwealth bank") ||
    b.includes("commonwealth bank of australia")
  )
    return "cba";
  if (
    b.includes("australia and new zealand") ||
    b.includes("anz ") ||
    b === "anz"
  )
    return "anz";
  if (b.includes("national australia bank") || b === "nab") return "nab";
  if (b.includes("westpac") || b.includes("st george")) return "westpac";
  if (b.includes("macquarie")) return "macquarie";
  if (b.includes("bendigo")) return "bendigo";
  if (b.includes("suncorp")) return "suncorp";
  if (b.includes("bankwest")) return "bankwest";
  if (b.includes("ing ")) return "ing";
  if (b.includes("amp ")) return "amp";
  return "unknown";
}
