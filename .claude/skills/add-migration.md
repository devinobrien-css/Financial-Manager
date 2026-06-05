# Skill: Add a DB Migration

Use this skill whenever you need to extend the SQLite schema (add a table, column, index, or constraint).

---

## Step 1 — Find the current version

Open `lib/db.ts` and find the last `migrateToVN` call inside `initSchema`. That gives you the current version `N`. Your new version is `N + 1`.

## Step 2 — Write the migration function

Add a new function at the bottom of the migration block:

```ts
function migrateToV{N+1}(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version >= {N+1}) return

  // ── your DDL here ──────────────────────────────────────────────────────────
  db.exec(`
    ALTER TABLE some_table ADD COLUMN new_col_enc TEXT;
  `)
  // ──────────────────────────────────────────────────────────────────────────

  db.pragma('user_version = {N+1}')
}
```

### Adding a new table
```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS my_table (
    id         TEXT    PRIMARY KEY,
    value_enc  TEXT    NOT NULL,
    account_id TEXT    REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`)
```

### Rebuilding a table (SQLite can't ALTER CHECK constraints)
```ts
db.transaction(() => {
  db.exec('ALTER TABLE accounts RENAME TO _accounts_old')
  db.exec(`
    CREATE TABLE accounts (
      id                  TEXT PRIMARY KEY,
      name_enc            TEXT NOT NULL,
      type                TEXT NOT NULL CHECK (type IN ('checking','savings','credit','cash','loan','investment')),
      opening_balance_enc TEXT NOT NULL,
      apr_enc             TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.exec(`
    INSERT INTO accounts SELECT id, name_enc, type, opening_balance_enc, apr_enc, created_at
    FROM _accounts_old
  `)
  db.exec('DROP TABLE _accounts_old')
})()
```

## Step 3 — Register the migration

Inside `initSchema`, append your new call **after** all existing calls:

```ts
migrateToV{N}(db)    // existing — do not remove
migrateToV{N+1}db)   // new
```

## Step 4 — Verify

- The function starts with a version guard (`if (version >= N+1) return`)
- `db.pragma('user_version = N+1')` is the last statement
- No existing `migrateToV*` functions were modified
- Encrypted fields end in `_enc`

---

## Reference: encrypted field naming
| Data type | Column name pattern |
|---|---|
| Monetary amount | `amount_enc`, `balance_enc`, `opening_balance_enc` |
| Display name | `name_enc` |
| Free text | `description_enc`, `memo_enc` |
| Rate / percentage | `apr_enc`, `rate_enc` |
| Any other PII | `*_enc` |
