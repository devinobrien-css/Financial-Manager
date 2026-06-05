/**
 * Finance data-context service.
 *
 * Reads the per-user encrypted SQLite DB, decrypts the relevant fields, and
 * builds a compact text context that gets injected into the generator's
 * system prompt.
 *
 * PRIVACY BOUNDARY (per user choice "aggregates + opt-in detail"):
 *  - By default we emit ONLY aggregates: account balances, category totals,
 *    budget status, net worth. No row-level transaction data leaves here.
 *  - Row-level transaction detail (descriptions, individual amounts/dates) is
 *    emitted ONLY when `allowDetail` is true — i.e. the user flipped the
 *    "Include transaction detail" toggle for that message.
 *
 * Nothing here ever logs decrypted values.
 */
import type Database from 'better-sqlite3'
import { decrypt } from '@/lib/crypto'

export type Intent = 'accounts' | 'spending' | 'income' | 'budget' | 'transactions'

export interface FinanceQuery {
  intents: Intent[]
  /** Target month as 'YYYY-MM'. Defaults to the current month when omitted. */
  month?: string
  /** Whether row-level transaction detail may be included. */
  allowDetail: boolean
}

interface AccountRow {
  id: string
  name_enc: string
  type: string
  opening_balance_enc: string
  apr_enc: string | null
  credit_limit_enc: string | null
}

interface TxRow {
  id: string
  type: 'income' | 'expense' | 'transfer'
  amount_enc: string
  description_enc: string | null
  category_id: number | null
  account_id: string | null
  to_account_id: string | null
  date: string
}

