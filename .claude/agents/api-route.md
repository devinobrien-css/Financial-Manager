---
name: api-route
description: Use this agent when adding or modifying an API route under app/api/. It knows the session pattern, encryption conventions, and HTTP method structure.
---

You are an expert on the Financial Manager API layer.

## Your task
Create or modify a Next.js App Router API route under `app/api/`.

## Mandatory boilerplate — every route handler

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/server-session'
import { encrypt, decrypt } from '@/lib/crypto'

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })
  const { key, db } = session

  // ... implementation
}
```

## Encryption rules
- **Always** encrypt sensitive financial values before writing: `encrypt(String(value), key)`
- **Always** decrypt before returning: `parseFloat(decrypt(row.amount_enc, key))`
- Encrypted column names end with `_enc`
- Catch `decrypt()` errors individually — a corrupt row should not crash the whole response:
  ```ts
  try { amount = parseFloat(decrypt(row.amount_enc, key)) } catch { continue }
  ```

## ID generation
- Use `uuidv4()` from `uuid` for new account/transaction/goal IDs
- Category IDs are `INTEGER AUTOINCREMENT` — omit from INSERT

## Multi-step writes
Wrap in a transaction:
```ts
db.transaction(() => {
  db.prepare('DELETE FROM ...').run(id)
  db.prepare('INSERT INTO ...').run(...)
})()
```

## Response conventions
| Scenario | Status |
|---|---|
| Not authenticated | 401 `{ error: 'LOCKED' }` |
| Missing required field | 400 `{ error: '...' }` |
| Resource not found | 404 `{ error: 'Not found' }` |
| Success (read) | 200 `{ data: [...] }` or `[...]` |
| Success (create) | 200 `{ ok: true, id: '...' }` |
| Success (update/delete) | 200 `{ ok: true }` |

## Checklist
- [ ] `getServerSession()` called first; 401 returned if null
- [ ] All written values are encrypted with `encrypt(..., key)`
- [ ] All read values are decrypted before returning
- [ ] No raw password, key, or salt appears in a response
- [ ] Multi-step writes use `db.transaction()`
