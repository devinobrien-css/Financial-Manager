import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/crypto'
import { requireSessionKey } from '@/lib/session'
import { v4 as uuidv4 } from 'uuid'

interface TxRow {
  id: string
  type: string
  amount_enc: string
  description_enc: string | null
  category_id: number | null
  account_id: string | null
  to_account_id: string | null
  date: string
  created_at: string
  category_name: string | null
  category_color: string | null
}

interface AccountNameRow {
  id: string
  name_enc: string
}

function buildAccountMap(key: Buffer): Map<string, string> {
  const db = getDb()
  const rows = db.prepare('SELECT id, name_enc FROM accounts').all() as AccountNameRow[]
  const map = new Map<string, string>()
  for (const r of rows) {
    try { map.set(r.id, decrypt(r.name_enc, key)) } catch { map.set(r.id, '?') }
  }
  return map
}

function decryptRow(row: TxRow, key: Buffer, accountMap: Map<string, string>) {
  return {
    id: row.id,
    type: row.type,
    amount: parseFloat(decrypt(row.amount_enc, key)),
    description: row.description_enc ? decrypt(row.description_enc, key) : '',
    category_id: row.category_id,
    category_name: row.category_name,
    category_color: row.category_color,
    account_id: row.account_id,
    account_name: row.account_id ? (accountMap.get(row.account_id) ?? null) : null,
    to_account_id: row.to_account_id,
    to_account_name: row.to_account_id ? (accountMap.get(row.to_account_id) ?? null) : null,
    date: row.date,
    created_at: row.created_at,
  }
}

export async function GET(req: NextRequest) {
  let key: Buffer
  try { key = requireSessionKey() } catch { return NextResponse.json({ error: 'LOCKED' }, { status: 401 }) }

  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month') // YYYY-MM

  const db = getDb()
  const accountMap = buildAccountMap(key)

  let rows: TxRow[]
  if (month) {
    rows = db.prepare(`
      SELECT t.*, c.name as category_name, c.color as category_color
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.date LIKE ?
      ORDER BY t.date DESC, t.created_at DESC
    `).all(`${month}%`) as TxRow[]
  } else {
    rows = db.prepare(`
      SELECT t.*, c.name as category_name, c.color as category_color
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      ORDER BY t.date DESC, t.created_at DESC
      LIMIT 500
    `).all() as TxRow[]
  }

  return NextResponse.json(rows.map(r => decryptRow(r, key, accountMap)))
}

export async function POST(req: NextRequest) {
  let key: Buffer
  try { key = requireSessionKey() } catch { return NextResponse.json({ error: 'LOCKED' }, { status: 401 }) }

  const body = await req.json()
  const { type, amount, description, category_id, account_id, to_account_id, date } = body

  if (!type || !amount || !date) {
    return NextResponse.json({ error: 'type, amount, and date are required' }, { status: 400 })
  }
  if (!['income', 'expense', 'transfer'].includes(type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  }
  if (type === 'transfer' && (!account_id || !to_account_id)) {
    return NextResponse.json({ error: 'transfer requires account_id and to_account_id' }, { status: 400 })
  }
  const numAmount = parseFloat(amount)
  if (isNaN(numAmount) || numAmount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  }

  const db = getDb()
  const id = uuidv4()
  const amount_enc = encrypt(numAmount.toFixed(2), key)
  const description_enc = description ? encrypt(description.trim(), key) : null

  db.prepare(`
    INSERT INTO transactions
      (id, type, amount_enc, description_enc, category_id, account_id, to_account_id, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    type,
    amount_enc,
    description_enc,
    type === 'transfer' ? null : (category_id ?? null),
    account_id ?? null,
    to_account_id ?? null,
    date,
  )

  return NextResponse.json({ id }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  try { requireSessionKey() } catch { return NextResponse.json({ error: 'LOCKED' }, { status: 401 }) }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = getDb()
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}
