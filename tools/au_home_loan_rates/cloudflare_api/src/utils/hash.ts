function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function sha256HexFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const input = new Uint8Array(source.byteLength)
  input.set(source)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return toHex(digest)
}

export async function sha256HexFromText(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text)
  return sha256HexFromBytes(encoded)
}

function stableSortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortObject)
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, stableSortObject(v)])
    return Object.fromEntries(entries)
  }
  return value
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableSortObject(value))
}

export async function sha256HexFromJson(value: unknown): Promise<string> {
  return sha256HexFromText(stableStringify(value))
}
