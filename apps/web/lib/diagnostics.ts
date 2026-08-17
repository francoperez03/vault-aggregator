/**
 * Turns whatever failed into a copy-pasteable diagnostic: the thrown error with its stack and any
 * nested cause/details (viem errors carry `shortMessage`, `details`, `metaMessages`, `cause`), or a
 * raw SDK response, plus the request that produced it. bigints are stringified so nothing throws
 * mid-serialization. This text is what the user copies from the strip and sends us — the visible
 * one-liner is never enough to debug a WebView failure.
 */
export function describeFailure(input: { error?: unknown; request?: unknown; response?: unknown; context?: Record<string, unknown> }): string {
  const parts: string[] = []
  const ctx = {
    at: new Date().toISOString(),
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    ...input.context,
  }
  parts.push(`context: ${safeJson(ctx)}`)
  if (input.request !== undefined) parts.push(`request: ${safeJson(input.request)}`)
  if (input.response !== undefined) parts.push(`response: ${safeJson(input.response)}`)
  if (input.error !== undefined) parts.push(`error: ${describeError(input.error)}`)
  return parts.join('\n\n')
}

function describeError(error: unknown, depth = 0): string {
  if (!(error instanceof Error)) return safeJson(error)
  const own: Record<string, unknown> = {}
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === 'stack' || key === 'cause') continue
    own[key] = (error as unknown as Record<string, unknown>)[key]
  }
  const lines = [error.stack ?? `${error.name}: ${error.message}`, `props: ${safeJson(own)}`]
  const cause = (error as { cause?: unknown }).cause
  if (cause !== undefined && depth < 5) lines.push(`cause: ${describeError(cause, depth + 1)}`)
  return lines.join('\n')
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? `${v.toString()}n` : v), 2)
  } catch {
    return String(value)
  }
}
