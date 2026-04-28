/**
 * User registry — a small unencrypted SQLite DB that maps usernames → UUIDs.
 * Actual financial data lives in per-user encrypted DBs under data/users/{id}/.
 */
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_DIR = path.join(process.cwd(), 'data')
let _userDb: Database.Database | null = null

interface UserRow {
  id: string
  username: string
  created_at: string
}

function getUserDb(): Database.Database {
  if (_userDb) return _userDb
  fs.mkdirSync(DB_DIR, { recursive: true })
  _userDb = new Database(path.join(DB_DIR, '_users.db'))
  _userDb.pragma('journal_mode = WAL')
  _userDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  return _userDb
}

export function findUserByUsername(username: string): UserRow | undefined {
  return getUserDb()
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username.trim()) as UserRow | undefined
}

export function createUser(id: string, username: string): void {
  getUserDb()
    .prepare('INSERT INTO users (id, username) VALUES (?, ?)')
    .run(id, username.trim())
}

export function userCount(): number {
  const row = getUserDb().prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }
  return row.n
}
