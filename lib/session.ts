import { randomBytes, createHmac, timingSafeEqual } from 'crypto'

const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-only-secret-change-in-production'

interface SessionEntry {
  userId: string
  key: Buffer
}

// In-memory session store: token → entry
// Tokens never leave this Map without being HMAC-signed.
const _sessions = new Map<string, SessionEntry>()

function hmac(token: string): string {
  return createHmac('sha256', SESSION_SECRET).update(token).digest('hex')
}

/** Create a new session, returns a signed cookie value: `token.sig` */
export function createSession(userId: string, key: Buffer): string {
  const token = randomBytes(32).toString('hex')
  _sessions.set(token, { userId, key })
  return `${token}.${hmac(token)}`
}

/** Verify the signed value and return the session entry, or null if invalid. */
export function verifyAndGetSession(signed: string): SessionEntry | null {
  const dot = signed.lastIndexOf('.')
  if (dot === -1) return null
  const token = signed.slice(0, dot)
  const sig = signed.slice(dot + 1)
  const expected = hmac(token)
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return _sessions.get(token) ?? null
}

/** Destroy a session by its signed cookie value. */
export function destroySession(signed: string): void {
  const dot = signed.lastIndexOf('.')
  if (dot === -1) return
  _sessions.delete(signed.slice(0, dot))
}
