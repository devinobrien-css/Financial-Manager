import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/crypto'
import { requireSessionKey } from '@/lib/session'

interface CatRow {
  id: number
  name: string
  type: string
  color: string
  icon: string | null
  monthly_budget_enc: string | null
}

export async function GET() {
  let key: Buffer | null = null
  try { key = requireSessionKey() } catch { /* budget field won't be decrypted */ }

  const db = getDb()
  const rows = db.prepare('SELECT * FROM categories ORDER BY type, name').all() as CatRow[]
  return NextResponse.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    type: r.type,
    color: r.color,
    icon: r.icon,
    monthly_budget: (key && r.monthly_budget_enc) ? parseFloat(decrypt(r.monthly_budget_enc, key)) : null,
  })))
}

export async function POST(req: NextRequest) {
  const { name, type, color, icon } = await req.json()
  if (!name || !type) return NextResponse.json({ error: 'name and type required' }, { status: 400 })
  if (!['income', 'expense'].includes(type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 })

  const db = getDb()
  const result = db
    .prepare('INSERT INTO categories (name, type, color, icon) VALUES (?, ?, ?, ?)')
    .run(name.trim(), type, color ?? '#6b7280', icon ?? null)

  return NextResponse.json({ id: result.lastInsertRowid, name, type, color, icon }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  let key: Buffer
  try { key = requireSessionKey() } catch { return NextResponse.json({ error: 'LOCKED' }, { status: 401 }) }

  const { id, monthly_budget } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = getDb()
  const enc = (monthly_budget !== null && monthly_budget !== undefined && monthly_budget !== '')
    ? encrypt(parseFloat(monthly_budget).toFixed(2), key)
    : null
  db.prepare('UPDATE categories SET monthly_budget_enc = ? WHERE id = ?').run(enc, id)
  return NextResponse.json({ ok: true })
}
