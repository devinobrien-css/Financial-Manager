#!/usr/bin/env node
/**
 * Creates a "demo / demo1234" account pre-populated with ~6 months of
 * realistic financial data so you can showcase the app without touching
 * any real user data.
 *
 * Usage:
 *   node seed-demo.mjs
 *
 * Re-running is safe — it detects an existing demo account and skips.
 */

import Database from 'better-sqlite3'
import crypto, { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const USERS_DB  = path.join(__dirname, 'data', '_users.db')
const USERS_DIR = path.join(__dirname, 'data', 'users')

const DEMO_USERNAME = 'demo'
const DEMO_PASSWORD = 'demo1234'

// ── Crypto helpers (mirrors lib/crypto.ts) ───────────────────────────────────
const ALGORITHM  = 'aes-256-gcm'
const KEY_LEN    = 32
const ITERATIONS = 310_000
const DIGEST     = 'sha256'
const IV_LEN     = 12

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST)
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
}

function makeVerifier(key) {
  return encrypt('financial-manager-verified', key)
}

// ── Date helpers ─────────────────────────────────────────────────────────────
function dateStr(year, month, day) {
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}

// Returns YYYY-MM for a month offset from today (negative = past)
function monthOffset(offset) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

function yearMonthDay(offsetMonths, day) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offsetMonths)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const maxDay = new Date(y, m, 0).getDate()
  return dateStr(y, m, Math.min(day, maxDay))
}

