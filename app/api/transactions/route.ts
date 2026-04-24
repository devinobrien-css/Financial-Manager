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
  memo_enc: string | null
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
    memo: row.memo_enc ? decrypt(row.memo_enc, key) : null,
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
  const accountIdFilter = searchParams.get('account_id') // for statement view
  const allTx = searchParams.get('all') === '1'

  const db = getDb()
  const accountMap = buildAccountMap(key)

  let rows: TxRow[]
  if (accountIdFilter) {
    rows = db.prepare(`
      SELECT t.*, c.name as category_name, c.color as category_color
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.account_id = ? OR t.to_account_id = ?
      ORDER BY t.date DESC, t.created_at DESC
    `).all(accountIdFilter, accountIdFilter) as TxRow[]
  } else if (month) {
    rows = db.prepare(`
      SELECT t.*, c.name as category_name, c.color as category_color
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.date LIKE ?
      ORDER BY t.date DESC, t.created_at DESC
    `).all(`${month}%`) as TxRow[]
  } else {
    const limit = allTx ? '' : 'LIMIT 500'
    rows = db.prepare(`
      SELECT t.*, c.name as category_name, c.color as category_color
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      ORDER BY t.date DESC, t.created_at DESC
      ${limit}
    `).all() as TxRow[]
  }

  return NextResponse.json(rows.map(r => decryptRow(r, key, accountMap)))
}

export async function POST(req: NextRequest) {
  let key: Buffer
  try { key = requireSessionKey() } catch { return NextResponse.json({ error: 'LOCKED' }, { status: 401 }) }

  const body = await req.json()
  const { type, amount, description, memo, category_id, account_id, to_account_id, date } = body

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
  const memo_enc = memo ? encrypt(memo.trim(), key) : null

  db.prepare(`
    INSERT INTO transactions
      (id, type, amount_enc, description_enc, memo_enc, category_id, account_id, to_account_id, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, type, amount_enc, description_enc, memo_enc,
    type === 'transfer' ? null : (category_id ?? null),
    account_id ?? null, to_account_id ?? null, date,
  )

  return NextResponse.json({ id }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  let key: Buffer
  try { key = requireSessionKey() } catch { return NextResponse.json({ error: 'LOCKED' }, { status: 401 }) }

  const body = await req.json()
  const { id, type, amount, description, memo, category_id, account_id, to_account_id, date } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = getDb()
  const updates: string[] = []
  const params: unknown[] = []

  if (type !== undefined) { updates.push('type = ?'); params.push(type) }
  if (amount !== undefined) { updates.push('amount_enc = ?'); params.push(encrypt(parseFloat(amount).toFixed(2), key)) }
  if (description !== undefined) { updates.push('description_enc = ?'); params.push(description ? encrypt(description.trim(), key) : null) }
  if (memo !== undefined) { updates.push('memo_enc = ?'); params.push(memo ? encrypt(memo.trim(), key) : null) }
  if (category_id !== undefined) { updates.push('category_id = ?'); params.push(category_id ?? null) }
  if (account_id !== undefined) { updates.push('account_id = ?'); params.push(account_id ?? null) }
  if (to_account_id !== undefined) { updates.push('to_account_id = ?'); params.push(to_account_id ?? null) }
  if (date !== undefined) { updates.push('date = ?'); params.push(date) }

  if (updates.length === 0) return NextResponse.json({ ok: true })
  params.push(id)
  db.prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`).run(...(params as Parameters<typeof db.prepare>))
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  try { requireSessionKey() } catch { return NextResponse.json({ error: 'LOCKED' }, { status: 401 }) }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = getDb()
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}
