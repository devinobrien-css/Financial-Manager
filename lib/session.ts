/**
 * In-memory key store — the derived AES key lives here only while the
 * Next.js dev server process is running. It is never written to disk.
 */
let _sessionKey: Buffer | null = null

export function setSessionKey(key: Buffer): void {
  _sessionKey = key
}

export function getSessionKey(): Buffer | null {
  return _sessionKey
}

export function clearSessionKey(): void {
  _sessionKey = null
}

export function requireSessionKey(): Buffer {
  if (!_sessionKey) throw new Error('LOCKED')
  return _sessionKey
}
