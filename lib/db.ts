import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DB_DIR, 'finance.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  fs.mkdirSync(DB_DIR, { recursive: true })
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  initSchema(_db)
  return _db
}

function initSchema(db: Database.Database): void {
  // Stable tables (never change shape after v0)
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      salt         TEXT    NOT NULL,
      verifier_enc TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT    NOT NULL UNIQUE,
      type  TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
      color TEXT    NOT NULL DEFAULT '#6b7280',
      icon  TEXT
    );

    -- Accounts: name + opening balance are encrypted at rest
    CREATE TABLE IF NOT EXISTS accounts (
      id                  TEXT PRIMARY KEY,
      name_enc            TEXT NOT NULL,
      type                TEXT NOT NULL CHECK (type IN ('checking','savings','credit','cash','loan')),
      opening_balance_enc TEXT NOT NULL,
      apr_enc             TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // Version-based schema migrations
  migrateToV1(db)
  migrateToV2(db)
  migrateToV3(db)
  migrateToV4(db)
  migrateToV5(db)
  migrateToV6(db)
  migrateToV7(db)
  migrateToV8(db)

  // Seed default categories
  seedCategories(db)
}

/**
 * Migration v1: add account_id / to_account_id to transactions and allow
 * the 'transfer' type. Rebuilds the table when upgrading from v0.
 */
function migrateToV1(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version >= 1) return

  const hasTx = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'")
    .get()

  if (hasTx) {
    const cols = db.pragma('table_info(transactions)') as { name: string }[]
    const colNames = new Set(cols.map(c => c.name))

    if (!colNames.has('account_id')) {
      // Rebuild transactions preserving existing rows
      db.transaction(() => {
        db.prepare('ALTER TABLE transactions RENAME TO _tx_v0').run()
        db.prepare(`
          CREATE TABLE transactions (
            id              TEXT    PRIMARY KEY,
            type            TEXT    NOT NULL CHECK (type IN ('income','expense','transfer')),
            amount_enc      TEXT    NOT NULL,
            description_enc TEXT,
            category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            account_id      TEXT    REFERENCES accounts(id)   ON DELETE SET NULL,
            to_account_id   TEXT    REFERENCES accounts(id)   ON DELETE SET NULL,
            date            TEXT    NOT NULL,
            created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
          )
        `).run()
        db.prepare(`
          INSERT INTO transactions
            (id, type, amount_enc, description_enc, category_id, date, created_at)
          SELECT id, type, amount_enc, description_enc, category_id, date, created_at
          FROM _tx_v0
        `).run()
        db.prepare('DROP TABLE _tx_v0').run()
      })()
    }
  } else {
    // Fresh install — create transactions with full v1 schema
    db.prepare(`
      CREATE TABLE transactions (
        id              TEXT    PRIMARY KEY,
        type            TEXT    NOT NULL CHECK (type IN ('income','expense','transfer')),
        amount_enc      TEXT    NOT NULL,
        description_enc TEXT,
        category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        account_id      TEXT    REFERENCES accounts(id)   ON DELETE SET NULL,
        to_account_id   TEXT    REFERENCES accounts(id)   ON DELETE SET NULL,
        date            TEXT    NOT NULL,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `).run()
  }

  db.pragma('user_version = 1')
}

/**
 * Migration v2: add apr_enc to accounts; expand type CHECK to include 'loan'.
 * SQLite can't ALTER a CHECK constraint, so we rebuild the accounts table.
 */
function migrateToV2(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version >= 2) return

  const hasAccounts = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'")
    .get()

  if (hasAccounts) {
    const cols = db.pragma('table_info(accounts)') as { name: string }[]
    const colNames = new Set(cols.map(c => c.name))

    if (!colNames.has('apr_enc')) {
      // Rebuild accounts table to add apr_enc and expand the type CHECK
      db.transaction(() => {
        db.prepare('ALTER TABLE accounts RENAME TO _accounts_v1').run()
        db.prepare(`
          CREATE TABLE accounts (
            id                  TEXT PRIMARY KEY,
            name_enc            TEXT NOT NULL,
            type                TEXT NOT NULL CHECK (type IN ('checking','savings','credit','cash','loan')),
            opening_balance_enc TEXT NOT NULL,
            apr_enc             TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `).run()
        db.prepare(`
          INSERT INTO accounts (id, name_enc, type, opening_balance_enc, created_at)
          SELECT id, name_enc, type, opening_balance_enc, created_at
          FROM _accounts_v1
        `).run()
        db.prepare('DROP TABLE _accounts_v1').run()
      })()
    }
  }

  db.pragma('user_version = 2')
}

/**
 * Migration v3: add goals table for the planning board.
 */
