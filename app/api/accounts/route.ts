import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/server-session'
import { encrypt, decrypt } from '@/lib/crypto'
import { v4 as uuidv4 } from 'uuid'
interface AccountRow {
  id: string
  name_enc: string
  type: string
  opening_balance_enc: string
  apr_enc: string | null
  credit_limit_enc: string | null
  created_at: string
}

interface TxBalanceRow {
  account_id: string | null
  to_account_id: string | null
  type: string
  amount_enc: string
}

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session
  const accounts = db.prepare(
    'SELECT * FROM accounts ORDER BY sort_order ASC, created_at ASC'
  ).all() as AccountRow[]

  const txRows = db.prepare(
    'SELECT account_id, to_account_id, type, amount_enc FROM transactions'
  ).all() as TxBalanceRow[]

  // Compute each account's running balance from all transactions
  const effects = new Map<string, number>()
  for (const tx of txRows) {
    let amount: number
    try { amount = parseFloat(decrypt(tx.amount_enc, key)) } catch { continue }

    if (tx.type === 'income' && tx.account_id) {
      effects.set(tx.account_id, (effects.get(tx.account_id) ?? 0) + amount)
    } else if (tx.type === 'expense' && tx.account_id) {
      effects.set(tx.account_id, (effects.get(tx.account_id) ?? 0) - amount)
    } else if (tx.type === 'transfer') {
      if (tx.account_id) {
        effects.set(tx.account_id, (effects.get(tx.account_id) ?? 0) - amount)
      }
      if (tx.to_account_id) {
        effects.set(tx.to_account_id, (effects.get(tx.to_account_id) ?? 0) + amount)
      }
    }
  }

  const result = accounts.map(a => {
    const opening = parseFloat(decrypt(a.opening_balance_enc, key))
    const balance = opening + (effects.get(a.id) ?? 0)
    const apr = a.apr_enc ? parseFloat(decrypt(a.apr_enc, key)) : null
    const credit_limit = a.credit_limit_enc ? parseFloat(decrypt(a.credit_limit_enc, key)) : null
    return {
      id: a.id,
      name: decrypt(a.name_enc, key),
      type: a.type,
      opening_balance: opening,
      balance,
      apr,
      credit_limit,
      monthly_interest: (apr !== null && balance < 0) ? Math.abs(balance) * (apr / 100 / 12) : null,
      created_at: a.created_at,
    }
  })

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session

  const body = await req.json()
  const { name, type, opening_balance, apr, credit_limit } = body

  if (!name || !type) {
    return NextResponse.json({ error: 'name and type are required' }, { status: 400 })
  }
  if (!['checking', 'savings', 'credit', 'cash', 'loan'].includes(type)) {
    return NextResponse.json({ error: 'invalid account type' }, { status: 400 })
  }

  const rawBalance = parseFloat(opening_balance ?? '0')
  if (isNaN(rawBalance)) {
    return NextResponse.json({ error: 'invalid opening balance' }, { status: 400 })
  }

  // For credit/loan the user enters current debt as a positive number;
  // store as negative so the universal balance formula works correctly.
  const storedBalance = (type === 'credit' || type === 'loan') ? -Math.abs(rawBalance) : rawBalance

  let aprEnc: string | null = null
  if ((type === 'credit' || type === 'loan') && apr !== undefined && apr !== null && apr !== '') {
    const aprNum = parseFloat(apr)
    if (!isNaN(aprNum) && aprNum >= 0) aprEnc = encrypt(aprNum.toFixed(4), key)
  }

  let creditLimitEnc: string | null = null
  if (type === 'credit' && credit_limit !== undefined && credit_limit !== null && credit_limit !== '') {
    const lim = parseFloat(credit_limit)
    if (!isNaN(lim) && lim > 0) creditLimitEnc = encrypt(lim.toFixed(2), key)
  }

  const id = uuidv4()
  db.prepare(
    'INSERT INTO accounts (id, name_enc, type, opening_balance_enc, apr_enc, credit_limit_enc) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, encrypt(name.trim(), key), type, encrypt(storedBalance.toFixed(2), key), aprEnc, creditLimitEnc)

  return NextResponse.json({ id, name: name.trim(), type, balance: storedBalance, apr: apr ?? null, credit_limit: credit_limit ?? null }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session

  const body = await req.json()

  // Reorder: { reorder: string[] } — array of account ids in new order
  if (Array.isArray(body.reorder)) {
    const update = db.prepare('UPDATE accounts SET sort_order = ? WHERE id = ?')
    db.transaction(() => {
      ;(body.reorder as string[]).forEach((id, i) => update.run(i, id))
    })()
    return NextResponse.json({ ok: true })
  }

  const { id, name, type, opening_balance, apr, credit_limit } = body

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (type && !['checking', 'savings', 'credit', 'cash', 'loan'].includes(type)) {
    return NextResponse.json({ error: 'invalid account type' }, { status: 400 })
  }

  const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id)
  if (!existing) return NextResponse.json({ error: 'account not found' }, { status: 404 })

  const updates: string[] = []
  const params: unknown[] = []

  if (name !== undefined) {
    updates.push('name_enc = ?')
    params.push(encrypt(name.trim(), key))
  }
  if (type !== undefined) {
    updates.push('type = ?')
    params.push(type)
  }
  if (opening_balance !== undefined) {
    const rawBalance = parseFloat(opening_balance)
    if (isNaN(rawBalance)) return NextResponse.json({ error: 'invalid opening balance' }, { status: 400 })
    const resolvedType = type ?? (existing as { type: string }).type
    const storedBalance = (resolvedType === 'credit' || resolvedType === 'loan')
      ? -Math.abs(rawBalance)
      : rawBalance
    updates.push('opening_balance_enc = ?')
    params.push(encrypt(storedBalance.toFixed(2), key))
  }
  if (apr !== undefined) {
    const resolvedType = type ?? (existing as { type: string }).type
    if ((resolvedType === 'credit' || resolvedType === 'loan') && apr !== null && apr !== '') {
      const aprNum = parseFloat(apr)
      updates.push('apr_enc = ?')
      params.push(!isNaN(aprNum) && aprNum >= 0 ? encrypt(aprNum.toFixed(4), key) : null)
    } else {
      updates.push('apr_enc = ?')
      params.push(null)
    }
  }
  if (credit_limit !== undefined) {
    const resolvedType = type ?? (existing as { type: string }).type
    if (resolvedType === 'credit' && credit_limit !== null && credit_limit !== '') {
      const lim = parseFloat(credit_limit)
      updates.push('credit_limit_enc = ?')
      params.push(!isNaN(lim) && lim > 0 ? encrypt(lim.toFixed(2), key) : null)
    } else {
      updates.push('credit_limit_enc = ?')
      params.push(null)
    }
  }

  if (updates.length === 0) return NextResponse.json({ ok: true })

  params.push(id)
  db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`).run(...(params as Parameters<typeof db.prepare>))

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { db } = session

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}
