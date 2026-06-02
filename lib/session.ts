/**
 * Stateless session implementation.
 *
 * Instead of an in-memory Map (which is wiped on server restart / cold start),
 * the userId and DB encryption key are encrypted into the cookie itself using
 * AES-256-GCM keyed from SESSION_SECRET.  Nothing is stored server-side.
 *
 * Cookie format:  <iv_b64>:<authTag_b64>:<ciphertext_b64>.<hmac_hex>
 */
import { randomBytes, createHmac, timingSafeEqual, createCipheriv, createDecipheriv } from 'crypto'

const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-only-secret-change-in-production'

// 32-byte wrapping key derived from SESSION_SECRET via HMAC-SHA256.
// Stable as long as SESSION_SECRET doesn't change.
const WRAP_KEY = createHmac('sha256', 'fm-wrap-key-v1').update(SESSION_SECRET).digest()

interface SessionEntry {
  userId: string
  key: Buffer
}

function hmac(data: string): string {
  return createHmac('sha256', SESSION_SECRET).update(data).digest('hex')
}

function encryptPayload(entry: SessionEntry): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', WRAP_KEY, iv)
  const plain = JSON.stringify({ userId: entry.userId, key: entry.key.toString('base64') })
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

function decryptPayload(enc: string): SessionEntry | null {
  try {
    const parts = enc.split(':')
    if (parts.length !== 3) return null
    const iv = Buffer.from(parts[0], 'base64')
    const tag = Buffer.from(parts[1], 'base64')
    const ct = Buffer.from(parts[2], 'base64')
    const decipher = createDecipheriv('aes-256-gcm', WRAP_KEY, iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
    const { userId, key } = JSON.parse(plain) as { userId: string; key: string }
    return { userId, key: Buffer.from(key, 'base64') }
  } catch {
    return null
  }
}

/** Create a session cookie value. Stateless — nothing stored server-side. */
export function createSession(userId: string, key: Buffer): string {
  const enc = encryptPayload({ userId, key })
  return `${enc}.${hmac(enc)}`
}

/** Verify the signed cookie and return the session entry, or null if invalid/tampered. */
export function verifyAndGetSession(signed: string): SessionEntry | null {
  const dot = signed.lastIndexOf('.')
  if (dot === -1) return null
  const enc = signed.slice(0, dot)
  const sig = signed.slice(dot + 1)
  const expected = hmac(enc)
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return decryptPayload(enc)
}

/** No-op: stateless sessions have nothing to clean up server-side. */
export function destroySession(_signed: string): void {
  // Cookie deletion is handled by the caller (auth route).
}
