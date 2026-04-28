import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/server-session'
import { encrypt, decrypt } from '@/lib/crypto'
import { v4 as uuidv4 } from 'uuid'
interface SnapshotRow {
  id: string
  month: string
  amount_enc: string
  created_at: string
}

// GET /api/net-worth — list all snapshots sorted by month
export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session
  const rows = db.prepare('SELECT * FROM net_worth_snapshots ORDER BY month ASC').all() as SnapshotRow[]
  const result = rows.map(r => ({
    id: r.id,
    month: r.month,
    amount: parseFloat(decrypt(r.amount_enc, key)),
    created_at: r.created_at,
  }))
  return NextResponse.json(result)
}

// POST /api/net-worth — upsert a snapshot for a given month
export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session

  const body = await req.json() as { month?: string; amount?: number }
  const { month, amount } = body

  if (!month || typeof amount !== 'number') {
    return NextResponse.json({ error: 'month and amount are required' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }

  const amount_enc = encrypt(String(amount), key)

  const existing = db.prepare('SELECT id FROM net_worth_snapshots WHERE month = ?').get(month) as { id: string } | undefined
  if (existing) {
    db.prepare('UPDATE net_worth_snapshots SET amount_enc = ? WHERE month = ?').run(amount_enc, month)
    return NextResponse.json({ id: existing.id, month, amount })
  }

  const id = uuidv4()
  db.prepare('INSERT INTO net_worth_snapshots (id, month, amount_enc) VALUES (?, ?, ?)').run(id, month, amount_enc)
  return NextResponse.json({ id, month, amount }, { status: 201 })
}

// DELETE /api/net-worth — delete a snapshot by id
export async function DELETE(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { db } = session

  const body = await req.json() as { id?: string }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  db.prepare('DELETE FROM net_worth_snapshots WHERE id = ?').run(body.id)
  return NextResponse.json({ ok: true })
}
