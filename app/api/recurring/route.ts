import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/server-session'
import { encrypt, decrypt } from '@/lib/crypto'
import { v4 as uuidv4 } from 'uuid'
interface RecurringRow {
  id: string
  type: string
  description_enc: string
  amount_enc: string
  account_id: string | null
  to_account_id: string | null
  category_id: number | null
  frequency: string
  next_date: string
  created_at: string
  category_name: string | null
  category_color: string | null
}

interface AccountRow { id: string; name_enc: string }

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session
  const accountRows = db.prepare('SELECT id, name_enc FROM accounts').all() as AccountRow[]
  const accountMap = new Map(accountRows.map(r => {
    try { return [r.id, decrypt(r.name_enc, key)] } catch { return [r.id, '?'] }
  }))

  const rows = db.prepare(`
    SELECT r.*, c.name as category_name, c.color as category_color
    FROM recurring_templates r
    LEFT JOIN categories c ON r.category_id = c.id
    ORDER BY r.next_date ASC
  `).all() as RecurringRow[]

  return NextResponse.json(rows.map(r => ({
    id: r.id,
    type: r.type,
    description: decrypt(r.description_enc, key),
    amount: parseFloat(decrypt(r.amount_enc, key)),
    account_id: r.account_id,
    account_name: r.account_id ? (accountMap.get(r.account_id) ?? null) : null,
    to_account_id: r.to_account_id,
    to_account_name: r.to_account_id ? (accountMap.get(r.to_account_id) ?? null) : null,
    category_id: r.category_id,
    category_name: r.category_name,
    category_color: r.category_color,
    frequency: r.frequency,
    next_date: r.next_date,
    created_at: r.created_at,
  })))
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session

  const body = await req.json()
  const { type, description, amount, account_id, to_account_id, category_id, frequency, next_date } = body

  if (!type || !description || !amount || !frequency || !next_date) {
    return NextResponse.json({ error: 'type, description, amount, frequency, next_date required' }, { status: 400 })
  }
  const VALID_FREQ = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']
  if (!VALID_FREQ.includes(frequency)) return NextResponse.json({ error: 'invalid frequency' }, { status: 400 })

  const numAmount = parseFloat(amount)
  if (isNaN(numAmount) || numAmount <= 0) return NextResponse.json({ error: 'invalid amount' }, { status: 400 })

  const id = uuidv4()
  db.prepare(`
    INSERT INTO recurring_templates
      (id, type, description_enc, amount_enc, account_id, to_account_id, category_id, frequency, next_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, type,
    encrypt(description.trim(), key),
    encrypt(numAmount.toFixed(2), key),
    account_id ?? null, to_account_id ?? null,
    category_id ?? null, frequency, next_date,
  )
  return NextResponse.json({ id }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session

  const body = await req.json()
  const { id, type, description, amount, account_id, to_account_id, category_id, frequency, next_date } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: string[] = []
  const params: unknown[] = []

  if (type !== undefined) { updates.push('type = ?'); params.push(type) }
  if (description !== undefined) { updates.push('description_enc = ?'); params.push(encrypt(description.trim(), key)) }
  if (amount !== undefined) { updates.push('amount_enc = ?'); params.push(encrypt(parseFloat(amount).toFixed(2), key)) }
  if (account_id !== undefined) { updates.push('account_id = ?'); params.push(account_id ?? null) }
  if (to_account_id !== undefined) { updates.push('to_account_id = ?'); params.push(to_account_id ?? null) }
  if (category_id !== undefined) { updates.push('category_id = ?'); params.push(category_id ?? null) }
  if (frequency !== undefined) { updates.push('frequency = ?'); params.push(frequency) }
  if (next_date !== undefined) { updates.push('next_date = ?'); params.push(next_date) }

  if (updates.length === 0) return NextResponse.json({ ok: true })
  params.push(id)
  db.prepare(`UPDATE recurring_templates SET ${updates.join(', ')} WHERE id = ?`).run(...(params as Parameters<typeof db.prepare>))
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { db } = session
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  db.prepare('DELETE FROM recurring_templates WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}
