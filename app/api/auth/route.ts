import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '@/lib/db'
import { deriveKey, generateSalt, makeVerifier, verifyKey } from '@/lib/crypto'
import { createSession, destroySession, verifyAndGetSession } from '@/lib/session'
import { findUserByUsername, findUserById, createUser, updateUsername } from '@/lib/user-db'
import { COOKIE_NAME } from '@/lib/server-session'

interface AuthRow {
  salt: string
  verifier_enc: string
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 30, // 30 days
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { action: string; username?: string; password?: string; registrationCode?: string }
  const { action } = body

  // ── status ───────────────────────────────────────────────────────────────────
  if (action === 'status') {
    const signed = req.cookies.get(COOKIE_NAME)?.value
    if (!signed) return NextResponse.json({ loggedIn: false })
    const entry = verifyAndGetSession(signed)
    if (!entry) return NextResponse.json({ loggedIn: false })
    const user = findUserById(entry.userId)
    return NextResponse.json({ loggedIn: true, username: user?.username ?? null })
  }

  // ── lock / logout ─────────────────────────────────────────────────────────────
  if (action === 'lock') {
    const signed = req.cookies.get(COOKIE_NAME)?.value
    if (signed) destroySession(signed)
    const res = NextResponse.json({ ok: true })
    res.cookies.delete(COOKIE_NAME)
    return res
  }

  const { username, password } = body
  if (!username?.trim() || !password || password.length < 1) {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
  }

  // ── register ──────────────────────────────────────────────────────────────────
  if (action === 'register') {
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    // Optional registration code gate
    const requiredCode = process.env.REGISTRATION_CODE
    if (requiredCode && body.registrationCode !== requiredCode) {
      return NextResponse.json({ error: 'Invalid registration code' }, { status: 403 })
    }

    const existing = findUserByUsername(username)
    if (existing) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
    }

    const userId = uuidv4()
    createUser(userId, username.trim())

    // Initialize auth record in the user's own DB
    const db = getDb(userId)
    const salt = generateSalt()
    const key = deriveKey(password, salt)
    const verifier = makeVerifier(key)
    db.prepare('INSERT INTO auth (id, salt, verifier_enc) VALUES (1, ?, ?)').run(
      salt.toString('base64'),
      verifier
    )

    const signed = createSession(userId, key)
    const res = NextResponse.json({ ok: true, username: username.trim() })
    res.cookies.set(COOKIE_NAME, signed, COOKIE_OPTS)
    return res
  }

  // ── login ─────────────────────────────────────────────────────────────────────
  if (action === 'login') {
    const user = findUserByUsername(username)
    if (!user) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
    }

    const db = getDb(user.id)
    const row = db.prepare('SELECT salt, verifier_enc FROM auth WHERE id = 1').get() as AuthRow | undefined
    if (!row) {
      return NextResponse.json({ error: 'Account not fully set up' }, { status: 500 })
    }

    const salt = Buffer.from(row.salt, 'base64')
    const key = deriveKey(password, salt)
    if (!verifyKey(row.verifier_enc, key)) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
    }

    const signed = createSession(user.id, key)
    const res = NextResponse.json({ ok: true, username: user.username })
    res.cookies.set(COOKIE_NAME, signed, COOKIE_OPTS)
    return res
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export async function PATCH(req: NextRequest) {
  const signed = req.cookies.get(COOKIE_NAME)?.value
  if (!signed) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const entry = verifyAndGetSession(signed)
  if (!entry) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })

  const body = await req.json() as { action: string; currentPassword?: string; newPassword?: string; newUsername?: string }
  const db = getDb(entry.userId)

  // ── change-password ───────────────────────────────────────────────────────────
  if (body.action === 'change-password') {
    const { currentPassword, newPassword } = body
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Both current and new password are required' }, { status: 400 })
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 })
    }
    const row = db.prepare('SELECT salt, verifier_enc FROM auth WHERE id = 1').get() as { salt: string; verifier_enc: string } | undefined
    if (!row) return NextResponse.json({ error: 'Auth record missing' }, { status: 500 })
    const salt = Buffer.from(row.salt, 'base64')
    const currentKey = deriveKey(currentPassword, salt)
    if (!verifyKey(row.verifier_enc, currentKey)) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })
    }
    const newSalt = generateSalt()
    const newKey = deriveKey(newPassword, newSalt)
    const newVerifier = makeVerifier(newKey)
    db.prepare('UPDATE auth SET salt = ?, verifier_enc = ? WHERE id = 1').run(
      newSalt.toString('base64'),
      newVerifier
    )
    // Rotate session with new key
    const newSigned = createSession(entry.userId, newKey)
    const res = NextResponse.json({ ok: true })
    res.cookies.set(COOKIE_NAME, newSigned, COOKIE_OPTS)
    return res
  }

  // ── change-username ───────────────────────────────────────────────────────────
  if (body.action === 'change-username') {
    const { newUsername } = body
    if (!newUsername?.trim()) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 })
    }
    const existing = findUserByUsername(newUsername.trim())
    if (existing && existing.id !== entry.userId) {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
    }
    updateUsername(entry.userId, newUsername.trim())
    return NextResponse.json({ ok: true, username: newUsername.trim() })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
