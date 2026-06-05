/**
 * Encrypted chat persistence.
 *
 * Sessions and messages live in the per-user finance.db. Both the session
 * title and message content are encrypted with the user key (they can contain
 * decrypted financial figures), consistent with the rest of the DB.
 *
 * The key is only available inside API routes (from getServerSession), so it
 * is passed explicitly into every function here.
 */
import { v4 as uuidv4 } from 'uuid'
import type Database from 'better-sqlite3'
import { encrypt, decrypt } from '@/lib/crypto'
import type { ChatTurn } from './pipeline'

export interface ChatSessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface ChatMessage extends ChatTurn {
  id: string
  createdAt: string
}

const safeDecrypt = (enc: string, key: Buffer, fallback = ''): string => {
  try {
    return decrypt(enc, key)
  } catch {
    return fallback
  }
}

export function listSessions(db: Database.Database, key: Buffer): ChatSessionMeta[] {
  const rows = db
    .prepare(
      'SELECT id, title_enc, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC',
    )
    .all() as { id: string; title_enc: string; created_at: string; updated_at: string }[]
  return rows.map((r) => ({
    id: r.id,
    title: safeDecrypt(r.title_enc, key, 'Untitled chat'),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

export function createSession(
  db: Database.Database,
  key: Buffer,
  title: string,
): ChatSessionMeta {
  const id = uuidv4()
  db.prepare('INSERT INTO chat_sessions (id, title_enc) VALUES (?, ?)').run(
    id,
    encrypt(title.slice(0, 200), key),
  )
  const row = db
    .prepare('SELECT created_at, updated_at FROM chat_sessions WHERE id = ?')
    .get(id) as { created_at: string; updated_at: string }
  return { id, title, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function sessionExists(db: Database.Database, sessionId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM chat_sessions WHERE id = ?').get(sessionId))
}

export function renameSession(
  db: Database.Database,
  key: Buffer,
  sessionId: string,
  title: string,
): void {
  db.prepare('UPDATE chat_sessions SET title_enc = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    encrypt(title.slice(0, 200), key),
    sessionId,
  )
}

export function deleteSession(db: Database.Database, sessionId: string): void {
  // chat_messages cascade via FK.
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId)
}

export function getMessages(
  db: Database.Database,
  key: Buffer,
  sessionId: string,
): ChatMessage[] {
  const rows = db
    .prepare(
      'SELECT id, role, content_enc, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC',
    )
    .all(sessionId) as {
    id: string
    role: 'user' | 'assistant'
    content_enc: string
    created_at: string
  }[]
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: safeDecrypt(r.content_enc, key),
    createdAt: r.created_at,
  }))
}

export function addMessage(
  db: Database.Database,
  key: Buffer,
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
): ChatMessage {
  const id = uuidv4()
  db.transaction(() => {
    db.prepare(
      'INSERT INTO chat_messages (id, session_id, role, content_enc) VALUES (?, ?, ?, ?)',
    ).run(id, sessionId, role, encrypt(content, key))
    db.prepare("UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId)
  })()
  const row = db
    .prepare('SELECT created_at FROM chat_messages WHERE id = ?')
    .get(id) as { created_at: string }
  return { id, role, content, createdAt: row.created_at }
}

/** Return decrypted turns (role/content only) for feeding the model. */
export function getTurns(db: Database.Database, key: Buffer, sessionId: string): ChatTurn[] {
  return getMessages(db, key, sessionId).map((m) => ({ role: m.role, content: m.content }))
}
