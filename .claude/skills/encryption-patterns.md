# Skill: Encryption & Crypto Patterns

Use this skill when working with the encryption layer (`lib/crypto.ts`) or adding new encrypted fields.

---

## Core functions (`lib/crypto.ts`)

| Function | Signature | Purpose |
|---|---|---|
| `deriveKey` | `(password: string, salt: Buffer) → Buffer` | PBKDF2-SHA256, 310 000 iter, 32 bytes |
| `generateSalt` | `() → Buffer` | 32 random bytes (first-time setup only) |
| `encrypt` | `(plaintext: string, key: Buffer) → string` | AES-256-GCM → `"iv:authTag:cipher"` (base64) |
| `decrypt` | `(ciphertext: string, key: Buffer) → string` | Reverses `encrypt` |
| `makeVerifier` | `(key: Buffer) → string` | Encrypts a known sentinel so the server can verify a key |
| `verifyKey` | `(verifier: string, key: Buffer) → boolean` | Returns true if key decrypts the sentinel correctly |

---

## Encrypting a value for storage

```ts
import { encrypt } from '@/lib/crypto'

// key comes from getServerSession()
const amountEnc = encrypt(String(amount), key)   // always convert to string first
const nameEnc   = encrypt(name.trim(), key)
```

## Decrypting a value for output

```ts
import { decrypt } from '@/lib/crypto'

// Single value
const amount = parseFloat(decrypt(row.amount_enc, key))
const name   = decrypt(row.name_enc, key)

// Resilient bulk decryption (don't let one bad row crash everything)
for (const row of rows) {
  try {
    const amount = parseFloat(decrypt(row.amount_enc, key))
    results.push({ ...row, amount })
  } catch {
    continue  // skip corrupted row
  }
}
```

## Nullable encrypted fields

```ts
const apr = row.apr_enc ? parseFloat(decrypt(row.apr_enc, key)) : null
const memo = row.memo_enc ? decrypt(row.memo_enc, key) : null
```

## Adding a new encrypted column

1. Add the column via a DB migration (see `add-migration.md`):
   ```sql
   ALTER TABLE my_table ADD COLUMN new_field_enc TEXT;
   ```
2. Encrypt on write:
   ```ts
   db.prepare('UPDATE my_table SET new_field_enc = ? WHERE id = ?')
     .run(encrypt(String(value), key), id)
   ```
3. Decrypt on read — handle null:
   ```ts
   new_field: row.new_field_enc ? decrypt(row.new_field_enc, key) : null
   ```

---

## What NOT to do

- Never store a plaintext monetary amount, name, or description in the DB
- Never log `key.toString('base64')` or any decrypted financial value
- Never import `lib/crypto.ts` in a `'use client'` file — server-only
- Never store the derived key anywhere except the session cookie
