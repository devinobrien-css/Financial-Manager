'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  TrendingDown, ChevronDown, ChevronUp, Flame, Snowflake, CheckCircle2,
  Plus, Trash2, X, Wallet, CreditCard, Banknote, PiggyBank, Landmark,
  TrendingUp, ArrowRightLeft, CalendarDays,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts'

// ─── Shared types ────────────────────────────────────────────────────────────

interface Account {
  id: string
  name: string
  type: 'checking' | 'savings' | 'credit' | 'cash' | 'loan'
  balance: number
  opening_balance: number
  apr: number | null
}

interface Category {
  id: number
  name: string
  type: string
  color: string
}

interface ForecastItem {
  id: string
  type: 'income' | 'expense' | 'transfer'
  label: string
  amount: number
  date: string
  account_id: string | null
  to_account_id: string | null
  category_id: number | null
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function fmt(n: number) { return Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) }
function fmtSigned(n: number) {
  const s = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  return n < 0 ? `-${s}` : `+${s}`
}

const ACCOUNT_ICONS: Record<string, React.ElementType> = {
  checking: Wallet, savings: PiggyBank, credit: CreditCard, cash: Banknote, loan: Landmark,
}
const ACCOUNT_LABELS: Record<string, string> = {
  checking: 'Checking', savings: 'Savings', credit: 'Credit Card', cash: 'Cash', loan: 'Loan',
}

// ─── Debt Payoff planner (unchanged logic) ───────────────────────────────────

interface DebtItem { id: string; name: string; balance: number; apr: number; type: string }
interface PayoffResult extends DebtItem { months: number; payoffDate: Date }

function simulatePayoff(debts: DebtItem[], minPayments: Record<string, number>, extraMonthly: number, strategy: 'snowball' | 'avalanche'): PayoffResult[] {
  if (debts.length === 0) return []
  const priority = [...debts].sort((a, b) => strategy === 'snowball' ? a.balance - b.balance : b.apr - a.apr).map(d => d.id)
  const balances = new Map(debts.map(d => [d.id, d.balance]))
  const payoffMonths = new Map<string, number>()
  let snowballPool = 0, month = 0
  while ([...balances.values()].some(b => b > 0.01) && month < 600) {
    month++
    for (const debt of debts) { const b = balances.get(debt.id) ?? 0; if (b > 0.01) balances.set(debt.id, b * (1 + debt.apr / 100 / 12)) }
    const focusId = priority.find(id => (balances.get(id) ?? 0) > 0.01)
    for (const debt of debts) {
      const b = balances.get(debt.id) ?? 0; if (b <= 0.01) continue
      let pay = minPayments[debt.id] ?? Math.max(25, debt.balance * 0.02)
      if (debt.id === focusId) pay += extraMonthly + snowballPool
      balances.set(debt.id, Math.max(0, b - pay))
    }
    for (const id of priority) {
      if ((balances.get(id) ?? 0) <= 0.01 && !payoffMonths.has(id)) {
        payoffMonths.set(id, month)
        snowballPool += minPayments[id] ?? Math.max(25, (debts.find(d => d.id === id)?.balance ?? 0) * 0.02)
        balances.set(id, 0)
      }
    }
  }
  const now = new Date()
  return debts.map(d => ({ ...d, months: payoffMonths.get(d.id) ?? month, payoffDate: new Date(now.getFullYear(), now.getMonth() + (payoffMonths.get(d.id) ?? month), 1) }))
}

function monthsLabel(m: number) {
  if (m <= 1) return '1 month'; if (m < 12) return `${m} months`
  const y = Math.floor(m / 12), r = m % 12; return r === 0 ? `${y} yr` : `${y} yr ${r} mo`
}

// ─── Forecast helpers ─────────────────────────────────────────────────────────

interface ForecastStep {
  date: string
  label: string
  item: ForecastItem
  delta: Record<string, number>   // account id → change in balance
  balances: Record<string, number>
}

