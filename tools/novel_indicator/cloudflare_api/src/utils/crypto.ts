import { argon2id } from '@noble/hashes/argon2'
import { randomBytes } from '@noble/hashes/utils'

const HASH_VERSION = 'v=19'
const ARGON_MEMORY = 19_456
const ARGON_ITERS = 2
const ARGON_PARALLELISM = 1
const DK_LEN = 32

function toBase64(input: Uint8Array): string {
  let binary = ''
  for (const byte of input) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const digest = argon2id(password, salt, {
    m: ARGON_MEMORY,
    t: ARGON_ITERS,
    p: ARGON_PARALLELISM,
    dkLen: DK_LEN,
  })
  return `argon2id$${HASH_VERSION}$m=${ARGON_MEMORY},t=${ARGON_ITERS},p=${ARGON_PARALLELISM}$${toBase64(salt)}$${toBase64(digest)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'argon2id') {
      return false
    }
    const params = parts[3]
    const salt = fromBase64(parts[4])
    const expected = fromBase64(parts[5])
    const parsed = new URLSearchParams(params.replace(/,/g, '&'))
    const m = Number(parsed.get('m') ?? ARGON_MEMORY)
    const t = Number(parsed.get('t') ?? ARGON_ITERS)
    const p = Number(parsed.get('p') ?? ARGON_PARALLELISM)
    const actual = argon2id(password, salt, { m, t, p, dkLen: expected.length })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function randomToken(bytes = 32): string {
  const raw = randomBytes(bytes)
  return toBase64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(hash)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
