import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/server-session'
import {
  listSessions,
  createSession,
  renameSession,
  deleteSession,
  sessionExists,
} from '@/lib/ai/chat-store'

export async function GET() {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session
  return NextResponse.json(listSessions(db, key))
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session
  const { title } = await req.json().catch(() => ({}))
  const meta = createSession(db, key, (title || 'New chat').toString())
  return NextResponse.json(meta, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session
  const { id, title } = await req.json().catch(() => ({}))
  if (!id || !title) return NextResponse.json({ error: 'id and title required' }, { status: 400 })
  if (!sessionExists(db, id)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  renameSession(db, key, id, title.toString())
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { db } = session
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  deleteSession(db, id)
  return NextResponse.json({ ok: true })
}
