#!/usr/bin/env node
/**
 * One-time migration: moves the old single-user finance.db into the new
 * per-user structure without needing to re-encrypt any data.
 *
 * Usage:
 *   node migrate.mjs <username> <password>
 *
 * The password MUST be the same password you used with the old app.
 */

import Database from 'better-sqlite3'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const OLD_DB = path.join(__dirname, 'data', 'finance.db')
const USERS_DB = path.join(__dirname, 'data', '_users.db')
const USERS_DIR = path.join(__dirname, 'data', 'users')

// ── Args ─────────────────────────────────────────────────────────────────────
const [,, username, password] = process.argv
if (!username || !password) {
  console.error('Usage: node migrate.mjs <username> <password>')
  process.exit(1)
}
if (!fs.existsSync(OLD_DB)) {
  console.error(`Old database not found at: ${OLD_DB}`)
  process.exit(1)
}

// ── Derive key + verify against old DB ───────────────────────────────────────
const oldDb = new Database(OLD_DB, { readonly: true })
const auth = oldDb.prepare('SELECT salt, verifier_enc FROM auth WHERE id = 1').get()
oldDb.close()

if (!auth) {
  console.error('No auth record found in old database. Was the app ever set up?')
  process.exit(1)
}

const salt = Buffer.from(auth.salt, 'base64')
const key = crypto.pbkdf2Sync(password, salt, 310_000, 32, 'sha256')

// Verify the key decrypts the known verifier string
function verifyKey(verifier, key) {
  try {
    const [ivB64, authTagB64, dataB64] = verifier.split(':')
    const iv = Buffer.from(ivB64, 'base64')
    const authTag = Buffer.from(authTagB64, 'base64')
    const data = Buffer.from(dataB64, 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const result = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
    return result === 'financial-manager-verified'
  } catch { return false }
}

if (!verifyKey(auth.verifier_enc, key)) {
  console.error('❌  Password is incorrect — it does not match the old database.')
  process.exit(1)
}
console.log('✅  Password verified against old database.')

// ── Create user in _users.db ──────────────────────────────────────────────────
const usersDb = new Database(USERS_DB)
usersDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)

const existing = usersDb.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username)
if (existing) {
  console.error(`❌  Username "${username}" already exists in the user registry.`)
  console.error(`    Run: sqlite3 data/_users.db "SELECT id, username FROM users;"  to see existing users.`)
  usersDb.close()
  process.exit(1)
}

const userId = randomUUID()
usersDb.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(userId, username.trim())
usersDb.close()
console.log(`✅  Created user "${username}" with id: ${userId}`)

// ── Copy old DB to new per-user location ──────────────────────────────────────
const userDir = path.join(USERS_DIR, userId)
fs.mkdirSync(userDir, { recursive: true })
const destDb = path.join(userDir, 'finance.db')
fs.copyFileSync(OLD_DB, destDb)
// Copy WAL/SHM files if they exist
for (const ext of ['-wal', '-shm']) {
  const src = OLD_DB + ext
  if (fs.existsSync(src)) fs.copyFileSync(src, destDb + ext)
}
console.log(`✅  Copied old database to: ${destDb}`)

console.log(`
Done! You can now log in to the app with:
  Username: ${username}
  Password: (your old password)
`)