interface CategoryRow {
  id: number
  name: string
  type: string
  monthly_budget_enc: string | null
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const safeNum = (enc: string | null, key: Buffer): number => {
  if (!enc) return 0
  try {
    const v = parseFloat(decrypt(enc, key))
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

const safeStr = (enc: string | null, key: Buffer): string => {
  if (!enc) return ''
  try {
    return decrypt(enc, key)
  } catch {
    return ''
  }
}

interface AccountSummary {
  id: string
  name: string
  type: string
  balance: number
  apr: number | null
  creditLimit: number | null
}

/** Compute the current balance for every account from opening balance + tx history. */
function computeAccounts(db: Database.Database, key: Buffer): AccountSummary[] {
  const accounts = db
    .prepare(
      'SELECT id, name_enc, type, opening_balance_enc, apr_enc, credit_limit_enc FROM accounts ORDER BY sort_order ASC',
    )
    .all() as AccountRow[]

  const txs = db
    .prepare('SELECT type, amount_enc, account_id, to_account_id FROM transactions')
    .all() as Pick<TxRow, 'type' | 'amount_enc' | 'account_id' | 'to_account_id'>[]

  const balances = new Map<string, number>()
  for (const a of accounts) balances.set(a.id, safeNum(a.opening_balance_enc, key))

  for (const t of txs) {
    const amt = safeNum(t.amount_enc, key)
    if (t.type === 'income' && t.account_id && balances.has(t.account_id)) {
      balances.set(t.account_id, balances.get(t.account_id)! + amt)
    } else if (t.type === 'expense' && t.account_id && balances.has(t.account_id)) {
      balances.set(t.account_id, balances.get(t.account_id)! - amt)
    } else if (t.type === 'transfer') {
      if (t.account_id && balances.has(t.account_id)) {
        balances.set(t.account_id, balances.get(t.account_id)! - amt)
      }
      if (t.to_account_id && balances.has(t.to_account_id)) {
        balances.set(t.to_account_id, balances.get(t.to_account_id)! + amt)
      }
    }
  }

  return accounts.map((a) => ({
    id: a.id,
    name: safeStr(a.name_enc, key) || '(unnamed)',
    type: a.type,
    balance: balances.get(a.id) ?? 0,
    apr: a.apr_enc ? safeNum(a.apr_enc, key) : null,
    creditLimit: a.credit_limit_enc ? safeNum(a.credit_limit_enc, key) : null,
  }))
}

function categoryMap(db: Database.Database): Map<number, CategoryRow> {
  const rows = db
    .prepare('SELECT id, name, type, monthly_budget_enc FROM categories')
    .all() as CategoryRow[]
  return new Map(rows.map((r) => [r.id, r]))
}

/** Net worth = sum of all account balances (debts are negative balances). */
function netWorthSection(accounts: AccountSummary[]): string {
  const total = accounts.reduce((s, a) => s + a.balance, 0)
  const assets = accounts.filter((a) => a.balance >= 0).reduce((s, a) => s + a.balance, 0)
  const debts = accounts.filter((a) => a.balance < 0).reduce((s, a) => s + a.balance, 0)
  return [
    '## Net worth',
    `Total net worth: ${money(total)}`,
    `Assets: ${money(assets)} | Debts: ${money(debts)}`,
  ].join('\n')
}

function accountsSection(accounts: AccountSummary[]): string {
  const lines = accounts.map((a) => {
    const extra: string[] = []
    if (a.apr != null) extra.push(`APR ${a.apr}%`)
    if (a.creditLimit != null) extra.push(`limit ${money(a.creditLimit)}`)
    const tail = extra.length ? ` (${extra.join(', ')})` : ''
    return `- ${a.name} [${a.type}]: ${money(a.balance)}${tail}`
  })
  return ['## Accounts', ...lines].join('\n')
}

/** Aggregate income or expense by category for a given month. */
function categoryTotalsSection(
  db: Database.Database,
  key: Buffer,
  cats: Map<number, CategoryRow>,
  month: string,
  kind: 'income' | 'expense',
): string {
  const rows = db
    .prepare(
      `SELECT amount_enc, category_id FROM transactions
       WHERE type = ? AND substr(date, 1, 7) = ?`,
    )
    .all(kind, month) as Pick<TxRow, 'amount_enc' | 'category_id'>[]

  const totals = new Map<string, { sum: number; count: number }>()
  let grand = 0
  for (const r of rows) {
    const amt = safeNum(r.amount_enc, key)
    grand += amt
    const name = (r.category_id != null && cats.get(r.category_id)?.name) || 'Uncategorized'
    const cur = totals.get(name) ?? { sum: 0, count: 0 }
    cur.sum += amt
    cur.count += 1
    totals.set(name, cur)
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1].sum - a[1].sum)
  const heading = kind === 'income' ? '## Income by category' : '## Spending by category'
  const lines = sorted.map(
    ([name, { sum, count }]) => `- ${name}: ${money(sum)} (${count} tx)`,
  )
  return [
    `${heading} (${month})`,
    `Total ${kind}: ${money(grand)}`,
    ...(lines.length ? lines : ['(none)']),
  ].join('\n')
}

/** Budget status: categories with a monthly_budget vs. actual spend this month. */
function budgetSection(
  db: Database.Database,
  key: Buffer,
  cats: Map<number, CategoryRow>,
  month: string,
): string {
  const spendRows = db
    .prepare(
      `SELECT amount_enc, category_id FROM transactions
       WHERE type = 'expense' AND substr(date, 1, 7) = ?`,
    )
    .all(month) as Pick<TxRow, 'amount_enc' | 'category_id'>[]

  const spent = new Map<number, number>()
  for (const r of spendRows) {
    if (r.category_id == null) continue
    spent.set(r.category_id, (spent.get(r.category_id) ?? 0) + safeNum(r.amount_enc, key))
  }

  const lines: string[] = []
  for (const cat of cats.values()) {
    if (!cat.monthly_budget_enc) continue
    const budget = safeNum(cat.monthly_budget_enc, key)
    if (budget <= 0) continue
    const used = spent.get(cat.id) ?? 0
    const pct = Math.round((used / budget) * 100)
    lines.push(`- ${cat.name}: ${money(used)} of ${money(budget)} (${pct}%)`)
  }

  return [
    `## Budget status (${month})`,
    ...(lines.length ? lines : ['(no category budgets set)']),
  ].join('\n')
}

/** Row-level transaction detail — only emitted when the user opts in. */
function transactionDetailSection(
  db: Database.Database,
  key: Buffer,
  cats: Map<number, CategoryRow>,
  accounts: AccountSummary[],
  month: string,
): string {
  const acctName = new Map(accounts.map((a) => [a.id, a.name]))
  const rows = db
    .prepare(
      `SELECT id, type, amount_enc, description_enc, category_id, account_id, to_account_id, date
       FROM transactions
       WHERE substr(date, 1, 7) = ?
       ORDER BY date DESC, created_at DESC
       LIMIT 100`,
    )
    .all(month) as TxRow[]

  const lines = rows.map((r) => {
    const desc = safeStr(r.description_enc, key) || '(no description)'
    const cat = (r.category_id != null && cats.get(r.category_id)?.name) || '—'
    const acct = (r.account_id && acctName.get(r.account_id)) || '—'
    const sign = r.type === 'expense' ? '-' : r.type === 'income' ? '+' : '↔'
    return `- ${r.date} ${sign}${money(safeNum(r.amount_enc, key))} | ${desc} | ${cat} | ${acct}`
  })

  return [
    `## Transaction detail (${month}, up to 100 most recent)`,
    ...(lines.length ? lines : ['(none)']),
  ].join('\n')
}

/** Build the full finance context block for the requested intents. */
export function buildFinanceContext(
  db: Database.Database,
  key: Buffer,
  query: FinanceQuery,
): string {
  const month = query.month && /^\d{4}-\d{2}$/.test(query.month) ? query.month : defaultMonth()
  const cats = categoryMap(db)
  const accounts = computeAccounts(db, key)
  const sections: string[] = []

  const wants = new Set(query.intents)
  // Accounts + net worth are cheap and almost always useful as grounding.
  if (wants.has('accounts') || wants.size === 0) {
    sections.push(accountsSection(accounts), netWorthSection(accounts))
  }
  if (wants.has('spending')) {
    sections.push(categoryTotalsSection(db, key, cats, month, 'expense'))
  }
  if (wants.has('income')) {
    sections.push(categoryTotalsSection(db, key, cats, month, 'income'))
  }
  if (wants.has('budget')) {
    sections.push(budgetSection(db, key, cats, month))
  }
  if (wants.has('transactions') && query.allowDetail) {
    sections.push(transactionDetailSection(db, key, cats, accounts, month))
  } else if (wants.has('transactions') && !query.allowDetail) {
    sections.push(
      '## Transaction detail\n(The user did not enable transaction-level detail for this message. ' +
        'Answer from the aggregates above, or ask them to toggle "Include transaction detail".)',
    )
  }

  if (sections.length === 0) {
    sections.push(accountsSection(accounts), netWorthSection(accounts))
  }

  return sections.join('\n\n')
}

/** Current month as 'YYYY-MM' in local time. */
export function defaultMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
