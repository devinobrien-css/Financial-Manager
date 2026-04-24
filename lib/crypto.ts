import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LEN = 32
const ITERATIONS = 310_000
const DIGEST = 'sha256'
const SALT_LEN = 32
const IV_LEN = 12

/** Derive a 256-bit key from a password + salt using PBKDF2 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST)
}

/** Generate a random salt (for first-time setup) */
export function generateSalt(): Buffer {
  return crypto.randomBytes(SALT_LEN)
}

/** Encrypt plaintext string → base64 ciphertext (IV:authTag:cipher) */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':')
}

/** Decrypt base64 ciphertext → plaintext string */
export function decrypt(ciphertext: string, key: Buffer): string {
  const [ivB64, authTagB64, dataB64] = ciphertext.split(':')
  if (!ivB64 || !authTagB64 || !dataB64) throw new Error('Invalid ciphertext format')
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const data = Buffer.from(dataB64, 'base64')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/** Create a verifier token (encrypted known string) so we can test a password against the stored key */
export function makeVerifier(key: Buffer): string {
  return encrypt('financial-manager-verified', key)
}

/** Returns true if the key successfully decrypts the stored verifier */
export function verifyKey(verifier: string, key: Buffer): boolean {
  try {
    const result = decrypt(verifier, key)
    return result === 'financial-manager-verified'
  } catch {
    return false
  }
}
