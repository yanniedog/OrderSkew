const COMBINING_MARKS_REGEX = /[\u0300-\u036f]/g;
const NON_ALNUM_REGEX = /[^a-z0-9]+/g;
const EDGE_DASH_REGEX = /^-+|-+$/g;

export function normalizeTld(input: string): string | null {
  const tld = input.trim().toLowerCase().replace(/^\./, "");

  if (!tld) {
    return null;
  }

  if (!/^[a-z0-9-]{2,24}$/.test(tld)) {
    return null;
  }

  if (tld.startsWith("-") || tld.endsWith("-")) {
    return null;
  }

  return tld;
}

export function normalizeBusinessNameKey(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS_REGEX, "")
    .replace(/&/g, " and ")
    .replace(NON_ALNUM_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeBusinessNameToLabel(input: string): string | null {
  const normalized = input
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(COMBINING_MARKS_REGEX, "")
    .replace(/&/g, " and ")
    .replace(/['\u2019]/g, "")
    .replace(NON_ALNUM_REGEX, "-")
    .replace(/-+/g, "-")
    .replace(EDGE_DASH_REGEX, "");

  if (!normalized) {
    return null;
  }

  if (normalized.length < 1 || normalized.length > 63) {
    return null;
  }

  if (!/^[a-z0-9-]+$/.test(normalized)) {
    return null;
  }

  if (normalized.startsWith("-") || normalized.endsWith("-")) {
    return null;
  }

  return normalized;
}

export function buildDomainFromBusinessName(
  businessName: string,
  tldInput: string,
): string | null {
  const label = normalizeBusinessNameToLabel(businessName);
  const tld = normalizeTld(tldInput);

  if (!label || !tld) {
    return null;
  }

  return `${label}.${tld}`;
}
