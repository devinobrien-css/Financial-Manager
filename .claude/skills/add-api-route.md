# Skill: Add an API Route

Use this skill when creating a new `app/api/<resource>/route.ts`.

---

## File location

```
app/api/<resource>/route.ts
```

For a sub-resource:
```
app/api/<resource>/[id]/route.ts
```

---

## Full route template

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/server-session'
import { encrypt, decrypt } from '@/lib/crypto'
import { v4 as uuidv4 } from 'uuid'

// ── Types ────────────────────────────────────────────────────────────────────
interface MyRow {
  id: string
  value_enc: string
  created_at: string
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session

  const rows = db.prepare('SELECT * FROM my_table ORDER BY created_at DESC').all() as MyRow[]

  const result = rows.map(r => ({
    id: r.id,
    value: decrypt(r.value_enc, key),
    created_at: r.created_at,
  }))

  return NextResponse.json(result)
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session

  const body = await req.json() as { value?: string }
  if (!body.value?.trim()) {
    return NextResponse.json({ error: 'value is required' }, { status: 400 })
  }

  const id = uuidv4()
  db.prepare('INSERT INTO my_table (id, value_enc) VALUES (?, ?)').run(
    id,
    encrypt(body.value.trim(), key)
  )

  return NextResponse.json({ ok: true, id })
}

// ── PUT ──────────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session

  const body = await req.json() as { id?: string; value?: string }
  if (!body.id || !body.value?.trim()) {
    return NextResponse.json({ error: 'id and value are required' }, { status: 400 })
  }

  const changes = db.prepare('UPDATE my_table SET value_enc = ? WHERE id = ?').run(
    encrypt(body.value.trim(), key),
    body.id
  )

  if (changes.changes === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key: _key, db } = session

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  db.prepare('DELETE FROM my_table WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}
```

---

## Key rules

1. **Always** call `getServerSession()` as the very first thing in each handler.
2. Return `{ error: 'LOCKED' }` with status `401` if session is null.
3. Use `encrypt(String(value), key)` before every INSERT/UPDATE of a sensitive field.
4. Use `decrypt(row.field_enc, key)` before returning values; wrap in try/catch for resilience.
5. Use `uuidv4()` for TEXT primary keys; omit `id` for AUTOINCREMENT integer PKs.
6. Wrap multi-step writes in `db.transaction(() => { ... })()`.
7. Never return raw `_enc` field values in the response.
8. Never import or use `lib/crypto.ts` in client components — only in route handlers.
