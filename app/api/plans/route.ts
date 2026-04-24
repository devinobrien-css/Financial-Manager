import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/crypto'
import { requireSessionKey } from '@/lib/session'
import { v4 as uuidv4 } from 'uuid'

interface GoalRow {
  id: string
  title_enc: string
  notes_enc: string | null
  amount_enc: string | null
  saved_amount_enc: string | null
  target_date: string | null
  color: string
  completed: number
  created_at: string
}

function decryptGoal(row: GoalRow, key: Buffer) {
  return {
    id: row.id,
    title: decrypt(row.title_enc, key),
    notes: row.notes_enc ? decrypt(row.notes_enc, key) : null,
    target_amount: row.amount_enc ? parseFloat(decrypt(row.amount_enc, key)) : null,
    saved_amount: row.saved_amount_enc ? parseFloat(decrypt(row.saved_amount_enc, key)) : null,
    target_date: row.target_date,
    color: row.color ?? 'yellow',
    completed: row.completed === 1,
    created_at: row.created_at,
  }
}

export async function GET() {
  let key: Buffer
  try { key = requireSessionKey() } catch { return NextResponse.json({ error: 'LOCKED' }, { status: 401 }) }

  const db = getDb()
  const rows = db.prepare('SELECT * FROM goals ORDER BY completed ASC, created_at DESC').all() as GoalRow[]
  return NextResponse.json(rows.map(r => decryptGoal(r, key)))
}

export async function POST(req: NextRequest) {
  let key: Buffer
  try { key = requireSessionKey() } catch { return NextResponse.json({ error: 'LOCKED' }, { status: 401 }) }

  const { title, notes, target_amount, saved_amount, target_date, color } = await req.json()
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })

  const db = getDb()
  db.prepare(`
    INSERT INTO goals (id, title_enc, notes_enc, amount_enc, saved_amount_enc, target_date, color)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    encrypt(title.trim(), key),
    notes?.trim() ? encrypt(notes.trim(), key) : null,
    target_amount != null ? encrypt(String(target_amount), key) : null,
    saved_amount != null ? encrypt(String(saved_amount), key) : null,
    target_date || null,
    color ?? 'yellow',
  )

  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  let key: Buffer
  try { key = requireSessionKey() } catch { return NextResponse.json({ error: 'LOCKED' }, { status: 401 }) }

  const body = await req.json()
  const { id, title, notes, target_amount, saved_amount, target_date, completed, color } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = getDb()
  const row = db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as GoalRow | undefined
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updates: string[] = []
  const params: unknown[] = []

  if (title !== undefined) {
    updates.push('title_enc = ?')
    params.push(encrypt(title.trim(), key))
  }
  if (notes !== undefined) {
    updates.push('notes_enc = ?')
    params.push(notes?.trim() ? encrypt(notes.trim(), key) : null)
  }
  if (target_amount !== undefined) {
    updates.push('amount_enc = ?')
    params.push(target_amount != null ? encrypt(String(target_amount), key) : null)
  }
  if (saved_amount !== undefined) {
    updates.push('saved_amount_enc = ?')
    params.push(saved_amount != null ? encrypt(String(saved_amount), key) : null)
  }
  if (target_date !== undefined) {
    updates.push('target_date = ?')
    params.push(target_date || null)
  }
  if (completed !== undefined) {
    updates.push('completed = ?')
    params.push(completed ? 1 : 0)
  }
  if (color !== undefined) {
    updates.push('color = ?')
    params.push(color ?? 'yellow')
  }

  if (updates.length === 0) return NextResponse.json({ ok: true })

  params.push(id)
  db.prepare(`UPDATE goals SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  let key: Buffer
  try { key = requireSessionKey() } catch { return NextResponse.json({ error: 'LOCKED' }, { status: 401 }) }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  getDb().prepare('DELETE FROM goals WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}