// ── Schema init (mirrors lib/db.ts initSchema) ───────────────────────────────
function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      salt         TEXT    NOT NULL,
      verifier_enc TEXT    NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      type               TEXT NOT NULL CHECK (type IN ('income','expense')),
      color              TEXT NOT NULL DEFAULT '#6b7280',
      icon               TEXT,
      monthly_budget_enc TEXT
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id                  TEXT PRIMARY KEY,
      name_enc            TEXT NOT NULL,
      type                TEXT NOT NULL CHECK (type IN ('checking','savings','credit','cash','loan','investment')),
      opening_balance_enc TEXT NOT NULL,
      apr_enc             TEXT,
      sort_order          INTEGER NOT NULL DEFAULT 0,
      credit_limit_enc    TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id              TEXT    PRIMARY KEY,
      type            TEXT    NOT NULL CHECK (type IN ('income','expense','transfer')),
      amount_enc      TEXT    NOT NULL,
      description_enc TEXT,
      memo_enc        TEXT,
      category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      account_id      TEXT    REFERENCES accounts(id)   ON DELETE SET NULL,
      to_account_id   TEXT    REFERENCES accounts(id)   ON DELETE SET NULL,
      date            TEXT    NOT NULL,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS goals (
      id               TEXT PRIMARY KEY,
      title_enc        TEXT NOT NULL,
      notes_enc        TEXT,
      amount_enc       TEXT,
      saved_amount_enc TEXT,
      target_date      TEXT,
      completed        INTEGER NOT NULL DEFAULT 0,
      color            TEXT NOT NULL DEFAULT 'yellow',
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS forecast_plans (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
      label_enc     TEXT NOT NULL,
      amount_enc    TEXT NOT NULL,
      date          TEXT NOT NULL,
      account_id    TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      to_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
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
    );
    CREATE TABLE IF NOT EXISTS net_worth_snapshots (
      id         TEXT PRIMARY KEY,
      month      TEXT NOT NULL UNIQUE,
      amount_enc TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS credit_score_history (
      id         TEXT PRIMARY KEY,
      score      INTEGER NOT NULL,
      date       TEXT    NOT NULL,
      notes_enc  TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pay_in_full_log (
      id         TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      month      TEXT NOT NULL,
      paid       INTEGER NOT NULL DEFAULT 0,
      UNIQUE(account_id, month)
    );
  `)
  db.pragma('user_version = 12')
  seedCategories(db)
}

function seedCategories(db) {
  const count = db.prepare('SELECT COUNT(*) as c FROM categories').get().c
  if (count > 0) return
  const insert = db.prepare('INSERT INTO categories (name, type, color) VALUES (?, ?, ?)')
  const rows = [
    ['Salary',        'income',  '#22c55e'],
    ['Freelance',     'income',  '#86efac'],
    ['Investment',    'income',  '#4ade80'],
    ['Other Income',  'income',  '#bbf7d0'],
    ['Rent/Mortgage', 'expense', '#ef4444'],
    ['Groceries',     'expense', '#f97316'],
    ['Utilities',     'expense', '#eab308'],
    ['Transport',     'expense', '#3b82f6'],
    ['Gas & Fuel',    'expense', '#f43f5e'],
    ['Car Care',      'expense', '#0ea5e9'],
    ['Healthcare',    'expense', '#a855f7'],
    ['Dining Out',    'expense', '#ec4899'],
    ['Entertainment', 'expense', '#06b6d4'],
    ['Shopping',      'expense', '#f59e0b'],
    ['Insurance',     'expense', '#64748b'],
    ['Taxes',         'expense', '#7c3aed'],      ['Interest',      'expense', '#f97316'],    ['Other Expense', 'expense', '#94a3b8'],
  ]
  db.transaction(() => { for (const r of rows) insert.run(...r) })()
}

// ── Lookup helpers ────────────────────────────────────────────────────────────
function catId(db, name) {
  return db.prepare('SELECT id FROM categories WHERE name = ?').get(name)?.id
}

// ── Main ──────────────────────────────────────────────────────────────────────

// 1. Open / create user registry
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true })
const userDb = new Database(USERS_DB)
userDb.pragma('journal_mode = WAL')
userDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)

// Check if demo user already exists
const existing = userDb.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(DEMO_USERNAME)
if (existing) {
  console.log(`Demo account already exists (id: ${existing.id}). Nothing to do.`)
  console.log(`  username: ${DEMO_USERNAME}`)
  console.log(`  password: ${DEMO_PASSWORD}`)
  process.exit(0)
}

const userId = randomUUID()
userDb.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(userId, DEMO_USERNAME)
console.log(`Created demo user: ${userId}`)

// 2. Create user's finance.db
const userDir = path.join(USERS_DIR, userId)
fs.mkdirSync(userDir, { recursive: true })
const db = new Database(path.join(userDir, 'finance.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
initSchema(db)

// 3. Set up auth record
const salt = crypto.randomBytes(32)
const key  = deriveKey(DEMO_PASSWORD, salt)
const verifier = makeVerifier(key)
db.prepare('INSERT INTO auth (id, salt, verifier_enc) VALUES (1, ?, ?)').run(
  salt.toString('base64'), verifier
)

const E = (v) => encrypt(String(v), key)

// 4. Accounts
// IDs we'll reference later
const ID = {
  checking:   randomUUID(),
  savings:    randomUUID(),
  credit:     randomUUID(),
  investment: randomUUID(),
  carLoan:    randomUUID(),
}

const insertAccount = db.prepare(`
  INSERT INTO accounts (id, name_enc, type, opening_balance_enc, apr_enc, credit_limit_enc, sort_order, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
`)

// Opening balances reflect where things stood ~6 months ago (transactions will bring them current)
insertAccount.run(ID.checking,   E('Chase Checking'),     'checking',   E('3200'),    null,       null,     0, )
insertAccount.run(ID.savings,    E('Ally High-Yield'),    'savings',    E('8400'),    null,       null,     1, )
insertAccount.run(ID.credit,     E('Chase Sapphire'),     'credit',     E('-0'),      E('22.49'), E('10000'), 2, )
insertAccount.run(ID.investment, E('Fidelity Brokerage'), 'investment', E('14500'),   null,       null,     3, )
insertAccount.run(ID.carLoan,    E('Toyota Auto Loan'),   'loan',       E('-18200'),  E('5.9'),   null,     4, )

console.log('Accounts created.')

// 5. Transactions — 6 months of history
// Category IDs (1-indexed, matching the seed order above)
const CAT = {
  salary:       catId(db, 'Salary'),
  freelance:    catId(db, 'Freelance'),
  investment:   catId(db, 'Investment'),
  otherIncome:  catId(db, 'Other Income'),
  rent:         catId(db, 'Rent/Mortgage'),
  groceries:    catId(db, 'Groceries'),
  utilities:    catId(db, 'Utilities'),
  transport:    catId(db, 'Transport'),
  gas:          catId(db, 'Gas & Fuel'),
  carCare:      catId(db, 'Car Care'),
  healthcare:   catId(db, 'Healthcare'),
  dining:       catId(db, 'Dining Out'),
  entertainment:catId(db, 'Entertainment'),
  shopping:     catId(db, 'Shopping'),
  insurance:    catId(db, 'Insurance'),
  taxes:        catId(db, 'Taxes'),
  other:        catId(db, 'Other Expense'),
}

const insertTx = db.prepare(`
  INSERT INTO transactions (id, type, amount_enc, description_enc, category_id, account_id, to_account_id, date)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)

/** Helper — add a transaction row */
function tx(type, amount, description, categoryId, accountId, date, toAccountId = null) {
  insertTx.run(randomUUID(), type, E(amount), E(description), categoryId, accountId, toAccountId, date)
}

// Build 6 months of transactions (month -5 through month 0)
db.transaction(() => {
  for (let mo = -5; mo <= 0; mo++) {
    // ── Income ───────────────────────────────────────────────────────────────
    tx('income', 5240,  'Paycheck (bi-weekly)',   CAT.salary,   ID.checking, yearMonthDay(mo, 1))
    tx('income', 5240,  'Paycheck (bi-weekly)',   CAT.salary,   ID.checking, yearMonthDay(mo, 15))

    // Occasional freelance
    if (mo === -4 || mo === -2 || mo === 0) {
      tx('income', 850, 'Freelance — web project', CAT.freelance, ID.checking, yearMonthDay(mo, 20))
    }

    // Investment dividend (quarterly: months -5 and -2)
    if (mo === -5 || mo === -2) {
      tx('income', 142, 'FXAIX Dividend',          CAT.investment, ID.investment, yearMonthDay(mo, 5))
    }

    // ── Housing ──────────────────────────────────────────────────────────────
    tx('expense', 1450, 'Rent',                    CAT.rent,     ID.checking, yearMonthDay(mo, 1))

    // ── Food ─────────────────────────────────────────────────────────────────
    tx('expense', 112,  'Whole Foods',             CAT.groceries, ID.credit,   yearMonthDay(mo, 4))
    tx('expense', 88,   'Trader Joe\'s',           CAT.groceries, ID.credit,   yearMonthDay(mo, 11))
    tx('expense', 95,   'Costco',                  CAT.groceries, ID.credit,   yearMonthDay(mo, 18))
    tx('expense', 67,   'Weekly groceries',        CAT.groceries, ID.credit,   yearMonthDay(mo, 25))

    tx('expense', 42,   'Chipotle',                CAT.dining,    ID.credit,   yearMonthDay(mo, 6))
    tx('expense', 68,   'Dinner out',              CAT.dining,    ID.credit,   yearMonthDay(mo, 13))
    tx('expense', 35,   'Lunch with coworkers',    CAT.dining,    ID.credit,   yearMonthDay(mo, 21))
    if (mo % 2 === 0) {
      tx('expense', 120, 'Restaurant — date night', CAT.dining,   ID.credit,   yearMonthDay(mo, 27))
    }

    // ── Utilities ────────────────────────────────────────────────────────────
    tx('expense', 94,   'Electric bill',           CAT.utilities, ID.checking, yearMonthDay(mo, 8))
    tx('expense', 55,   'Internet — Xfinity',      CAT.utilities, ID.checking, yearMonthDay(mo, 10))
    tx('expense', 45,   'Water & sewer',           CAT.utilities, ID.checking, yearMonthDay(mo, 12))

    // ── Transport ────────────────────────────────────────────────────────────
    tx('expense', 378,  'Car loan payment',        CAT.transport, ID.checking, yearMonthDay(mo, 3))
    tx('expense', 48,   'Shell — gas',             CAT.gas,       ID.credit,   yearMonthDay(mo, 7))
    tx('expense', 52,   'Shell — gas',             CAT.gas,       ID.credit,   yearMonthDay(mo, 20))
    if (mo === -3) {
      tx('expense', 340, 'Oil change + tire rotation', CAT.carCare, ID.credit, yearMonthDay(mo, 14))
    }

    // ── Insurance ────────────────────────────────────────────────────────────
    tx('expense', 148,  'Auto insurance',          CAT.insurance, ID.checking, yearMonthDay(mo, 2))
    tx('expense', 32,   'Renters insurance',       CAT.insurance, ID.checking, yearMonthDay(mo, 2))

    // ── Healthcare ───────────────────────────────────────────────────────────
    if (mo === -4 || mo === -1) {
      tx('expense', 25,   'CVS Pharmacy copay',    CAT.healthcare, ID.credit,  yearMonthDay(mo, 9))
    }
    if (mo === -3) {
      tx('expense', 200, 'Urgent care visit',      CAT.healthcare, ID.credit,  yearMonthDay(mo, 16))
    }

    // ── Entertainment / Subscriptions ────────────────────────────────────────
    tx('expense', 15.99, 'Netflix',                CAT.entertainment, ID.credit, yearMonthDay(mo, 3))
    tx('expense', 10.99, 'Spotify',                CAT.entertainment, ID.credit, yearMonthDay(mo, 3))
    tx('expense', 14.99, 'YouTube Premium',        CAT.entertainment, ID.credit, yearMonthDay(mo, 3))
    if (mo % 2 !== 0) {
      tx('expense', 75, 'Bowling + drinks',        CAT.entertainment, ID.credit, yearMonthDay(mo, 22))
    }

    // ── Shopping ─────────────────────────────────────────────────────────────
    if (mo === -5) {
      tx('expense', 220, 'Amazon — home goods',    CAT.shopping, ID.credit, yearMonthDay(mo, 17))
    }
    if (mo === -3) {
      tx('expense', 185, 'Target run',             CAT.shopping, ID.credit, yearMonthDay(mo, 9))
    }
    if (mo === -1) {
      tx('expense', 310, 'Best Buy — headphones',  CAT.shopping, ID.credit, yearMonthDay(mo, 24))
    }
    if (mo === 0) {
      tx('expense', 96,  'Amazon — misc',          CAT.shopping, ID.credit, yearMonthDay(mo, 8))
    }

    // ── Credit card pay-off (transfer checking → credit) ─────────────────────
    // Pay the previous month's balance in full each month
    const creditPayment = mo === -5 ? 680 : mo === -4 ? 720 : mo === -3 ? 1050 :
                          mo === -2 ? 730 : mo === -1 ? 820 : 740
    tx('transfer', creditPayment, 'Chase Sapphire — pay in full',
       null, ID.checking, yearMonthDay(mo, 25), ID.credit)

    // ── Savings transfer ─────────────────────────────────────────────────────
    tx('transfer', 500, 'Savings auto-transfer',
       null, ID.checking, yearMonthDay(mo, 16), ID.savings)

    // ── Investment contribution ───────────────────────────────────────────────
    tx('transfer', 400, 'Brokerage — monthly contribution',
       null, ID.checking, yearMonthDay(mo, 17), ID.investment)
  }
})()

console.log('Transactions seeded.')

// 6. Goals
const insertGoal = db.prepare(`
  INSERT INTO goals (id, title_enc, notes_enc, amount_enc, saved_amount_enc, target_date, completed, color)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)

insertGoal.run(randomUUID(), E('Emergency Fund (6 months)'),
  E('Keep 3-6 months of expenses liquid in Ally savings.'),
  E('18000'), E('11900'), `${monthOffset(8)}-01`, 0, 'green')

insertGoal.run(randomUUID(), E('Japan Trip'),
  E('2-week trip for two — flights, hotels, experiences.'),
  E('6000'), E('2200'), `${monthOffset(10)}-01`, 0, 'blue')

insertGoal.run(randomUUID(), E('Pay Off Car Loan Early'),
  E('Extra payments to close out the Toyota loan.'),
  E('18200'), E('4800'), `${monthOffset(20)}-01`, 0, 'yellow')

insertGoal.run(randomUUID(), E('New Laptop'),
  E('MacBook Pro M4 for work & side projects.'),
  E('2500'), E('2500'), `${monthOffset(-1)}-15`, 1, 'purple')

console.log('Goals seeded.')

// 7. Recurring templates
const insertRecurring = db.prepare(`
  INSERT INTO recurring_templates (id, type, description_enc, amount_enc, account_id, to_account_id, category_id, frequency, next_date)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

insertRecurring.run(randomUUID(), 'income',  E('Paycheck (bi-weekly)'),   E('5240'), ID.checking, null, CAT.salary,       'biweekly', yearMonthDay(1, 1))
insertRecurring.run(randomUUID(), 'expense', E('Rent'),                   E('1450'), ID.checking, null, CAT.rent,         'monthly',  yearMonthDay(1, 1))
insertRecurring.run(randomUUID(), 'expense', E('Auto insurance'),         E('148'),  ID.checking, null, CAT.insurance,    'monthly',  yearMonthDay(1, 2))
insertRecurring.run(randomUUID(), 'expense', E('Car loan payment'),       E('378'),  ID.checking, null, CAT.transport,    'monthly',  yearMonthDay(1, 3))
insertRecurring.run(randomUUID(), 'expense', E('Netflix'),                E('15.99'),ID.credit,   null, CAT.entertainment,'monthly',  yearMonthDay(1, 3))
insertRecurring.run(randomUUID(), 'expense', E('Spotify'),                E('10.99'),ID.credit,   null, CAT.entertainment,'monthly',  yearMonthDay(1, 3))
insertRecurring.run(randomUUID(), 'expense', E('Electric bill'),          E('94'),   ID.checking, null, CAT.utilities,    'monthly',  yearMonthDay(1, 8))
insertRecurring.run(randomUUID(), 'expense', E('Internet — Xfinity'),     E('55'),   ID.checking, null, CAT.utilities,    'monthly',  yearMonthDay(1, 10))
insertRecurring.run(randomUUID(), 'transfer',E('Savings auto-transfer'),  E('500'),  ID.checking, ID.savings, null,        'monthly',  yearMonthDay(1, 16))
insertRecurring.run(randomUUID(), 'transfer',E('Brokerage contribution'), E('400'),  ID.checking, ID.investment, null,    'monthly',  yearMonthDay(1, 17))

console.log('Recurring templates seeded.')

// 8. Forecast plans (next 3 months)
const insertPlan = db.prepare(`
  INSERT INTO forecast_plans (id, type, label_enc, amount_enc, date, account_id, to_account_id, category_id, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

for (let mo = 1; mo <= 3; mo++) {
  insertPlan.run(randomUUID(), 'income',  E('Paycheck'), E('5240'), yearMonthDay(mo, 1),  ID.checking, null, CAT.salary,    mo * 10 + 0)
  insertPlan.run(randomUUID(), 'income',  E('Paycheck'), E('5240'), yearMonthDay(mo, 15), ID.checking, null, CAT.salary,    mo * 10 + 1)
  insertPlan.run(randomUUID(), 'expense', E('Rent'),     E('1450'), yearMonthDay(mo, 1),  ID.checking, null, CAT.rent,      mo * 10 + 2)
  insertPlan.run(randomUUID(), 'expense', E('Car loan'), E('378'),  yearMonthDay(mo, 3),  ID.checking, null, CAT.transport, mo * 10 + 3)
}

console.log('Forecast plans seeded.')

// 9. Net worth snapshots (past 6 months)
const insertNW = db.prepare(`
  INSERT INTO net_worth_snapshots (id, month, amount_enc) VALUES (?, ?, ?)
`)
const nwValues = [21400, 22100, 22800, 23650, 24300, 25100]
for (let i = 0; i < 6; i++) {
  const month = monthOffset(i - 5)
  insertNW.run(randomUUID(), month, E(String(nwValues[i])))
}

console.log('Net worth snapshots seeded.')

// 10. Credit score history (past 6 months)
const insertCS = db.prepare(`
  INSERT INTO credit_score_history (id, score, date, notes_enc) VALUES (?, ?, ?, ?)
`)
const scores = [
  { score: 728, mo: -5, note: 'Opened new credit card — small initial dip' },
  { score: 734, mo: -4, note: null },
  { score: 740, mo: -3, note: 'On-time payments improving score' },
  { score: 745, mo: -2, note: null },
  { score: 751, mo: -1, note: 'Utilization dropped below 10%' },
  { score: 758, mo:  0, note: 'Steady improvement' },
]
for (const s of scores) {
  insertCS.run(randomUUID(), s.score, yearMonthDay(s.mo, 1), s.note ? E(s.note) : null)
}

console.log('Credit score history seeded.')

// 11. Pay-in-full log (last 5 months all paid)
const insertPIF = db.prepare(`
  INSERT OR IGNORE INTO pay_in_full_log (id, account_id, month, paid) VALUES (?, ?, ?, 1)
`)
for (let mo = -5; mo <= 0; mo++) {
  insertPIF.run(randomUUID(), ID.credit, monthOffset(mo))
}

console.log('Pay-in-full log seeded.')

db.close()
userDb.close()

console.log('\n✓ Demo account ready!')
console.log(`  username: ${DEMO_USERNAME}`)
console.log(`  password: ${DEMO_PASSWORD}`)
