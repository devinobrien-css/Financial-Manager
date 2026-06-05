import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/server-session'
import { getMessages, sessionExists } from '@/lib/ai/chat-store'

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session
  const sessionId = req.nextUrl.searchParams.get('session')
  if (!sessionId) return NextResponse.json({ error: 'session required' }, { status: 400 })
  if (!sessionExists(db, sessionId)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(getMessages(db, key, sessionId))
}
