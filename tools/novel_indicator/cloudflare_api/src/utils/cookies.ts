type CookieReadableContext = {
  req: {
    header: (name: string) => string | undefined
  }
}

type CookieWritableContext = CookieReadableContext & {
  header: (name: string, value: string, options?: { append?: boolean }) => void
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) {
    return {}
  }
  const out: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (!name) {
      continue
    }
    const rawValue = rest.join('=')
    try {
      out[name] = decodeURIComponent(rawValue)
    } catch {
      out[name] = rawValue
    }
  }
  return out
}

export function getCookie(c: CookieReadableContext, key: string): string | null {
  const cookieHeader = c.req.header('Cookie') ?? null
  const all = parseCookies(cookieHeader)
  return all[key] ?? null
}

export function setCookie(
  c: CookieWritableContext,
  key: string,
  value: string,
  options: {
    maxAge?: number
    path?: string
    httpOnly?: boolean
    secure?: boolean
    sameSite?: 'Lax' | 'Strict' | 'None'
    domain?: string
  } = {},
): void {
  const attrs: string[] = [`${key}=${encodeURIComponent(value)}`]
  attrs.push(`Path=${options.path ?? '/'}`)
  attrs.push(`SameSite=${options.sameSite ?? 'Lax'}`)
  if (options.httpOnly ?? true) {
    attrs.push('HttpOnly')
  }
  if (options.secure ?? true) {
    attrs.push('Secure')
  }
  if (typeof options.maxAge === 'number') {
    attrs.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`)
  }
  if (options.domain && options.domain.trim()) {
    attrs.push(`Domain=${options.domain.trim()}`)
  }
  c.header('Set-Cookie', attrs.join('; '), { append: true })
}

export function clearCookie(c: CookieWritableContext, key: string, domain?: string): void {
  setCookie(c, key, '', {
    maxAge: 0,
    domain,
  })
}
