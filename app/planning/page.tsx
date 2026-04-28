'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  TrendingDown, ChevronDown, ChevronUp, Flame, Snowflake, CheckCircle2,
  Plus, Trash2, X, Wallet, CreditCard, Banknote, PiggyBank, Landmark,
  TrendingUp, ArrowRightLeft, CalendarDays, CheckCheck, Copy,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CustomSelect } from '@/components/CustomSelect'
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
  credit_limit: number | null
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
function acctSublabel(a: Account): string {
  const parts: string[] = [ACCOUNT_LABELS[a.type]]
  if (a.balance < 0) {
    parts.push(`${fmt(a.balance)} owed`)
  } else {
    parts.push(`${fmt(a.balance)} available`)
  }
  if (a.apr !== null) parts.push(`${a.apr.toFixed(2)}% APR`)
  return parts.join(' · ')
}
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
              <CustomSelect
                value={accountId}
                onChange={setAccountId}
                placeholder="— Select account —"
                options={accounts.map(a => ({
                  value: a.id,
                  label: a.name,
                  sublabel: acctSublabel(a),
                  icon: ACCOUNT_ICONS[a.type],
                }))}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">From</label>
                <CustomSelect
                  value={accountId}
                  onChange={setAccountId}
                  placeholder="— Select —"
                  options={accounts.map(a => ({
                    value: a.id,
                    label: a.name,
                    sublabel: acctSublabel(a),
                    icon: ACCOUNT_ICONS[a.type],
                  }))}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">To</label>
                <CustomSelect
                  value={toAccountId}
                  onChange={setToAccountId}
                  placeholder="— Select —"
                  options={accounts.filter(a => a.id !== accountId).map(a => ({
                    value: a.id,
                    label: a.name,
                    sublabel: acctSublabel(a),
                    icon: ACCOUNT_ICONS[a.type],
                  }))}
                />
              </div>
            </div>
          )}
          {/* Category (optional, only for income/expense) */}
          {type !== 'transfer' && relevantCats.length > 0 && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Category (optional)</label>
              <CustomSelect
                value={categoryId}
                onChange={setCategoryId}
                placeholder="— None —"
                options={relevantCats.map(c => ({ value: String(c.id), label: c.name, color: c.color }))}
              />
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

// ─── Step Snapshot Panel ──────────────────────────────────────────────────────

function StepSnapshotPanel({ step, stepIndex, accounts, prevBalances, onClose }: {
  step: ForecastStep
  stepIndex: number
  accounts: Account[]
  prevBalances: Record<string, number>
  onClose: () => void
}) {
  const TYPE_COLOR = { income: 'text-green-600', expense: 'text-red-500', transfer: 'text-blue-500' }
  const TYPE_ICON = { income: TrendingUp, expense: TrendingDown, transfer: ArrowRightLeft }
  const Icon = TYPE_ICON[step.item.type]
  const color = TYPE_COLOR[step.item.type]

  const todayNetWorth = accounts.reduce((s, a) => s + a.balance, 0)

  return (
    <div>
      {/* Net worth at this step */}
      {(() => {
        const stepNetWorth = accounts.reduce((s, a) => s + (step.balances[a.id] ?? prevBalances[a.id] ?? a.balance), 0)
        const diff = stepNetWorth - todayNetWorth
        return (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 mb-4">
            <p className="text-xs text-indigo-400 font-semibold uppercase tracking-wider mb-1">Net Worth at Step {stepIndex + 1}</p>
            <p className={`text-lg font-bold tabular-nums ${stepNetWorth < 0 ? 'text-red-500' : 'text-indigo-700'}`}>
              {stepNetWorth < 0 ? '-' : ''}{fmt(Math.abs(stepNetWorth))}
            </p>
            {diff !== 0 && (
              <p className={`text-xs mt-0.5 font-medium ${diff >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {fmtSigned(diff)} from today
              </p>
            )}
          </div>
        )
      })()}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-indigo-500">
          Snapshot — Step {stepIndex + 1}
        </h4>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Transaction summary card */}
      <div className={`rounded-xl border p-3 mb-4 ${
        step.item.type === 'income' ? 'bg-green-50 border-green-100'
        : step.item.type === 'expense' ? 'bg-red-50 border-red-100'
        : 'bg-blue-50 border-blue-100'
      }`}>
        <div className="flex items-center gap-2">
          <div className={`rounded-lg p-1.5 ${
            step.item.type === 'income' ? 'bg-green-100'
            : step.item.type === 'expense' ? 'bg-red-100'
            : 'bg-blue-100'
          }`}>
            <Icon className={`w-3.5 h-3.5 ${color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-800 truncate">{step.label}</p>
            <p className="text-xs text-slate-500">{formatDate(step.date)}</p>
          </div>
          <p className={`text-sm font-bold tabular-nums ${color}`}>
            {step.item.type === 'expense' ? '-' : step.item.type === 'income' ? '+' : ''}{fmt(step.item.amount)}
          </p>
        </div>
      </div>

      {/* All account balances at this step */}
      <div className="space-y-2">
        {accounts.map(a => {
          const bal = step.balances[a.id] ?? prevBalances[a.id] ?? a.balance
          const delta = step.delta[a.id]
          const netFromStart = bal - a.balance
          const AccountIcon = ACCOUNT_ICONS[a.type]
          const isAffected = delta !== undefined
          return (
            <div key={a.id} className={`bg-white rounded-xl border p-3 transition-colors ${
              isAffected ? 'border-indigo-200' : 'border-slate-100'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <AccountIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <p className="text-xs text-slate-500 truncate flex-1">{a.name}</p>
                {isAffected && (
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                    delta >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                  }`}>
                    {fmtSigned(delta)}
                  </span>
                )}
              </div>
              <p className={`text-sm font-semibold tabular-nums ${bal < 0 ? 'text-red-500' : 'text-slate-800'}`}>
                {bal < 0 ? '-' : ''}{fmt(bal)}
              </p>
              {netFromStart !== 0 && (
                <p className={`text-xs mt-0.5 ${netFromStart > 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {fmtSigned(netFromStart)} from today
                </p>
              )}
            </div>
          )
        })}
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
  const [chartRange, setChartRange] = useState<'default' | 'month' | 'year' | 'all'>('default')
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<ForecastItem | null>(null)
  const [confirmConvert, setConfirmConvert] = useState<ForecastItem | null>(null)
  const [selectedStepIdx, setSelectedStepIdx] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

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

  const handleDelete = async (item: ForecastItem) => {
    setBusy(true)
    await fetch('/api/forecast', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) })
    setBusy(false)
    setConfirmDelete(null)
    load()
  }

  const handleDuplicate = async (item: ForecastItem) => {
    await fetch('/api/forecast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: item.type,
        label: item.label,
        amount: item.amount,
        date: item.date,
        account_id: item.account_id,
        to_account_id: item.to_account_id,
        category_id: item.category_id,
      }),
    })
    load()
  }

  const handleConvert = async (item: ForecastItem, amount: number, date: string) => {
    setBusy(true)
    const body: Record<string, unknown> = {
      type: item.type,
      amount,
      description: item.label,
      date,
      account_id: item.account_id,
      to_account_id: item.to_account_id,
      category_id: item.category_id,
    }
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      await fetch('/api/forecast', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) })
    }
    setBusy(false)
    setConfirmConvert(null)
    load()
  }

  const steps = useMemo(() => buildForecast(items, accounts), [items, accounts])

  // For the chart: starting balance + each step for the focused account
  const chartData = useMemo(() => {
    if (!focusAccountId) return []
    const startBal = accounts.find(a => a.id === focusAccountId)?.balance ?? 0
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)

    let cutoffStart: string | null = null
    let cutoffEnd: string | null = null
    if (chartRange === 'default') {
      cutoffStart = todayStr
    } else if (chartRange === 'month') {
      const y = today.getFullYear(), m = today.getMonth()
      cutoffStart = new Date(y, m, 1).toISOString().slice(0, 10)
      cutoffEnd = new Date(y, m + 1, 0).toISOString().slice(0, 10)
    } else if (chartRange === 'year') {
      const y = today.getFullYear()
      cutoffStart = `${y}-01-01`
      cutoffEnd = `${y}-12-31`
    }
    // 'all' — no filtering

    const filteredSteps = steps.filter(s => {
      if (cutoffStart && s.date < cutoffStart) return false
      if (cutoffEnd && s.date > cutoffEnd) return false
      return true
    })

    const points: { name: string; balance: number; step?: string }[] = []
    // For 'default' and 'all', start with today's balance
    if (chartRange !== 'month' && chartRange !== 'year') {
      points.push({ name: 'Today', balance: startBal })
    } else {
      // For month/year, start from the balance just before the window
      const stepsBeforeWindow = steps.filter(s => cutoffStart && s.date < cutoffStart)
      const startingBal = stepsBeforeWindow.length > 0
        ? stepsBeforeWindow.at(-1)!.balances[focusAccountId] ?? startBal
        : startBal
      points.push({ name: chartRange === 'month' ? 'Month Start' : 'Year Start', balance: startingBal })
    }

    for (const s of filteredSteps) {
      if (s.balances[focusAccountId] !== undefined) {
        points.push({ name: formatDate(s.date), balance: s.balances[focusAccountId], step: s.label })
      }
    }
    return points
  }, [steps, focusAccountId, accounts, chartRange])

  // All account IDs that appear in the forecast
  const affectedAccountIds = useMemo(() => {
    const ids = new Set<string>()
    for (const s of steps) Object.keys(s.delta).forEach(id => ids.add(id))
    return [...ids]
  }, [steps])

  // Build per-account final balance from last step
  const finalBalances = useMemo(() => {
    if (steps.length === 0) return {} as Record<string, number>
    return steps.at(-1)!.balances
  }, [steps])

  // Interest charges: for each month boundary crossed, compute interest on debt accounts
  interface InterestEvent {
    afterStepIdx: number   // insert after this step index (-1 = before first step)
    monthLabel: string
    charges: { id: string; name: string; apr: number; balance: number; charge: number }[]
  }
  const interestEvents = useMemo((): InterestEvent[] => {
    const debtAccounts = accounts.filter(a => a.apr !== null && (a.type === 'credit' || a.type === 'loan'))
    if (debtAccounts.length === 0 || steps.length === 0) return []

    const events: InterestEvent[] = []
    // Months already emitted (YYYY-MM strings)
    const seen = new Set<string>()

    // Check today as start month
    const todayYM = new Date().toISOString().slice(0, 7)

    for (let i = 0; i < steps.length; i++) {
      const ym = steps[i].date.slice(0, 7)
      const prevBalances = i === 0
        ? Object.fromEntries(accounts.map(a => [a.id, a.balance]))
        : steps[i - 1].balances

      if (!seen.has(ym) && ym > todayYM) {
        seen.add(ym)
        const [y, m] = ym.split('-').map(Number)
        const monthLabel = new Date(y, m - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
        const charges = debtAccounts
          .map(a => {
            const bal = prevBalances[a.id] ?? a.balance
            const owed = Math.abs(Math.min(0, bal))
            const charge = owed * (a.apr! / 100 / 12)
            return { id: a.id, name: a.name, apr: a.apr!, balance: bal, charge }
          })
          .filter(c => c.charge > 0.005)
        if (charges.length > 0) events.push({ afterStepIdx: i - 1, monthLabel, charges })
      }
    }
    return events
  }, [steps, accounts])

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
                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
                    {(['default', 'month', 'year', 'all'] as const).map(r => (
                      <button key={r} onClick={() => setChartRange(r)}
                        className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                          chartRange === r ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}>
                        {r === 'default' ? 'Default' : r === 'month' ? 'Month' : r === 'year' ? 'Year' : 'All Time'}
                      </button>
                    ))}
                  </div>
                  <select value={focusAccountId} onChange={e => setFocusAccountId(e.target.value)}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-slate-300">
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
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
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => { const k = v / 1000; return Math.abs(k) >= 1 ? `${k < 0 ? '-' : ''}$${Math.abs(k).toFixed(0)}k` : `${v < 0 ? '-' : ''}$${Math.abs(v)}` }} />
                  <Tooltip formatter={(v: number) => [`${(v as number) < 0 ? '-' : ''}${fmt(v as number)}`, 'Balance']} />
                  <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.4} />
                  <Area type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2} fill="url(#balGrad)" dot={{ r: 3, fill: '#6366f1' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-2 gap-6">
            {/* Timeline of planned transactions */}
            <div className="col-span-2 self-start space-y-2">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Planned Transactions</h4>
                {interestEvents.length > 0 && (() => {
                  const total = interestEvents.reduce((sum, ev) => sum + ev.charges.reduce((s, c) => s + c.charge, 0), 0)
                  const monthly = total / interestEvents.length
                  return (
                    <span className="flex items-center gap-1.5 bg-orange-50 border border-orange-200 text-orange-600 text-xs font-semibold px-2.5 py-1 rounded-full">
                      <span>%</span> {fmt(monthly)}/mo est. interest
                    </span>
                  )
                })()}
              </div>
              {steps.map((step, i) => {
                const Icon = TYPE_ICON[step.item.type]
                const color = TYPE_COLOR[step.item.type]
                const accountName = step.item.account_id ? accounts.find(a => a.id === step.item.account_id)?.name : null
                const toAccountName = step.item.to_account_id ? accounts.find(a => a.id === step.item.to_account_id)?.name : null
                const interestBefore = interestEvents.filter(e => e.afterStepIdx === i - 1)
                return (
                  <div key={step.item.id}>
                    {interestBefore.map(ev => (
                      <div key={ev.monthLabel} className="mb-2">
                        <div className="flex items-center gap-2 mb-1.5 pl-1">
                          <p className="text-xs font-semibold uppercase tracking-wider text-orange-400">{ev.monthLabel} — Interest</p>
                          <span className="text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                            {fmt(ev.charges.reduce((s, c) => s + c.charge, 0))} total
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {ev.charges.map(c => (
                            <div key={c.id} className="flex items-center gap-2 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2 text-xs">
                              <span className="text-orange-400">%</span>
                              <span className="text-slate-600 font-medium">{c.name}</span>
                              <span className="text-slate-400">{c.apr.toFixed(2)}% APR</span>
                              <span className="font-semibold text-orange-600">+{fmt(c.charge)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  <div
                    onClick={() => setSelectedStepIdx(selectedStepIdx === i ? null : i)}
                    className={`rounded-xl border p-4 flex items-start gap-3 group cursor-pointer transition-all ${
                      selectedStepIdx === i
                        ? 'bg-indigo-50/40 border-indigo-300 ring-1 ring-indigo-200'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}>
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
                              {' '}→ <span className={`font-medium ${step.balances[id] < 0 ? 'text-red-500' : 'text-slate-700'}`}>{step.balances[id] < 0 ? '-' : ''}{fmt(step.balances[id])}</span>
                            </span>
                          )
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={e => { e.stopPropagation(); setConfirmConvert(step.item) }}
                        title="Convert to transaction"
                        className="text-slate-300 hover:text-green-600 p-1 rounded transition-colors">
                        <CheckCheck className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleDuplicate(step.item) }}
                        title="Duplicate"
                        className="text-slate-300 hover:text-indigo-500 p-1 rounded transition-colors">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={e => { e.stopPropagation(); setEditingItem(step.item); setShowForm(true) }}
                        className="text-slate-300 hover:text-slate-600 p-1 rounded transition-colors text-xs">Edit</button>
                      <button onClick={e => { e.stopPropagation(); setConfirmDelete(step.item) }}
                        className="text-slate-300 hover:text-red-400 p-1 rounded transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {/* Step number badge */}
                    <span className="shrink-0 text-xs text-slate-300 w-5 text-right">{i + 1}</span>
                  </div>
                  </div>
                )
              })}
            </div>

            {/* Right panel: fixed to viewport */}
            <div className="fixed top-0 right-0 w-72 h-screen overflow-y-auto bg-slate-50 border-l border-slate-200 p-4 z-10">
              {selectedStepIdx !== null ? (
                <StepSnapshotPanel
                  step={steps[selectedStepIdx]}
                  stepIndex={selectedStepIdx}
                  accounts={accounts}
                  prevBalances={selectedStepIdx > 0 ? steps[selectedStepIdx - 1].balances : Object.fromEntries(accounts.map(a => [a.id, a.balance]))}
                  onClose={() => setSelectedStepIdx(null)}
                />
              ) : (
                <>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">After All Transactions</h4>
                  {/* Projected net worth card */}
                  {(() => {
                    const todayNW = accounts.reduce((s, a) => s + a.balance, 0)
                    const projectedNW = accounts.reduce((s, a) => s + (finalBalances[a.id] ?? a.balance), 0)
                    const diff = projectedNW - todayNW
                    return (
                      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 mb-3">
                        <p className="text-xs text-indigo-400 font-semibold uppercase tracking-wider mb-1">Projected Net Worth</p>
                        <p className={`text-lg font-bold tabular-nums ${projectedNW < 0 ? 'text-red-500' : 'text-indigo-700'}`}>
                          {projectedNW < 0 ? '-' : ''}{fmt(Math.abs(projectedNW))}
                        </p>
                        {diff !== 0 && (
                          <p className={`text-xs mt-0.5 font-medium ${diff >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {fmtSigned(diff)} from today
                          </p>
                        )}
                        <p className="text-xs text-indigo-300 mt-1">Today: {todayNW < 0 ? '-' : ''}{fmt(Math.abs(todayNW))}</p>
                      </div>
                    )
                  })()}
                  <p className="text-xs text-slate-400 mb-3">Click a transaction to inspect balances at that point.</p>
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
                </>
              )}
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

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete planned transaction?"
        message={confirmDelete ? <>This will remove <strong>{confirmDelete.label}</strong> from your forecast. This cannot be undone.</> : ''}
        confirmLabel="Delete"
        loading={busy}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      {confirmConvert && (
        <ConvertPlanModal
          item={confirmConvert}
          accounts={accounts}
          loading={busy}
          onConfirm={(amount, date) => handleConvert(confirmConvert, amount, date)}
          onCancel={() => setConfirmConvert(null)}
        />
      )}
    </div>
  )
}

// ─── Convert Plan Modal ────────────────────────────────────────────────────────

function ConvertPlanModal({
  item, accounts, loading, onConfirm, onCancel,
}: {
  item: ForecastItem
  accounts: Account[]
  loading: boolean
  onConfirm: (amount: number, date: string) => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState(String(item.amount))
  const [date, setDate] = useState(item.date)
  const [error, setError] = useState('')

  const accountName = item.account_id ? accounts.find(a => a.id === item.account_id)?.name : null
  const toAccountName = item.to_account_id ? accounts.find(a => a.id === item.to_account_id)?.name : null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const amt = Number.parseFloat(amount)
    if (Number.isNaN(amt) || amt <= 0) { setError('Enter a valid positive amount'); return }
    if (!date) { setError('Date is required'); return }
    onConfirm(amt, date)
  }

  const typeColor = item.type === 'income' ? 'text-green-600' : item.type === 'expense' ? 'text-red-500' : 'text-blue-500'

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-slate-800">Convert to transaction</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Record <strong className="text-slate-700">{item.label}</strong>
          {accountName && <> on <span className="text-slate-700">{accountName}{toAccountName ? ` → ${toAccountName}` : ''}</span></>}
          {' '}as an actual transaction. Confirm or adjust the amount and date.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="convert-amount" className="block text-xs text-slate-500 mb-1">Amount</label>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${typeColor}`}>
                  {item.type === 'expense' ? '-' : item.type === 'income' ? '+' : ''}$
                </span>
                <input
                  id="convert-amount"
                  type="number" step="0.01" min="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  autoFocus
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                  required
                />
              </div>
            </div>
            <div>
              <label htmlFor="convert-date" className="block text-xs text-slate-500 mb-1">Date</label>
              <input
                id="convert-date"
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                required
              />
            </div>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onCancel} disabled={loading}
              className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors">
              {loading ? 'Converting…' : 'Convert'}
            </button>
          </div>
        </form>
      </div>
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
    <div className="p-8 pr-80 max-w-5xl mx-auto">
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