function buildForecast(items: ForecastItem[], accounts: Account[]): ForecastStep[] {
  const current: Record<string, number> = {}
  for (const a of accounts) current[a.id] = a.balance

  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date))
  const steps: ForecastStep[] = []

  for (const item of sorted) {
    const delta: Record<string, number> = {}

    if (item.type === 'income' && item.account_id) {
      delta[item.account_id] = item.amount
    } else if (item.type === 'expense' && item.account_id) {
      delta[item.account_id] = -item.amount
    } else if (item.type === 'transfer') {
      if (item.account_id) delta[item.account_id] = -item.amount
      if (item.to_account_id) delta[item.to_account_id] = item.amount
    }

    for (const [id, d] of Object.entries(delta)) {
      current[id] = (current[id] ?? 0) + d
    }

    steps.push({
      date: item.date,
      label: item.label,
      item,
      delta,
      balances: { ...current },
    })
  }

  return steps
}

function formatDate(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Forecast Form Modal ──────────────────────────────────────────────────────

function ForecastForm({
  accounts, categories, editing, onSave, onClose,
}: {
  accounts: Account[]
  categories: Category[]
  editing: ForecastItem | null
  onSave: () => void
  onClose: () => void
}) {
  const [type, setType] = useState<'income' | 'expense' | 'transfer'>(editing?.type ?? 'expense')
  const [label, setLabel] = useState(editing?.label ?? '')
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '')
  const [date, setDate] = useState(editing?.date ?? new Date().toISOString().slice(0, 10))
  const [accountId, setAccountId] = useState(editing?.account_id ?? '')
  const [toAccountId, setToAccountId] = useState(editing?.to_account_id ?? '')
  const [categoryId, setCategoryId] = useState<string>(editing?.category_id != null ? String(editing.category_id) : '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const relevantCats = categories.filter(c => c.type === type || type === 'transfer')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const amt = Number.parseFloat(amount)
    if (Number.isNaN(amt) || amt <= 0) { setError('Enter a valid positive amount'); return }
    if (!label.trim()) { setError('Label is required'); return }
    if (type !== 'transfer' && !accountId) { setError('Select an account'); return }
    if (type === 'transfer' && (!accountId || !toAccountId)) { setError('Select both accounts for transfer'); return }
    if (type === 'transfer' && accountId === toAccountId) { setError('From and To accounts must differ'); return }

    setSaving(true)
    const body = {
      type, label: label.trim(), amount: amt, date,
      account_id: accountId || null,
      to_account_id: type === 'transfer' ? toAccountId || null : null,
      category_id: categoryId ? Number(categoryId) : null,
    }
    const res = await fetch('/api/forecast', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing ? { id: editing.id, ...body } : body),
    })
    setSaving(false)
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Failed'); return }
    onSave()
  }

  const typeBtn = (t: 'income' | 'expense' | 'transfer', icon: React.ReactNode, lbl: string) => (
    <button type="button" onClick={() => setType(t)}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${
        type === t ? 'bg-slate-800 border-slate-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
      }`}
    >
      {icon}{lbl}
    </button>
  )

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-slate-800">{editing ? 'Edit Planned Transaction' : 'Add Planned Transaction'}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type */}
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Type</label>
            <div className="flex gap-2">
              {typeBtn('income', <TrendingUp className="w-3.5 h-3.5" />, 'Income')}
              {typeBtn('expense', <TrendingDown className="w-3.5 h-3.5" />, 'Expense')}
              {typeBtn('transfer', <ArrowRightLeft className="w-3.5 h-3.5" />, 'Transfer')}
            </div>
          </div>
          {/* Label */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Description</label>
            <input type="text" placeholder="e.g. Rent payment" value={label} onChange={e => setLabel(e.target.value)} autoFocus
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" required />
          </div>
          {/* Amount + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <input type="number" step="0.01" min="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}
                  className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" required />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" required />
            </div>
          </div>
          {/* Account(s) */}
          {type !== 'transfer' ? (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Account</label>
              <select value={accountId} onChange={e => setAccountId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white">
                <option value="">— Select account —</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({ACCOUNT_LABELS[a.type]})</option>)}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">From</label>
                <select value={accountId} onChange={e => setAccountId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white">
                  <option value="">— Select —</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">To</label>
                <select value={toAccountId} onChange={e => setToAccountId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white">
                  <option value="">— Select —</option>
                  {accounts.filter(a => a.id !== accountId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
          )}
          {/* Category (optional, only for income/expense) */}
          {type !== 'transfer' && relevantCats.length > 0 && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Category (optional)</label>
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white">
                <option value="">— None —</option>
                {relevantCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Forecast Tab ─────────────────────────────────────────────────────────────

function ForecastTab({ accounts, categories }: { accounts: Account[]; categories: Category[] }) {
  const { lock } = useAuth()
  const [items, setItems] = useState<ForecastItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<ForecastItem | null>(null)
  const [focusAccountId, setFocusAccountId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch('/api/forecast')
    if (!res.ok) { const d = await res.json().catch(() => ({})); if (d.error === 'LOCKED') lock(); setLoading(false); return }
    setItems(await res.json())
    setLoading(false)
  }, [lock])

  useEffect(() => { load() }, [load])

  // Default focus account to first non-debt account
  useEffect(() => {
    if (!focusAccountId && accounts.length > 0) {
      const first = accounts.find(a => a.type !== 'credit' && a.type !== 'loan') ?? accounts[0]
      setFocusAccountId(first.id)
    }
  }, [accounts, focusAccountId])

  const handleDelete = async (id: string) => {
    await fetch('/api/forecast', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }

  const steps = useMemo(() => buildForecast(items, accounts), [items, accounts])

  // For the chart: starting balance + each step for the focused account
  const chartData = useMemo(() => {
    if (!focusAccountId) return []
    const startBal = accounts.find(a => a.id === focusAccountId)?.balance ?? 0
    const points: { name: string; balance: number; step?: string }[] = [
      { name: 'Today', balance: startBal },
    ]
    for (const s of steps) {
      if (s.balances[focusAccountId] !== undefined) {
        points.push({ name: formatDate(s.date), balance: s.balances[focusAccountId], step: s.label })
      }
    }
    return points
  }, [steps, focusAccountId, accounts])

  // All account IDs that appear in the forecast
  const affectedAccountIds = useMemo(() => {
    const ids = new Set<string>()
    for (const s of steps) Object.keys(s.delta).forEach(id => ids.add(id))
    return [...ids]
  }, [steps])

  // Build per-account final balance from last step
  const finalBalances = useMemo(() => {
    if (steps.length === 0) return {} as Record<string, number>
    return steps[steps.length - 1].balances
  }, [steps])

  const TYPE_COLOR = { income: 'text-green-600', expense: 'text-red-500', transfer: 'text-blue-500' }
  const TYPE_ICON = { income: TrendingUp, expense: TrendingDown, transfer: ArrowRightLeft }

  if (loading) return <div className="text-slate-400 text-sm">Loading…</div>

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Transaction Forecast</h3>
          <p className="text-sm text-slate-500 mt-0.5">Plan upcoming transactions and see how accounts react over time.</p>
        </div>
        <button onClick={() => { setEditingItem(null); setShowForm(true) }}
          className="flex items-center gap-2 bg-slate-800 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 transition-colors">
          <Plus className="w-4 h-4" /> Add Transaction
        </button>
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <CalendarDays className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">No planned transactions yet</p>
          <p className="text-xs text-slate-400 mt-1">Add income, expenses, or transfers to forecast your account balances.</p>
          <button onClick={() => { setEditingItem(null); setShowForm(true) }}
            className="mt-4 text-sm text-slate-600 underline hover:text-slate-800">Add your first transaction</button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Account balance chart */}
          {accounts.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-slate-700">Balance Forecast</h4>
                <select value={focusAccountId} onChange={e => setFocusAccountId(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-slate-300">
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${Math.round(v / 1000) !== 0 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                  <Tooltip formatter={(v: number) => [fmt(v), 'Balance']} />
                  <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.4} />
                  <Area type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2} fill="url(#balGrad)" dot={{ r: 3, fill: '#6366f1' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-3 gap-6">
            {/* Timeline of planned transactions */}
            <div className="col-span-2 space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Planned Transactions</h4>
              {steps.map((step, i) => {
                const Icon = TYPE_ICON[step.item.type]
                const color = TYPE_COLOR[step.item.type]
                const accountName = step.item.account_id ? accounts.find(a => a.id === step.item.account_id)?.name : null
                const toAccountName = step.item.to_account_id ? accounts.find(a => a.id === step.item.to_account_id)?.name : null
                return (
                  <div key={step.item.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3 group">
                    <div className={`mt-0.5 rounded-lg p-1.5 ${step.item.type === 'income' ? 'bg-green-50' : step.item.type === 'expense' ? 'bg-red-50' : 'bg-blue-50'}`}>
                      <Icon className={`w-3.5 h-3.5 ${color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-slate-800 truncate">{step.label}</p>
                        <p className={`text-sm font-semibold tabular-nums shrink-0 ${step.item.type === 'expense' ? 'text-red-500' : step.item.type === 'income' ? 'text-green-600' : 'text-blue-500'}`}>
                          {step.item.type === 'expense' ? '-' : step.item.type === 'income' ? '+' : ''}{fmt(step.item.amount)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-slate-400">{formatDate(step.date)}</span>
                        {accountName && (
                          <span className="text-xs text-slate-400">· {accountName}{toAccountName ? ` → ${toAccountName}` : ''}</span>
                        )}
                      </div>
                      {/* Per-account balance after this step */}
                      <div className="flex flex-wrap gap-2 mt-2">
                        {Object.entries(step.delta).map(([id, d]) => {
                          const acc = accounts.find(a => a.id === id)
                          if (!acc) return null
                          return (
                            <span key={id} className="text-xs px-1.5 py-0.5 rounded bg-slate-50 border border-slate-100 text-slate-500">
                              {acc.name}: <span className={d >= 0 ? 'text-green-600' : 'text-red-500'}>{fmtSigned(d)}</span>
                              {' '}→ <span className="font-medium text-slate-700">{fmt(step.balances[id])}</span>
                            </span>
                          )
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={() => { setEditingItem(step.item); setShowForm(true) }}
                        className="text-slate-300 hover:text-slate-600 p-1 rounded transition-colors text-xs">Edit</button>
                      <button onClick={() => handleDelete(step.item.id)}
                        className="text-slate-300 hover:text-red-400 p-1 rounded transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {/* Step number badge */}
                    <span className="shrink-0 text-xs text-slate-300 w-5 text-right">{i + 1}</span>
                  </div>
                )
              })}
            </div>

            {/* Final account snapshots */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">After All Transactions</h4>
              <div className="space-y-2">
                {affectedAccountIds.length === 0 ? (
                  accounts.map(a => (
                    <div key={a.id} className="bg-white rounded-xl border border-slate-100 p-3">
                      <p className="text-xs text-slate-500 truncate">{a.name}</p>
                      <p className={`text-sm font-semibold tabular-nums mt-0.5 ${a.balance < 0 ? 'text-red-500' : 'text-slate-700'}`}>
                        {a.balance < 0 ? '-' : ''}{fmt(a.balance)}
                      </p>
                    </div>
                  ))
                ) : (
                  accounts.filter(a => affectedAccountIds.includes(a.id) || finalBalances[a.id] !== undefined).map(a => {
                    const final = finalBalances[a.id] ?? a.balance
                    const current = a.balance
                    const diff = final - current
                    const Icon = ACCOUNT_ICONS[a.type]
                    return (
                      <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className="w-3.5 h-3.5 text-slate-400" />
                          <p className="text-xs text-slate-500 truncate flex-1">{a.name}</p>
                        </div>
                        <p className={`text-sm font-semibold tabular-nums ${final < 0 ? 'text-red-500' : 'text-slate-800'}`}>
                          {final < 0 ? '-' : ''}{fmt(final)}
                        </p>
                        {diff !== 0 && (
                          <p className={`text-xs mt-0.5 ${diff > 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {fmtSigned(diff)} from today
                          </p>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <ForecastForm
          accounts={accounts}
          categories={categories}
          editing={editingItem}
          onSave={() => { setShowForm(false); setEditingItem(null); load() }}
          onClose={() => { setShowForm(false); setEditingItem(null) }}
        />
      )}
    </div>
  )
}

// ─── Debt Payoff Tab ──────────────────────────────────────────────────────────

function DebtPayoffTab({ accounts }: { accounts: Account[] }) {
  const debts: DebtItem[] = useMemo(() =>
    accounts.filter(a => (a.type === 'credit' || a.type === 'loan') && a.balance < 0)
      .map(a => ({ id: a.id, name: a.name, balance: Math.abs(a.balance), apr: a.apr ?? 0, type: a.type })),
  [accounts])

  const [strategy, setStrategy] = useState<'snowball' | 'avalanche'>('avalanche')
  const [extraPayment, setExtraPayment] = useState('0')
  const [minPayments, setMinPayments] = useState<Record<string, string>>({})
  const [showMinPayments, setShowMinPayments] = useState(false)

  useEffect(() => {
    setMinPayments(prev => {
      const next = { ...prev }
      for (const d of debts) if (!(d.id in next)) next[d.id] = String(Math.max(25, d.balance * 0.02).toFixed(0))
      return next
    })
  }, [debts])

  const minPaymentNums = useMemo(() => {
    const res: Record<string, number> = {}
    for (const d of debts) res[d.id] = Number.parseFloat(minPayments[d.id] || '0') || Math.max(25, d.balance * 0.02)
    return res
  }, [debts, minPayments])

  const payoffResults = useMemo(() =>
    simulatePayoff(debts, minPaymentNums, Number.parseFloat(extraPayment || '0'), strategy),
  [debts, minPaymentNums, extraPayment, strategy])

  const lastPayoffDate = payoffResults.length > 0
    ? payoffResults.reduce<Date | null>((l, r) => l === null || r.payoffDate > l ? r.payoffDate : l, null)
    : null
  const totalDebt = debts.reduce((s, d) => s + d.balance, 0)
  const totalMonthly = payoffResults.reduce((s, r) => s + minPaymentNums[r.id], 0) + Number.parseFloat(extraPayment || '0')
  const sortedResults = [...payoffResults].sort((a, b) => strategy === 'snowball' ? a.balance - b.balance : b.apr - a.apr)

  if (debts.length === 0) return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
      <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
      <p className="text-green-700 font-medium text-sm">No outstanding debt — great work!</p>
    </div>
  )

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <div className="flex flex-wrap gap-5 items-end">
          <div>
            <p className="text-xs text-slate-500 mb-2">Payoff Strategy</p>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              <button onClick={() => setStrategy('avalanche')} className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors ${strategy === 'avalanche' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                <Flame className="w-3.5 h-3.5" /> Avalanche
              </button>
              <button onClick={() => setStrategy('snowball')} className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors ${strategy === 'snowball' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                <Snowflake className="w-3.5 h-3.5" /> Snowball
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">{strategy === 'avalanche' ? 'Highest APR first — saves the most in interest' : 'Lowest balance first — quickest psychological wins'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-2">Extra Monthly Payment</p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
              <input type="number" min="0" step="10" placeholder="0" value={extraPayment} onChange={e => setExtraPayment(e.target.value)}
                className="w-36 pl-7 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
            </div>
            <p className="text-xs text-slate-400 mt-1">On top of minimums, applied to focus debt</p>
          </div>
          <button onClick={() => setShowMinPayments(v => !v)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 pb-1 transition-colors">
            {showMinPayments ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showMinPayments ? 'Hide' : 'Edit'} minimum payments
          </button>
        </div>
        {showMinPayments && (
          <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {debts.map(debt => (
              <div key={debt.id}>
                <label className="block text-xs text-slate-500 mb-1 truncate">{debt.name} min/mo</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                  <input type="number" min="1" step="1" value={minPayments[debt.id] ?? ''} onChange={e => setMinPayments(prev => ({ ...prev, [debt.id]: e.target.value }))}
                    className="w-full pl-7 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-3">
        {sortedResults.map((result, idx) => {
          const isFocus = idx === 0
          const extraNum = Number.parseFloat(extraPayment || '0')
          return (
            <div key={result.id} className={`bg-white rounded-xl border p-5 ${isFocus ? 'border-orange-200 bg-orange-50/30' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-800">{result.name}</p>
                    {isFocus && <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-600">Focus Debt</span>}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 capitalize">{result.type} · {result.apr}% APR</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-red-500">{fmt(result.balance)}</p>
                  <p className="text-xs text-slate-400">{result.apr > 0 ? `~${fmt(result.balance * result.apr / 100 / 12)}/mo interest` : 'No APR set'}</p>
                </div>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full mb-2">
                <div className="h-1.5 rounded-full bg-gradient-to-r from-orange-400 to-red-400" style={{ width: `${Math.min(100, (result.balance / totalDebt) * 100)}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Min: {fmt(minPaymentNums[result.id])}/mo{isFocus && extraNum > 0 && <span className="text-orange-600"> + {fmt(extraNum)} extra</span>}</span>
                <span className="font-medium text-slate-700">{monthsLabel(result.months)} · {result.payoffDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
              </div>
            </div>
          )
        })}
      </div>
      {lastPayoffDate && (
        <div className="mt-4 bg-slate-800 text-white rounded-xl p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Total debt: {fmt(totalDebt)}</p>
            <p className="text-xs text-slate-400 mt-0.5">{totalMonthly > 0 ? `Monthly commitment: ${fmt(totalMonthly)}` : 'Edit minimums above to see your timeline'}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Debt-free by</p>
            <p className="text-xl font-semibold">{lastPayoffDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'forecast' | 'payoff'

export default function PlanningPage() {
  const { lock } = useAuth()
  const [tab, setTab] = useState<Tab>('forecast')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  const loadBase = useCallback(async () => {
    setLoading(true)
    const [acRes, catRes] = await Promise.all([
      fetch('/api/accounts'),
      fetch('/api/categories'),
    ])
    if (!acRes.ok) { const d = await acRes.json().catch(() => ({})); if (d.error === 'LOCKED') lock() }
    else setAccounts(await acRes.json())
    if (catRes.ok) setCategories(await catRes.json())
    setLoading(false)
  }, [lock])

  useEffect(() => { loadBase() }, [loadBase])

  const TAB_ITEMS: { key: Tab; label: string }[] = [
    { key: 'forecast', label: 'Transaction Forecast' },
    { key: 'payoff',   label: 'Debt Payoff Planner' },
  ]

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-slate-800">Planning</h2>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-8 w-fit">
        {TAB_ITEMS.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : tab === 'forecast' ? (
        <ForecastTab accounts={accounts} categories={categories} />
      ) : (
        <DebtPayoffTab accounts={accounts} />
      )}
    </div>
  )
}


