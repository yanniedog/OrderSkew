export function getRequestId(headers: Headers): string {
  const incoming = headers.get('x-request-id')?.trim()
  if (incoming) {
    return incoming
  }
  return crypto.randomUUID()
}

export function logJson(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload))
}