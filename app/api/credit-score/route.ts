import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/server-session'
import { encrypt, decrypt } from '@/lib/crypto'
import { v4 as uuidv4 } from 'uuid'
interface ScoreRow {
  id: string
  score: number
  date: string
  notes_enc: string | null
  created_at: string
}

// GET /api/credit-score — list all entries sorted by date desc
export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session
  const rows = db.prepare('SELECT * FROM credit_score_history ORDER BY date DESC').all() as ScoreRow[]
  const result = rows.map(r => ({
    id: r.id,
    score: r.score,
    date: r.date,
    notes: r.notes_enc ? decrypt(r.notes_enc, key) : null,
    created_at: r.created_at,
  }))
  return NextResponse.json(result)
}

// POST /api/credit-score — add a new entry
export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session

  const body = await req.json() as { score?: number; date?: string; notes?: string }
  const { score, date, notes } = body

  if (typeof score !== 'number' || score < 300 || score > 850) {
    return NextResponse.json({ error: 'score must be 300–850' }, { status: 400 })
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  const id = uuidv4()
  const notes_enc = notes ? encrypt(notes, key) : null
  db.prepare('INSERT INTO credit_score_history (id, score, date, notes_enc) VALUES (?, ?, ?, ?)').run(id, score, date, notes_enc)
  return NextResponse.json({ id, score, date, notes: notes ?? null }, { status: 201 })
}

// DELETE /api/credit-score — delete an entry by id
export async function DELETE(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { db } = session

  const body = await req.json() as { id?: string }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  db.prepare('DELETE FROM credit_score_history WHERE id = ?').run(body.id)
  return NextResponse.json({ ok: true })
}
