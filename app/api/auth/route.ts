import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { deriveKey, generateSalt, makeVerifier, verifyKey } from '@/lib/crypto'
import { setSessionKey, clearSessionKey } from '@/lib/session'

interface AuthRow {
  salt: string
  verifier_enc: string
}

export async function POST(req: NextRequest) {
  const { action, password } = await req.json() as { action: string; password: string }

  const db = getDb()

  // status and lock don't require a password
  if (action === 'status') {
    const row = db.prepare('SELECT id FROM auth WHERE id = 1').get()
    return NextResponse.json({ isSetUp: !!row })
  }

  if (action === 'lock') {
    clearSessionKey()
    return NextResponse.json({ ok: true })
  }

  if (!password || typeof password !== 'string' || password.length < 1) {
    return NextResponse.json({ error: 'Password required' }, { status: 400 })
  }

  if (action === 'setup') {
    // First-time setup: create salt + verifier
    const existing = db.prepare('SELECT id FROM auth WHERE id = 1').get()
    if (existing) {
      return NextResponse.json({ error: 'Already set up' }, { status: 409 })
    }
    const salt = generateSalt()
    const key = deriveKey(password, salt)
    const verifier = makeVerifier(key)
    db.prepare('INSERT INTO auth (id, salt, verifier_enc) VALUES (1, ?, ?)').run(
      salt.toString('base64'),
      verifier
    )
    setSessionKey(key)
    return NextResponse.json({ ok: true })
  }

  if (action === 'unlock') {
    const row = db.prepare('SELECT salt, verifier_enc FROM auth WHERE id = 1').get() as AuthRow | undefined
    if (!row) {
      return NextResponse.json({ error: 'Not set up yet' }, { status: 404 })
    }
    const salt = Buffer.from(row.salt, 'base64')
    const key = deriveKey(password, salt)
    if (!verifyKey(row.verifier_enc, key)) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }
    setSessionKey(key)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
