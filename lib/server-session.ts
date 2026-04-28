/**
 * Server-side helper: reads the signed session cookie from the current request
 * and returns the session entry (userId, key, db) or null if not authenticated.
 *
 * Usage inside any API route (app/api/.../route.ts):
 *   const session = await getServerSession()
 *   if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
 *   const { key, db } = session
 */
import { cookies } from 'next/headers'
import { verifyAndGetSession } from './session'
import { getDb } from './db'

export const COOKIE_NAME = 'fm_session'

export async function getServerSession() {
  // cookies() is async in Next.js 15+; await works for both 14 and 15.
  const cookieStore = await cookies()
  const signed = cookieStore.get(COOKIE_NAME)?.value
  if (!signed) return null
  const entry = verifyAndGetSession(signed)
  if (!entry) return null
  return {
    userId: entry.userId,
    key: entry.key,
    db: getDb(entry.userId),
  }
}
