import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM categories ORDER BY type, name').all()
  return NextResponse.json(rows)
}

export async function POST(req: Request) {
  const { name, type, color, icon } = await req.json()
  if (!name || !type) return NextResponse.json({ error: 'name and type required' }, { status: 400 })
  if (!['income', 'expense'].includes(type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 })

  const db = getDb()
  const result = db
    .prepare('INSERT INTO categories (name, type, color, icon) VALUES (?, ?, ?, ?)')
    .run(name.trim(), type, color ?? '#6b7280', icon ?? null)

  return NextResponse.json({ id: result.lastInsertRowid, name, type, color, icon }, { status: 201 })
}
