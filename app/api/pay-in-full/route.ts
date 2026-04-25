import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireSessionKey } from '@/lib/session'
import { v4 as uuidv4 } from 'uuid'

interface PayInFullRow {
  id: string
  account_id: string
  month: string
  paid: number
}

// GET /api/pay-in-full?month=YYYY-MM — get pay-in-full status for all credit accounts that month
export async function GET(req: NextRequest) {
  try { requireSessionKey() } catch { return NextResponse.json({ error: 'LOCKED' }, { status: 401 }) }

  const month = req.nextUrl.searchParams.get('month')
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required (YYYY-MM)' }, { status: 400 })
  }

  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM pay_in_full_log WHERE month = ?'
  ).all(month) as PayInFullRow[]

  return NextResponse.json(
    rows.map(r => ({ id: r.id, account_id: r.account_id, month: r.month, paid: r.paid === 1 }))
  )
}

// PATCH /api/pay-in-full — upsert paid status for account + month
export async function PATCH(req: NextRequest) {
  try { requireSessionKey() } catch { return NextResponse.json({ error: 'LOCKED' }, { status: 401 }) }

  const body = await req.json() as { account_id?: string; month?: string; paid?: boolean }
  const { account_id, month, paid } = body

  if (!account_id || !month || typeof paid !== 'boolean') {
    return NextResponse.json({ error: 'account_id, month, and paid are required' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }

  const db = getDb()
  const existing = db.prepare(
    'SELECT id FROM pay_in_full_log WHERE account_id = ? AND month = ?'
  ).get(account_id, month) as { id: string } | undefined

  if (existing) {
    db.prepare('UPDATE pay_in_full_log SET paid = ? WHERE id = ?').run(paid ? 1 : 0, existing.id)
    return NextResponse.json({ id: existing.id, account_id, month, paid })
  }

  const id = uuidv4()
  db.prepare('INSERT INTO pay_in_full_log (id, account_id, month, paid) VALUES (?, ?, ?, ?)').run(id, account_id, month, paid ? 1 : 0)
  return NextResponse.json({ id, account_id, month, paid }, { status: 201 })
}
