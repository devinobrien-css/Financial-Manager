import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/server-session'
import { encrypt, decrypt } from '@/lib/crypto'
import { v4 as uuidv4 } from 'uuid'
interface ForecastRow {
  id: string
  type: string
  label_enc: string
  amount_enc: string
  date: string
  account_id: string | null
  to_account_id: string | null
  category_id: number | null
  sort_order: number
  created_at: string
}

function decryptPlan(row: ForecastRow, key: Buffer) {
  return {
    id: row.id,
    type: row.type,
    label: decrypt(row.label_enc, key),
    amount: Number.parseFloat(decrypt(row.amount_enc, key)),
    date: row.date,
    account_id: row.account_id,
    to_account_id: row.to_account_id,
    category_id: row.category_id,
    sort_order: row.sort_order,
  }
}

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session
  const rows = db.prepare(
    'SELECT * FROM forecast_plans ORDER BY date ASC, sort_order ASC, created_at ASC'
  ).all() as ForecastRow[]
  return NextResponse.json(rows.map(r => decryptPlan(r, key)))
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session

  const body = await req.json()
  const { type, label, amount, date, account_id, to_account_id, category_id } = body

  if (!type || !label?.trim() || !amount || !date) {
    return NextResponse.json({ error: 'type, label, amount, and date are required' }, { status: 400 })
  }
  if (!['income', 'expense', 'transfer'].includes(type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  }
  const amt = Number.parseFloat(amount)
  if (Number.isNaN(amt) || amt <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  }

  const id = uuidv4()
  db.prepare(`
    INSERT INTO forecast_plans
      (id, type, label_enc, amount_enc, date, account_id, to_account_id, category_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    type,
    encrypt(label.trim(), key),
    encrypt(amt.toFixed(2), key),
    date,
    account_id || null,
    to_account_id || null,
    category_id ?? null,
  )

  return NextResponse.json({ id }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session

  const body = await req.json()
  const { id, type, label, amount, date, account_id, to_account_id, category_id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = db.prepare('SELECT id FROM forecast_plans WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updates: string[] = []
  const params: unknown[] = []

  if (type !== undefined) { updates.push('type = ?'); params.push(type) }
  if (label !== undefined) { updates.push('label_enc = ?'); params.push(encrypt(label.trim(), key)) }
  if (amount !== undefined) { updates.push('amount_enc = ?'); params.push(encrypt(Number.parseFloat(amount).toFixed(2), key)) }
  if (date !== undefined) { updates.push('date = ?'); params.push(date) }
  if ('account_id' in body) { updates.push('account_id = ?'); params.push(account_id || null) }
  if ('to_account_id' in body) { updates.push('to_account_id = ?'); params.push(to_account_id || null) }
  if ('category_id' in body) { updates.push('category_id = ?'); params.push(category_id ?? null) }

  if (updates.length === 0) return NextResponse.json({ ok: true })

  params.push(id)
  db.prepare(`UPDATE forecast_plans SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  db.prepare('DELETE FROM forecast_plans WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}