function migrateToV3(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version >= 3) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id           TEXT PRIMARY KEY,
      title_enc    TEXT NOT NULL,
      notes_enc    TEXT,
      amount_enc   TEXT,
      target_date  TEXT,
      completed    INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.pragma('user_version = 3')
}

/**
 * Migration v4: add color column to goals (not sensitive, stored plain).
 */
function migrateToV4(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version >= 4) return

  const hasGoals = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='goals'")
    .get()

  if (hasGoals) {
    const cols = db.pragma('table_info(goals)') as { name: string }[]
    if (!cols.some(c => c.name === 'color')) {
      db.prepare(`ALTER TABLE goals ADD COLUMN color TEXT NOT NULL DEFAULT 'yellow'`).run()
    }
  }

  db.pragma('user_version = 4')
}

/**
 * Migration v5: add sort_order column to accounts for drag-and-drop ordering.
 * Backfills existing rows using rowid order so current order is preserved.
 */
function migrateToV5(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version >= 5) return

  const cols = db.pragma('table_info(accounts)') as { name: string }[]
  if (!cols.some(c => c.name === 'sort_order')) {
    db.prepare('ALTER TABLE accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0').run()
    // Backfill so existing order (by created_at) is preserved
    const rows = db.prepare('SELECT id FROM accounts ORDER BY created_at ASC').all() as { id: string }[]
    const update = db.prepare('UPDATE accounts SET sort_order = ? WHERE id = ?')
    db.transaction(() => { rows.forEach((r, i) => update.run(i, r.id)) })()
  }

  db.pragma('user_version = 5')
}

/**
 * Migration v6: add forecast_plans table for planned future transactions.
 */
function migrateToV6(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version >= 6) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS forecast_plans (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
      label_enc       TEXT NOT NULL,
      amount_enc      TEXT NOT NULL,
      date            TEXT NOT NULL,
      account_id      TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      to_account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.pragma('user_version = 6')
}

/**
 * Migration v7:
 *  - memo_enc on transactions (optional encrypted note)
 *  - monthly_budget_enc on categories (optional encrypted budget limit)
 *  - recurring_templates table for repeating transaction templates
 */
function migrateToV7(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version >= 7) return

  // Add memo_enc to transactions
  const txCols = db.pragma('table_info(transactions)') as { name: string }[]
  if (!txCols.some(c => c.name === 'memo_enc')) {
    db.prepare('ALTER TABLE transactions ADD COLUMN memo_enc TEXT').run()
  }

  // Add monthly_budget_enc to categories
  const catCols = db.pragma('table_info(categories)') as { name: string }[]
  if (!catCols.some(c => c.name === 'monthly_budget_enc')) {
    db.prepare('ALTER TABLE categories ADD COLUMN monthly_budget_enc TEXT').run()
  }

  // Recurring templates
  db.exec(`
    CREATE TABLE IF NOT EXISTS recurring_templates (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
      description_enc TEXT NOT NULL,
      amount_enc      TEXT NOT NULL,
      account_id      TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      to_account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      frequency       TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','yearly')),
      next_date       TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.pragma('user_version = 7')
}

/**
 * Migration v8: add saved_amount_enc to goals for tracking progress.
 */
function migrateToV8(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version >= 8) return

  const cols = db.pragma('table_info(goals)') as { name: string }[]
  if (!cols.some(c => c.name === 'saved_amount_enc')) {
    db.prepare('ALTER TABLE goals ADD COLUMN saved_amount_enc TEXT').run()
  }

  db.pragma('user_version = 8')
}

function seedCategories(db: Database.Database): void {
  const count = (db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number }).c
  if (count === 0) {
    const insert = db.prepare('INSERT INTO categories (name, type, color) VALUES (?, ?, ?)')
    const seedMany = db.transaction((rows: [string, string, string][]) => {
      for (const row of rows) insert.run(...row)
    })
    seedMany([
      ['Salary',        'income',  '#22c55e'],
      ['Freelance',     'income',  '#86efac'],
      ['Investment',    'income',  '#4ade80'],
      ['Other Income',  'income',  '#bbf7d0'],
      ['Rent/Mortgage', 'expense', '#ef4444'],
      ['Groceries',     'expense', '#f97316'],
      ['Utilities',     'expense', '#eab308'],
      ['Transport',     'expense', '#3b82f6'],
      ['Healthcare',    'expense', '#a855f7'],
      ['Dining Out',    'expense', '#ec4899'],
      ['Entertainment', 'expense', '#06b6d4'],
      ['Shopping',      'expense', '#f59e0b'],
      ['Insurance',     'expense', '#64748b'],
      ['Other Expense', 'expense', '#94a3b8'],
    ])
  }
}
