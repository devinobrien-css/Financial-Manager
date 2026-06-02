'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  TrendingDown, ChevronDown, ChevronUp, Flame, Snowflake, CheckCircle2,
  Plus, Trash2, X, Wallet, CreditCard, Banknote, PiggyBank, Landmark,
  TrendingUp, ArrowRightLeft, CalendarDays, CheckCheck, Copy, BarChart2, Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CustomSelect } from '@/components/CustomSelect'
import {
  ResponsiveContainer, ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts'

// ─── Shared types ────────────────────────────────────────────────────────────

interface Account {
  id: string
  name: string
  type: 'checking' | 'savings' | 'credit' | 'cash' | 'loan' | 'investment'
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
function fmtWhole(n: number) { return Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }
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

// ─── Forecast chart helpers ───────────────────────────────────────────────────

function forecastDotColor(type?: string) {
  if (type === 'income') return '#10b981'
  if (type === 'expense') return '#ef4444'
  return '#6366f1'
}

function ForecastDot(props: any) {
  const { cx, cy, payload, activeStepId } = props
  const color = forecastDotColor(payload?.type)
  const isActiveStep = Boolean(activeStepId && payload?.stepId === activeStepId)
  if (payload?.isEndpoint || isActiveStep) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={8} fill={color} fillOpacity={0.2} />
        <circle cx={cx} cy={cy} r={5} fill={color} stroke="white" strokeWidth={2} />
      </g>
    )
  }
  return <circle cx={cx} cy={cy} r={3.5} fill={color} stroke="white" strokeWidth={1.5} />
}

function ForecastActiveDot(props: any) {
  const { cx, cy, payload } = props
  const color = forecastDotColor(payload?.type)
  return <circle cx={cx} cy={cy} r={5.5} fill={color} stroke="white" strokeWidth={2} />
}

function ForecastTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const { balance, type, step, displayLabel, monthlyInflow, monthlyOutflow, deltaFromPrev, daysFromToday } = payload[0].payload
  const typeColor = type === 'income' ? 'text-emerald-600' : type === 'expense' ? 'text-red-500' : 'text-indigo-500'
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs min-w-[140px]">
      <p className="font-semibold text-slate-700 mb-0.5">{displayLabel}</p>
      {step && <p className="text-slate-400 mb-2 truncate max-w-[160px]">{step}</p>}
      <p className={`font-bold text-sm ${balance >= 0 ? 'text-slate-800' : 'text-red-500'}`}>
        {balance < 0 ? '-' : ''}{fmt(Math.abs(balance))}
      </p>
      {(monthlyInflow != null || monthlyOutflow != null) && (
        <div className="mt-2 space-y-1">
          <p className="text-emerald-600 font-medium">In: +{fmt(monthlyInflow ?? 0)}</p>
          <p className="text-red-500 font-medium">Out: -{fmt(monthlyOutflow ?? 0)}</p>
        </div>
      )}
      {deltaFromPrev != null && (
        <p className={`mt-2 font-medium ${deltaFromPrev >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          Change: {deltaFromPrev >= 0 ? '+' : '-'}{fmt(Math.abs(deltaFromPrev))}
        </p>
      )}
      {daysFromToday != null && (
        <p className="text-slate-500 mt-0.5">
          {daysFromToday === 0 ? 'Today' : `${daysFromToday} day${Math.abs(daysFromToday) === 1 ? '' : 's'} from today`}
        </p>
      )}
      {type && <p className={`mt-0.5 capitalize font-medium ${typeColor}`}>{type}</p>}
    </div>
  )
}

const ACCOUNT_ICONS: Record<string, React.ElementType> = {
  checking: Wallet, savings: PiggyBank, credit: CreditCard, cash: Banknote, loan: Landmark, investment: TrendingUp,
}
const ACCOUNT_LABELS: Record<string, string> = {
  checking: 'Checking', savings: 'Savings', credit: 'Credit Card', cash: 'Cash', loan: 'Loan', investment: 'Investment',
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

function addDays(iso: string, days: number) {
  const dt = new Date(iso + 'T00:00:00')
  dt.setDate(dt.getDate() + days)
  return dt.toISOString().slice(0, 10)
}

function shiftToBusinessDay(iso: string) {
  const dt = new Date(iso + 'T00:00:00')
  const day = dt.getDay()
  if (day === 6) dt.setDate(dt.getDate() - 1)
  if (day === 0) dt.setDate(dt.getDate() + 1)
  return dt.toISOString().slice(0, 10)
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
  const labelRef = useRef<HTMLInputElement>(null)
  useEffect(() => { labelRef.current?.focus({ preventScroll: true }) }, [])
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 animate-scale-in">
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
            <input type="text" placeholder="e.g. Rent payment" value={label} onChange={e => setLabel(e.target.value)} ref={labelRef}
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

function StepSnapshotPanel({ step, stepIndex, accounts, prevBalances, onClose, totalSteps, allSteps, onNavigate, onConvert, onDuplicate, onEdit, onDelete, selectedAccountType, setSelectedAccountType, interestEvents }: {
  step: ForecastStep
  stepIndex: number
  accounts: Account[]
  prevBalances: Record<string, number>
  onClose: () => void
  totalSteps: number
  allSteps: ForecastStep[]
  onNavigate: (newIndex: number) => void
  onConvert: () => void
  onDuplicate: () => void
  onEdit: () => void
  onDelete: () => void
  selectedAccountType: 'checking' | 'savings' | 'cash' | 'investment' | 'credit' | 'loan'
  setSelectedAccountType: (type: 'checking' | 'savings' | 'cash' | 'investment' | 'credit' | 'loan') => void
  interestEvents: Array<any>
}) {
  const TYPE_COLOR = { income: 'text-green-600', expense: 'text-red-500', transfer: 'text-blue-500' }
  const TYPE_ICON = { income: TrendingUp, expense: TrendingDown, transfer: ArrowRightLeft }
  const Icon = TYPE_ICON[step.item.type]
  const color = TYPE_COLOR[step.item.type]
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const toggleCollapsed = (type: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const todayNetWorth = accounts.reduce((s, a) => s + a.balance, 0)
  const today = new Date()
  const daysInForecast = totalSteps
  const stepDate = new Date(step.date)
  const daysUntilStep = Math.ceil((stepDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  // Find interest charges after this step
  const interestAfter = interestEvents.filter(ev => (ev.afterStepIdx ?? -1) >= stepIndex)

  return (
    <div>
      {/* Header with navigation */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate(stepIndex - 1)}
            disabled={stepIndex === 0}
            className="text-slate-400 hover:text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-indigo-500 min-w-[90px]">
            Step {stepIndex + 1} of {totalSteps}
          </h4>
          <button
            onClick={() => onNavigate(stepIndex + 1)}
            disabled={stepIndex === totalSteps - 1}
            className="text-slate-400 hover:text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Days context callout */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-2.5 mb-3 text-xs">
        <p className="text-indigo-600 font-medium">
          {daysUntilStep > 0 ? `Day ${daysUntilStep} of forecast` : 'Today or earlier'}
        </p>
      </div>

      {/* Net worth at this step */}
      {(() => {
        const stepNetWorth = accounts.reduce((s, a) => s + (step.balances[a.id] ?? prevBalances[a.id] ?? a.balance), 0)
        const diff = stepNetWorth - todayNetWorth
        return (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 mb-4">
            <p className="text-xs text-indigo-400 font-semibold uppercase tracking-wider mb-1">Net Worth at Step</p>
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

      {/* Transaction summary card with quick actions */}
      <div className={`rounded-xl border p-3 mb-4 ${
        step.item.type === 'income' ? 'bg-green-50 border-green-100'
        : step.item.type === 'expense' ? 'bg-red-50 border-red-100'
        : 'bg-blue-50 border-blue-100'
      }`}>
        <div className="flex items-start gap-2 mb-2">
          <div className={`rounded-lg p-1.5 flex-shrink-0 ${
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
          <p className={`text-sm font-bold tabular-nums flex-shrink-0 ${color}`}>
            {step.item.type === 'expense' ? '-' : step.item.type === 'income' ? '+' : ''}{fmt(step.item.amount)}
          </p>
        </div>
        {/* Quick action buttons */}
        <div className="flex items-center gap-1 pt-2 border-t border-current border-opacity-10 mt-2">
          <button onClick={onConvert} title="Convert" className="text-xs px-2 py-1 rounded hover:bg-black/10 transition-colors font-medium">Convert</button>
          <button onClick={onDuplicate} title="Duplicate" className="text-xs px-2 py-1 rounded hover:bg-black/10 transition-colors font-medium">Duplicate</button>
          <button onClick={onEdit} title="Edit" className="text-xs px-2 py-1 rounded hover:bg-black/10 transition-colors font-medium">Edit</button>
          <button onClick={onDelete} title="Delete" className="text-xs px-2 py-1 rounded hover:bg-red-600/10 text-red-600 hover:bg-red-600/20 transition-colors font-medium">Delete</button>
        </div>
      </div>

      {/* Interest charges after this step */}
      {interestAfter.length > 0 && (
        <div className="bg-orange-50 border border-orange-100 rounded-lg p-2.5 mb-4">
          <p className="text-xs font-semibold text-orange-600 mb-1.5">Interest Charges After This Step</p>
          <div className="space-y-1">
            {interestAfter.slice(0, 3).map((ev, i) => {
              const chargeTotal = ev.charges.reduce((s: number, c: any) => s + c.charge, 0)
              return (
                <div key={i} className="text-xs text-orange-700">
                  <span className="font-medium">{ev.monthLabel}</span>
                  <span className="text-orange-600 ml-1">+{fmt(chargeTotal)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Account type tabs */}
      {(() => {
        const TYPE_ORDER = ['checking', 'savings', 'cash', 'investment', 'credit', 'loan']
        const grouped = TYPE_ORDER
          .map(type => ({ type, items: accounts.filter(a => a.type === type) }))
          .filter(g => g.items.length > 0)
        if (grouped.length === 1) return null // No tabs needed if only one type
        return (
          <div className="mb-4 flex gap-1 border-b border-slate-200 pb-0 flex-wrap">
            {grouped.map(({ type }) => (
              <button
                key={type}
                onClick={() => setSelectedAccountType(type as any)}
                className={`text-xs font-medium px-2.5 py-1.5 rounded-t transition-colors ${
                  selectedAccountType === type
                    ? 'bg-indigo-50 text-indigo-600 border-b-2 border-indigo-600'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {ACCOUNT_LABELS[type as keyof typeof ACCOUNT_LABELS] ?? type}
              </button>
            ))}
          </div>
        )
      })()}

      {/* All account balances at this step — with tabs and collapsible groups */}
      {(() => {
        const TYPE_ORDER = ['checking', 'savings', 'cash', 'investment', 'credit', 'loan']
        const grouped = TYPE_ORDER
          .map(type => ({ type, items: accounts.filter(a => a.type === type) }))
          .filter(g => g.items.length > 0)
        
        const displayGrouped = TYPE_ORDER.length > 1
          ? grouped.filter(g => g.type === selectedAccountType)
          : grouped
        
        return (
          <div className="space-y-4">
            {displayGrouped.map(({ type, items }) => (
              <div key={type}>
                <div className="flex items-center justify-between mb-1.5">
                  <button
                    onClick={() => toggleCollapsed(type)}
                    className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {collapsedGroups.has(type) ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {ACCOUNT_LABELS[type as keyof typeof ACCOUNT_LABELS] ?? type} ({items.length})
                  </button>
                </div>
                {!collapsedGroups.has(type) && (
                  <div className="space-y-2">
                    {items.map(a => {
                      const bal = step.balances[a.id] ?? prevBalances[a.id] ?? a.balance
                      const delta = step.delta[a.id]
                      const netFromStart = bal - a.balance
                      const AccountIcon = ACCOUNT_ICONS[a.type]
                      const isAffected = delta !== undefined
                      return (
                        <div key={a.id} className={`bg-white rounded-lg border p-2.5 transition-colors ${
                          isAffected ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-100'
                        }`}>
                          <div className="flex items-center gap-2 mb-1">
                            <AccountIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            <p className="text-xs text-slate-600 truncate flex-1 font-medium">{a.name}</p>
                            {isAffected && (
                              <span className={`text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                                delta >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                              }`}>
                                {fmtSigned(delta)}
                              </span>
                            )}
                          </div>
                          <p className={`text-sm font-bold tabular-nums ${bal < -0.005 ? 'text-red-500' : 'text-slate-800'}`}>
                            {bal < -0.005 ? '-' : ''}{fmt(Math.abs(bal))}
                          </p>
                          {netFromStart !== 0 && (
                            <p className={`text-xs mt-0.5 ${netFromStart > 0 ? 'text-green-600' : 'text-red-500'}`}>
                              {fmtSigned(netFromStart)} from today
                            </p>
                          )}
                          {a.type === 'credit' && a.credit_limit != null && a.credit_limit > 0 && (() => {
                            const used = Math.max(0, -bal)
                            const pct = Math.min((used / a.credit_limit) * 100, 100)
                            const barColor = pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-orange-400' : 'bg-green-400'
                            return (
                              <div className="mt-2">
                                <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                                  <span>{fmt(used)} used of {fmt(a.credit_limit)}</span>
                                  <span className={`font-semibold ${pct >= 90 ? 'text-red-500' : pct >= 60 ? 'text-orange-500' : 'text-green-600'}`}>{pct.toFixed(0)}%</span>
                                </div>
                                <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
                                  <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })()}
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
  const [viewMode, setViewMode] = useState<'chart' | 'calendar'>('chart')
  const [calendarMonth, setCalendarMonth] = useState<{ year: number; month: number }>(() => {
    const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }
  })
  const [calendarSelectedDay, setCalendarSelectedDay] = useState<string | null>(null)
  const [zoomedDate, setZoomedDate] = useState<string | null>(null)
  const [chartOpacity, setChartOpacity] = useState(1)

  const triggerZoom = useCallback((newDate: string | null) => {
    setChartOpacity(0)
    setTimeout(() => {
      setZoomedDate(newDate)
      setChartOpacity(1)
    }, 160)
  }, [])
  const [loading, setLoading] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<ForecastItem | null>(null)
  const [confirmConvert, setConfirmConvert] = useState<ForecastItem | null>(null)
  const [selectedStepIdx, setSelectedStepIdx] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [showMobilePanel, setShowMobilePanel] = useState(false)
  const [isCompactChart, setIsCompactChart] = useState(false)
  const [activeStepId, setActiveStepId] = useState<string | null>(null)
  const [safeBalanceFloor, setSafeBalanceFloor] = useState(1000)
  const [delayRentScenario, setDelayRentScenario] = useState(false)
  const [businessDayPaycheckScenario, setBusinessDayPaycheckScenario] = useState(false)
  const [skipRecurringExpenseScenario, setSkipRecurringExpenseScenario] = useState(false)
  const [selectedAccountType, setSelectedAccountType] = useState<'checking' | 'savings' | 'cash' | 'investment' | 'credit' | 'loan'>('checking')
  const stepCardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const load = useCallback(async () => {
    const res = await fetch('/api/forecast')
    if (!res.ok) { const d = await res.json().catch(() => ({})); if (d.error === 'LOCKED') lock(); setLoading(false); return }
    setItems(await res.json())
    setLoading(false)
  }, [lock])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const syncViewport = () => setIsCompactChart(window.innerWidth < 640)
    syncViewport()
    window.addEventListener('resize', syncViewport)
    return () => window.removeEventListener('resize', syncViewport)
  }, [])

  // Default focus account to first non-debt account
  useEffect(() => {
    if (!focusAccountId && accounts.length > 0) {
      const first = accounts.find(a => a.type !== 'credit' && a.type !== 'loan') ?? accounts[0]
      setFocusAccountId(first.id)
    }
  }, [accounts, focusAccountId])

  const isNetWorth = focusAccountId === '__net_worth__'

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

  const todayStr = new Date().toISOString().slice(0, 10)

  const scenarioItems = useMemo(() => {
    let next = items.map(item => ({ ...item }))

    if (delayRentScenario) {
      const rentIdx = next.findIndex(item => item.type === 'expense' && item.date >= todayStr && /rent/i.test(item.label))
      if (rentIdx >= 0) {
        next[rentIdx] = { ...next[rentIdx], date: addDays(next[rentIdx].date, 3), label: `${next[rentIdx].label} (shifted +3d)` }
      }
    }

    if (businessDayPaycheckScenario) {
      next = next.map(item => {
        if (item.type !== 'income' || !/paycheck|salary/i.test(item.label)) return item
        const shifted = shiftToBusinessDay(item.date)
        if (shifted === item.date) return item
        return { ...item, date: shifted, label: `${item.label} (business day)` }
      })
    }

    if (skipRecurringExpenseScenario) {
      const thisMonth = todayStr.slice(0, 7)
      const monthExpenses = next.filter(item => item.type === 'expense' && item.date.startsWith(thisMonth))
      const repeatedLabel = monthExpenses
        .map(item => item.label.toLowerCase())
        .find((label, idx, labels) => labels.indexOf(label) !== idx)
      if (repeatedLabel) {
        const skipIdx = next.findIndex(item => item.type === 'expense' && item.date.startsWith(thisMonth) && item.label.toLowerCase() === repeatedLabel)
        if (skipIdx >= 0) next = next.filter((_, idx) => idx !== skipIdx)
      }
    }

    return next
  }, [items, delayRentScenario, businessDayPaycheckScenario, skipRecurringExpenseScenario, todayStr])

  const steps = useMemo(() => buildForecast(scenarioItems, accounts), [scenarioItems, accounts])

  const focusStepById = useCallback((stepId: string) => {
    const idx = steps.findIndex(s => s.item.id === stepId)
    if (idx < 0) return
    setSelectedStepIdx(idx)
    setActiveStepId(stepId)
    const el = stepCardRefs.current[stepId]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (isCompactChart) setShowMobilePanel(true)
  }, [steps, isCompactChart])

  useEffect(() => {
    if (selectedStepIdx === null) {
      setActiveStepId(null)
      return
    }
    setActiveStepId(steps[selectedStepIdx]?.item.id ?? null)
  }, [selectedStepIdx, steps])

  useEffect(() => {
    if (selectedStepIdx !== null && selectedStepIdx >= steps.length) {
      setSelectedStepIdx(null)
      setActiveStepId(null)
    }
  }, [selectedStepIdx, steps.length])

  // For the chart: starting balance + each step for the focused account (or net worth)
  const chartData = useMemo(() => {
    if (!focusAccountId) return []

    const netWorthStart = accounts.reduce((sum, a) => sum + a.balance, 0)
    const startBal = isNetWorth ? netWorthStart : (accounts.find(a => a.id === focusAccountId)?.balance ?? 0)

    const getBalance = (balances: Record<string, number>) =>
      isNetWorth
        ? accounts.reduce((sum, a) => sum + (balances[a.id] ?? a.balance), 0)
        : (balances[focusAccountId] ?? undefined)
    const getDeltaValue = (delta: Record<string, number>) =>
      isNetWorth
        ? Object.values(delta).reduce((sum, amount) => sum + amount, 0)
        : (delta[focusAccountId] ?? 0)
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)

    let cutoffStart: string | null = null
    let cutoffEnd: string | null = null
    if (chartRange === 'default') {
      cutoffStart = todayStr
    } else if (chartRange === 'month') {
      const in30Days = new Date(today)
      in30Days.setDate(in30Days.getDate() + 30)
      cutoffStart = todayStr
      cutoffEnd = in30Days.toISOString().slice(0, 10)
    } else if (chartRange === 'year') {
      const in365Days = new Date(today)
      in365Days.setDate(in365Days.getDate() + 365)
      cutoffStart = todayStr
      cutoffEnd = in365Days.toISOString().slice(0, 10)
    }
    // 'all' — no filtering

    const filteredSteps = steps.filter(s => {
      if (cutoffStart && s.date < cutoffStart) return false
      if (cutoffEnd && s.date > cutoffEnd) return false
      return true
    })

    const points: {
      x: string
      rawDate: string
      displayLabel: string
      tickLabel: string
      balance: number
      step?: string
      stepId?: string
      stepIndex?: number
      type?: 'income' | 'expense' | 'transfer'
      monthlyInflow?: number
      monthlyOutflow?: number
      isEndpoint?: boolean
      deltaFromPrev?: number
      daysFromToday?: number
      downturnBalance?: number | null
    }[] = []
    points.push({ x: 'today-anchor', rawDate: todayStr, displayLabel: 'Today', tickLabel: 'Today', balance: startBal })

    let lastWeekBucket = -1

    if (chartRange === 'year' && cutoffEnd) {
      let stepIndex = 0
      let runningBalance = startBal
      const rangeEnd = new Date(cutoffEnd + 'T00:00:00')
      let cursor = new Date(today.getFullYear(), today.getMonth(), 1)

      while (cursor <= rangeEnd) {
        const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
        const monthEndStr = monthEnd.toISOString().slice(0, 10)
        const monthLabel = monthEnd.toLocaleDateString('en-US', { month: 'short' })
        let monthTransactionCount = 0
        let monthEndBalance = runningBalance
        let monthInflow = 0
        let monthOutflow = 0

        while (stepIndex < filteredSteps.length && filteredSteps[stepIndex].date <= monthEndStr) {
          const deltaValue = getDeltaValue(filteredSteps[stepIndex].delta)
          if (deltaValue > 0) monthInflow += deltaValue
          if (deltaValue < 0) monthOutflow += Math.abs(deltaValue)
          const bal = getBalance(filteredSteps[stepIndex].balances)
          if (bal !== undefined) {
            monthEndBalance = bal
            runningBalance = bal
          }
          monthTransactionCount++
          stepIndex++
        }

        const isCurrentMonth = cursor.getFullYear() === today.getFullYear() && cursor.getMonth() === today.getMonth()
        const monthDisplayLabel = isCurrentMonth
          ? monthEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : monthEnd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

        points.push({
          x: `month-${cursor.getFullYear()}-${cursor.getMonth()}`,
          rawDate: monthEndStr,
          displayLabel: monthDisplayLabel,
          tickLabel: monthLabel,
          balance: monthEndBalance,
          step: monthTransactionCount > 0 ? `${monthTransactionCount} planned transaction${monthTransactionCount === 1 ? '' : 's'}` : 'No planned transactions',
          monthlyInflow: monthInflow,
          monthlyOutflow: monthOutflow,
        })

        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
      }
    } else {
      for (const [index, s] of filteredSteps.entries()) {
        const bal = getBalance(s.balances)
        if (bal !== undefined) {
          const pointDate = new Date(s.date + 'T00:00:00')
          let tickLabel = ''

          if (chartRange === 'month') {
            const dayOffset = Math.floor((pointDate.getTime() - today.getTime()) / 86400000)
            const weekBucket = Math.floor(dayOffset / 7)
            if (weekBucket !== lastWeekBucket) {
              tickLabel = pointDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              lastWeekBucket = weekBucket
            }
          } else {
            tickLabel = formatDate(s.date)
          }

          points.push({
            x: `${s.date}-${index}`,
            rawDate: s.date,
            displayLabel: formatDate(s.date),
            tickLabel,
            balance: bal,
            step: s.label,
            stepId: s.item.id,
            stepIndex: index,
            type: s.item.type,
          })
        }
      }
    }

    if (points.length > 1) {
      const lastPoint = points.at(-1)
      if (!lastPoint) return points
      if (!lastPoint.tickLabel) {
        lastPoint.tickLabel = chartRange === 'year'
          ? new Date(lastPoint.rawDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })
          : lastPoint.displayLabel
      }
    }

    const enrichedPoints = points.map((point, index, arr) => {
      const prev = index > 0 ? arr[index - 1] : null
      const pointDate = new Date(point.rawDate + 'T00:00:00')
      const todayDate = new Date(todayStr + 'T00:00:00')
      const daysFromToday = Math.round((pointDate.getTime() - todayDate.getTime()) / 86400000)
      const deltaFromPrev = prev ? point.balance - prev.balance : undefined
      const downturnBalance = prev && point.balance < prev.balance ? point.balance : null
      return {
        ...point,
        isEndpoint: index === arr.length - 1,
        daysFromToday,
        deltaFromPrev,
        downturnBalance,
      }
    })

    if (zoomedDate) {
      const center = new Date(zoomedDate + 'T00:00:00')
      const lo = new Date(center); lo.setDate(lo.getDate() - 14)
      const hi = new Date(center); hi.setDate(hi.getDate() + 14)
      const loStr = lo.toISOString().slice(0, 10)
      const hiStr = hi.toISOString().slice(0, 10)
      return enrichedPoints.filter((p) => p.rawDate >= loStr && p.rawDate <= hiStr)
    }
    return enrichedPoints
  }, [steps, focusAccountId, accounts, chartRange, zoomedDate, isNetWorth])

  const chartStats = useMemo(() => {
    if (chartData.length < 2) return null
    const start = chartData[0].balance
    const end = chartData.at(-1)?.balance ?? start
    let totalIn = 0, totalOut = 0
    for (let i = 1; i < chartData.length; i++) {
      const delta = chartData[i].balance - chartData[i - 1].balance
      if (delta > 0) totalIn += delta
      else totalOut += Math.abs(delta)
    }
    return { start, end, net: end - start, totalIn, totalOut }
  }, [chartData])

  const chartYDomain = useMemo((): [number, number] => {
    if (chartData.length === 0) return [-1000, 1000]

    const balances = chartData.map(point => point.balance)
    const minBalance = Math.min(...balances)
    const maxBalance = Math.max(...balances)
    const range = maxBalance - minBalance
    const magnitude = Math.max(Math.abs(minBalance), Math.abs(maxBalance))
    const padding = range === 0
      ? Math.max(magnitude * 0.08, 1000)
      : Math.max(range * 0.12, magnitude * 0.03, 250)

    return [minBalance - padding, maxBalance + padding]
  }, [chartData])

  const chartShowsZero = chartYDomain[0] <= 0 && chartYDomain[1] >= 0

  const riskInsights = useMemo(() => {
    if (!focusAccountId || steps.length === 0) return null

    const getStepBalance = (step: ForecastStep) => (
      isNetWorth
        ? accounts.reduce((sum, a) => sum + (step.balances[a.id] ?? a.balance), 0)
        : (step.balances[focusAccountId] ?? 0)
    )
    const getStepDelta = (step: ForecastStep) => (
      isNetWorth
        ? Object.values(step.delta).reduce((sum, amount) => sum + amount, 0)
        : (step.delta[focusAccountId] ?? 0)
    )

    const futureSteps = steps.filter(step => step.date >= todayStr)
    if (futureSteps.length === 0) return null

    const lowest = futureSteps.reduce((minStep, step) => (getStepBalance(step) < getStepBalance(minStep) ? step : minStep), futureSteps[0])
    const belowFloorDays = new Set(
      futureSteps
        .filter(step => getStepBalance(step) < safeBalanceFloor)
        .map(step => step.date),
    ).size

    let largestOutflow = 0
    let outflowDate: string | null = null
    for (let i = 0; i < futureSteps.length; i++) {
      const start = new Date(futureSteps[i].date + 'T00:00:00')
      const end = new Date(start)
      end.setDate(end.getDate() + 7)
      const total = futureSteps
        .filter(step => {
          const stepDate = new Date(step.date + 'T00:00:00')
          return stepDate >= start && stepDate < end
        })
        .reduce((sum, step) => {
          const delta = getStepDelta(step)
          return delta < 0 ? sum + Math.abs(delta) : sum
        }, 0)
      if (total > largestOutflow) {
        largestOutflow = total
        outflowDate = futureSteps[i].date
      }
    }

    return {
      lowestDate: lowest.date,
      lowestBalance: getStepBalance(lowest),
      belowFloorDays,
      largestOutflow,
      outflowDate,
    }
  }, [steps, focusAccountId, isNetWorth, accounts, todayStr, safeBalanceFloor])

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
          className="flex items-center gap-2 bg-slate-800 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 transition-colors btn-press">
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
            <>
              {/* Header row: title + view toggle only */}
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">Balance Forecast</h4>
                <div className="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5">
                  <button onClick={() => setViewMode('chart')}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${viewMode === 'chart' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <BarChart2 className="w-3 h-3" /> Chart
                  </button>
                  <button onClick={() => setViewMode('calendar')}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${viewMode === 'calendar' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Calendar className="w-3 h-3" /> Calendar
                  </button>
                </div>
              </div>

              {/* Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">

              {viewMode === 'chart' && (
                <>
                  {/* Chart controls row */}
                  <div className="flex items-center justify-between mb-4">
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
                      <option value="__net_worth__">Net Worth</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                </>
              )}

              {viewMode === 'calendar' && (
                <>
                  {/* Calendar month nav row */}
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium text-slate-700">
                      {new Date(calendarMonth.year, calendarMonth.month).toLocaleString('en-US', { month: 'long', year: 'numeric' })}
                    </span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setCalendarMonth(p => { const d = new Date(p.year, p.month - 1); return { year: d.getFullYear(), month: d.getMonth() } })}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button onClick={() => setCalendarMonth(p => { const d = new Date(p.year, p.month + 1); return { year: d.getFullYear(), month: d.getMonth() } })}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </>
              )}

              {viewMode === 'chart' && (
                <>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Scenario</span>
                    <button onClick={() => setDelayRentScenario(v => !v)} className={`text-xs px-2 py-1 rounded-full border transition-colors ${delayRentScenario ? 'bg-indigo-50 border-indigo-300 text-indigo-600' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-700'}`}>Delay rent +3d</button>
                    <button onClick={() => setBusinessDayPaycheckScenario(v => !v)} className={`text-xs px-2 py-1 rounded-full border transition-colors ${businessDayPaycheckScenario ? 'bg-indigo-50 border-indigo-300 text-indigo-600' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-700'}`}>Paycheck to business day</button>
                    <button onClick={() => setSkipRecurringExpenseScenario(v => !v)} className={`text-xs px-2 py-1 rounded-full border transition-colors ${skipRecurringExpenseScenario ? 'bg-indigo-50 border-indigo-300 text-indigo-600' : 'bg-white border-slate-200 text-slate-500 hover:text-slate-700'}`}>Skip recurring expense</button>
                    {(delayRentScenario || businessDayPaycheckScenario || skipRecurringExpenseScenario) && (
                      <button onClick={() => { setDelayRentScenario(false); setBusinessDayPaycheckScenario(false); setSkipRecurringExpenseScenario(false) }} className="text-xs text-slate-400 hover:text-slate-600">Reset</button>
                    )}
                  </div>
                  {riskInsights && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Lowest Balance</p>
                        <p className={`text-xs font-semibold ${riskInsights.lowestBalance < 0 ? 'text-red-500' : 'text-slate-700'}`}>{riskInsights.lowestBalance < 0 ? '-' : ''}{fmtWhole(Math.abs(riskInsights.lowestBalance))}</p>
                        <p className="text-[11px] text-slate-500">{formatDate(riskInsights.lowestDate)}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Below Floor</p>
                        <p className={`text-xs font-semibold ${riskInsights.belowFloorDays > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{riskInsights.belowFloorDays} day{riskInsights.belowFloorDays === 1 ? '' : 's'}</p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-[11px] text-slate-500">Floor</span>
                          <input
                            type="number"
                            min={0}
                            step={100}
                            value={safeBalanceFloor}
                            onChange={e => setSafeBalanceFloor(Math.max(0, Number(e.target.value) || 0))}
                            className="w-20 text-[11px] border border-slate-200 rounded px-1.5 py-0.5 bg-white text-slate-600"
                          />
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Largest 7-Day Outflow</p>
                        <p className={`text-xs font-semibold ${riskInsights.largestOutflow > 0 ? 'text-red-500' : 'text-slate-700'}`}>-{fmtWhole(Math.abs(riskInsights.largestOutflow))}</p>
                        <p className="text-[11px] text-slate-500">{riskInsights.outflowDate ? `Starting ${formatDate(riskInsights.outflowDate)}` : 'No outflow cluster'}</p>
                      </div>
                    </div>
                  )}
                  {zoomedDate && (
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-500">Showing ±14 days around <span className="font-medium text-slate-700">{formatDate(zoomedDate)}</span></span>
                      <button onClick={() => triggerZoom(null)} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">Zoom out</button>
                    </div>
                  )}
                  <div style={{
                    opacity: chartOpacity,
                    transition: chartOpacity === 0 ? 'opacity 160ms ease' : 'opacity 200ms ease',
                  }}>
                  {chartStats && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                      <div className="min-w-[72px]">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Start</p>
                        <p className={`text-sm font-semibold ${chartStats.start >= 0 ? 'text-slate-700' : 'text-red-500'}`}>
                          {chartStats.start < 0 ? '-' : ''}{fmtWhole(Math.abs(chartStats.start))}
                        </p>
                      </div>
                      <div className="min-w-[72px]">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">End</p>
                        <p className={`text-sm font-semibold ${chartStats.end >= 0 ? 'text-slate-700' : 'text-red-500'}`}>
                          {chartStats.end < 0 ? '-' : ''}{fmtWhole(Math.abs(chartStats.end))}
                        </p>
                      </div>
                      <div className="min-w-[72px]">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Net</p>
                        <p className={`text-sm font-semibold ${chartStats.net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {chartStats.net >= 0 ? '+' : '-'}{fmtWhole(Math.abs(chartStats.net))}
                        </p>
                      </div>
                      <div className="min-w-[72px]">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Total In</p>
                        <p className="text-sm font-semibold text-emerald-600">+{fmtWhole(chartStats.totalIn)}</p>
                      </div>
                      <div className="min-w-[72px]">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Total Out</p>
                        <p className="text-sm font-semibold text-red-500">-{fmtWhole(chartStats.totalOut)}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-x-4 gap-y-2 flex-wrap mb-3 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-4 h-0.5 bg-indigo-500 rounded-full" />
                      Balance Trend
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-500/25 ring-1 ring-indigo-500/40" />
                      Projected End
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-4 h-0.5 bg-red-500 rounded-full" />
                      Downturn
                    </span>
                    {chartRange === 'year' && (
                      <>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/30" />
                          Monthly Inflow
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm bg-red-500/25" />
                          Monthly Outflow
                        </span>
                      </>
                    )}
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                      onClick={(e) => {
                        if (!e?.activePayload?.[0]) return
                        const point = e.activePayload[0].payload as { stepId?: string; rawDate?: string }
                        if (point.stepId) {
                          focusStepById(point.stepId)
                          return
                        }
                        if (!point.rawDate || point.rawDate === 'today-anchor') return
                        if (zoomedDate) {
                          triggerZoom(null)
                          return
                        }
                        if (chartRange === 'year') {
                          triggerZoom(point.rawDate)
                        }
                      }}
                      style={{ cursor: 'pointer' }}>
                      <defs>
                        <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis
                        dataKey="x"
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                        minTickGap={chartRange === 'year' ? 18 : 24}
                        tickFormatter={(value: string) => chartData.find(point => point.x === value)?.tickLabel ?? ''}
                      />
                      {chartRange === 'year' && <YAxis yAxisId="flow" hide />}
                      <YAxis domain={chartYDomain} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickCount={isCompactChart ? 4 : 5} tickFormatter={(v: number) => { const k = v / 1000; return Math.abs(k) >= 1 ? `${k < 0 ? '-' : ''}$${Math.abs(k).toFixed(0)}k` : `${v < 0 ? '-' : ''}$${Math.abs(v)}` }} />
                      <Tooltip content={<ForecastTooltip />} />
                      {chartShowsZero && <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.4} />}
                      {chartData.some(p => p.x === 'today-anchor') && (
                        <ReferenceLine x="today-anchor" stroke="#6366f1" strokeDasharray="3 3" strokeOpacity={0.5} />
                      )}
                      {chartRange === 'year' && (
                        <>
                          <Bar yAxisId="flow" dataKey="monthlyInflow" fill="#10b981" fillOpacity={0.16} radius={[4, 4, 0, 0]} barSize={14} />
                          <Bar yAxisId="flow" dataKey="monthlyOutflow" fill="#ef4444" fillOpacity={0.12} radius={[4, 4, 0, 0]} barSize={14} />
                        </>
                      )}
                      <Area type="linear" dataKey="downturnBalance" stroke="#ef4444" strokeWidth={2} fillOpacity={0} dot={false} activeDot={false} connectNulls={false} />
                      <Area
                        type="linear"
                        dataKey="balance"
                        stroke="#6366f1"
                        strokeWidth={2}
                        fill="url(#balGrad)"
                        dot={<ForecastDot activeStepId={activeStepId} />}
                        activeDot={<ForecastActiveDot />}
                        isAnimationActive
                        animationDuration={700}
                      />
                      {chartData.length > 1 && chartData.at(-1)?.x && (
                        <ReferenceLine
                          x={chartData.at(-1)!.x}
                          strokeOpacity={0}
                          label={{ value: 'Projected End', position: 'insideTopLeft', fontSize: 10, fill: '#6366f1' }}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                  </div>
                </>
              )}

              {viewMode === 'calendar' && (() => {
                const { year, month } = calendarMonth
                const firstDay = new Date(year, month, 1).getDay()
                const daysInMonth = new Date(year, month + 1, 0).getDate()
                const todayStr = new Date().toISOString().slice(0, 10)

                // Map date string → steps on that day
                const stepsByDate: Record<string, ForecastStep[]> = {}
                for (const s of steps) {
                  if (!stepsByDate[s.date]) stepsByDate[s.date] = []
                  stepsByDate[s.date].push(s)
                }

                // Balances just before the month starts (for sidebar display)
                const balancesBeforeMonth = (() => {
                  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`
                  const before = steps.filter(s => s.date < monthStart)
                  if (before.length > 0) return before.at(-1)!.balances
                  return Object.fromEntries(accounts.map(a => [a.id, a.balance]))
                })()

                const cells: (number | null)[] = [
                  ...Array(firstDay).fill(null),
                  ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
                ]
                // pad to full weeks
                while (cells.length % 7 !== 0) cells.push(null)

                const selectedSteps = calendarSelectedDay ? (stepsByDate[calendarSelectedDay] ?? []) : []
                const selectedBalances = calendarSelectedDay ? (() => {
                  // find last step on or before selected day
                  const prev = steps.filter(s => s.date <= calendarSelectedDay!)
                  if (prev.length > 0) return prev.at(-1)!.balances
                  return Object.fromEntries(accounts.map(a => [a.id, a.balance]))
                })() : balancesBeforeMonth

                return (
                  <div className="space-y-4">
                    {/* Calendar grid — always full width */}
                    <div>
                      <div className="grid grid-cols-7 mb-1">
                        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                          <div key={d} className="text-center text-[10px] font-semibold text-slate-400 pb-1">{d}</div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 gap-0.5">
                        {cells.map((day, idx) => {
                          if (!day) return <div key={idx} />
                          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                          const daySteps = stepsByDate[dateStr] ?? []
                          const isToday = dateStr === todayStr
                          const isSelected = dateStr === calendarSelectedDay
                          const hasIncome = daySteps.some(s => s.item.type === 'income')
                          const hasExpense = daySteps.some(s => s.item.type === 'expense')
                          const hasTransfer = daySteps.some(s => s.item.type === 'transfer')
                          return (
                            <button key={idx}
                              onClick={() => setCalendarSelectedDay(isSelected ? null : dateStr)}
                              className={`relative rounded-lg p-1.5 text-left transition-colors min-h-[52px] ${
                                isSelected ? 'bg-indigo-600 text-white' :
                                isToday ? 'bg-indigo-50 ring-1 ring-indigo-300' :
                                daySteps.length > 0 ? 'bg-slate-50 hover:bg-slate-100' :
                                'hover:bg-slate-50'
                              }`}>
                              <span className={`text-xs font-semibold ${isSelected ? 'text-white' : isToday ? 'text-indigo-600' : 'text-slate-700'}`}>
                                {day}
                              </span>
                              {daySteps.length > 0 && (
                                <div className="flex gap-0.5 mt-1 flex-wrap">
                                  {hasIncome && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-green-300' : 'bg-green-400'}`} />}
                                  {hasExpense && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-red-300' : 'bg-red-400'}`} />}
                                  {hasTransfer && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-blue-300' : 'bg-blue-400'}`} />}
                                </div>
                              )}
                              {daySteps.length > 1 && (
                                <span className={`absolute bottom-1 right-1.5 text-[9px] font-bold ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>
                                  {daySteps.length}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Day detail panel — below the calendar, expands in */}
                    <div style={{
                      maxHeight: calendarSelectedDay ? '500px' : '0px',
                      overflow: 'hidden',
                      transition: 'max-height 300ms ease',
                    }}>
                    {calendarSelectedDay && (
                      <div className="border-t border-slate-100 pt-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm font-semibold text-slate-700">{formatDate(calendarSelectedDay)}</p>
                          <button onClick={() => setCalendarSelectedDay(null)} className="text-slate-400 hover:text-slate-600">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex gap-6">
                          {/* Account balances */}
                          <div className="min-w-[160px]">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Balances</p>
                            <div className="space-y-1">
                              {accounts.map(a => {
                                const bal = selectedBalances[a.id] ?? a.balance
                                return (
                                  <div key={a.id} className="flex items-center justify-between gap-4">
                                    <span className="text-xs text-slate-500 truncate">{a.name}</span>
                                    <span className={`text-xs font-semibold tabular-nums shrink-0 ${bal < -0.005 ? 'text-red-500' : 'text-slate-700'}`}>
                                      {bal < -0.005 ? '-' : ''}{fmt(Math.abs(bal))}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                          {/* Transactions */}
                          {selectedSteps.length > 0 && (
                            <div className="flex-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Transactions</p>
                              <div className="flex flex-wrap gap-2">
                                {selectedSteps.map(s => {
                                  const acct = s.item.account_id ? accounts.find(a => a.id === s.item.account_id) : null
                                  return (
                                    <div key={s.item.id} className={`rounded-lg px-2.5 py-2 min-w-[140px] ${
                                      s.item.type === 'income' ? 'bg-green-50' :
                                      s.item.type === 'expense' ? 'bg-red-50' : 'bg-blue-50'
                                    }`}>
                                      <p className="text-xs font-medium text-slate-700 truncate">{s.item.label}</p>
                                      <div className="flex items-center justify-between mt-0.5 gap-2">
                                        <span className="text-[10px] text-slate-400 truncate">{acct?.name ?? '—'}</span>
                                        <span className={`text-xs font-semibold tabular-nums shrink-0 ${
                                          s.item.type === 'income' ? 'text-green-600' :
                                          s.item.type === 'expense' ? 'text-red-500' : 'text-blue-500'
                                        }`}>
                                          {s.item.type === 'expense' ? '-' : s.item.type === 'income' ? '+' : ''}{fmt(s.item.amount)}
                                        </span>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                          {selectedSteps.length === 0 && (
                            <p className="text-xs text-slate-400 self-center">No planned transactions.</p>
                          )}
                        </div>
                      </div>
                    )}
                    </div>
                  </div>
                )
              })()}
            </div>
          </>
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
                    ref={(el) => { stepCardRefs.current[step.item.id] = el }}
                    onClick={() => {
                      if (selectedStepIdx === i) {
                        setSelectedStepIdx(null)
                        setActiveStepId(null)
                        return
                      }
                      focusStepById(step.item.id)
                    }}
                    className={`rounded-xl border p-4 flex items-start gap-3 group cursor-pointer transition-all ${
                      selectedStepIdx === i || activeStepId === step.item.id
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
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-slate-400">{formatDate(step.date)}</span>
                        {accountName && (
                          <span className="text-xs text-slate-400">· {accountName}{toAccountName ? ` → ${toAccountName}` : ''}</span>
                        )}
                      </div>
                      {/* Per-account balance after this step */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {Object.entries(step.delta).map(([id, d]) => {
                          const acc = accounts.find(a => a.id === id)
                          if (!acc) return null
                          return (
                            <span key={id} className="text-xs px-1.5 py-0.5 rounded bg-slate-50 border border-slate-100 text-slate-500">
                              <span className={d >= 0 ? 'text-green-600' : 'text-red-500'}>{fmtSigned(d)}</span>
                              {' '}→ <span className={`font-medium ${step.balances[id] < -0.005 ? 'text-red-500' : 'text-slate-700'}`}>{step.balances[id] < -0.005 ? '-' : ''}{fmt(Math.abs(step.balances[id]))}</span>
                            </span>
                          )
                        })}
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
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
                  {/* Mobile action row */}
                  <div className="sm:hidden flex items-center gap-3 px-4 pb-3 border-t border-slate-100 mt-0 pt-2">
                    <button onClick={e => { e.stopPropagation(); setConfirmConvert(step.item) }}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-green-600 transition-colors">
                      <CheckCheck className="w-3.5 h-3.5" /> Convert
                    </button>
                    <button onClick={e => { e.stopPropagation(); handleDuplicate(step.item) }}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-500 transition-colors">
                      <Copy className="w-3.5 h-3.5" /> Duplicate
                    </button>
                    <button onClick={e => { e.stopPropagation(); setEditingItem(step.item); setShowForm(true) }}
                      className="text-xs text-slate-400 hover:text-slate-700 transition-colors">Edit</button>
                    <button onClick={e => { e.stopPropagation(); setConfirmDelete(step.item) }}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                  </div>
                )
              })}
            </div>

            {/* Right panel: fixed to viewport — desktop only */}
            <div className="hidden md:block fixed top-0 right-0 w-72 h-screen overflow-y-auto bg-slate-50 border-l border-slate-200 p-4 z-10">
              {selectedStepIdx !== null ? (
                <StepSnapshotPanel
                  step={steps[selectedStepIdx]}
                  stepIndex={selectedStepIdx}
                  accounts={accounts}
                  prevBalances={selectedStepIdx > 0 ? steps[selectedStepIdx - 1].balances : Object.fromEntries(accounts.map(a => [a.id, a.balance]))}
                  onClose={() => setSelectedStepIdx(null)}
                  totalSteps={steps.length}
                  allSteps={steps}
                  onNavigate={(newIdx) => {
                    if (newIdx >= 0 && newIdx < steps.length) {
                      setSelectedStepIdx(newIdx)
                      focusStepById(steps[newIdx].item.id)
                    }
                  }}
                  onConvert={() => setConfirmConvert(steps[selectedStepIdx].item)}
                  onDuplicate={() => handleDuplicate(steps[selectedStepIdx].item)}
                  onEdit={() => { setEditingItem(steps[selectedStepIdx].item); setShowForm(true) }}
                  onDelete={() => setConfirmDelete(steps[selectedStepIdx].item)}
                  selectedAccountType={selectedAccountType}
                  setSelectedAccountType={setSelectedAccountType}
                  interestEvents={interestEvents}
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
                  {(() => {
                    const TYPE_ORDER = ['checking', 'savings', 'cash', 'investment', 'credit', 'loan']
                    const displayAccounts = affectedAccountIds.length === 0
                      ? accounts
                      : accounts.filter(a => affectedAccountIds.includes(a.id) || finalBalances[a.id] !== undefined)
                    const grouped = TYPE_ORDER
                      .map(type => ({ type, items: displayAccounts.filter(a => a.type === type) }))
                      .filter(g => g.items.length > 0)
                    return (
                      <div className="space-y-4">
                        {grouped.map(({ type, items }) => (
                          <div key={type}>
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{ACCOUNT_LABELS[type] ?? type}</p>
                            <div className="space-y-2">
                              {items.map(a => {
                                const final = finalBalances[a.id] ?? a.balance
                                const diff = final - a.balance
                                const Icon = ACCOUNT_ICONS[a.type] ?? Wallet
                                return (
                                  <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-3">
                                    <div className="flex items-center gap-2 mb-1">
                                      <Icon className="w-3.5 h-3.5 text-slate-400" />
                                      <p className="text-xs text-slate-500 truncate flex-1">{a.name}</p>
                                    </div>
                                    <p className={`text-sm font-semibold tabular-nums ${final < -0.005 ? 'text-red-500' : 'text-slate-800'}`}>
                                      {final < -0.005 ? '-' : ''}{fmt(Math.abs(final))}
                                    </p>
                                    {diff !== 0 && (
                                      <p className={`text-xs mt-0.5 ${diff > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                        {fmtSigned(diff)} from today
                                      </p>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile balance panel — bottom sheet */}
      <div className="md:hidden">
        {/* Toggle button */}
        <button
          onClick={() => setShowMobilePanel(v => !v)}
          className="fixed bottom-4 right-4 z-30 flex items-center gap-2 bg-indigo-600 text-white rounded-full px-4 py-2.5 shadow-lg text-sm font-medium"
        >
          {showMobilePanel ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          Balances
        </button>

        {/* Overlay */}
        {showMobilePanel && (
          <div className="fixed inset-0 bg-black/30 z-20" onClick={() => setShowMobilePanel(false)} />
        )}

        {/* Sheet */}
        <div className={`fixed bottom-0 inset-x-0 z-30 bg-white rounded-t-2xl shadow-xl transition-transform duration-300 max-h-[75vh] flex flex-col ${
          showMobilePanel ? 'translate-y-0' : 'translate-y-full'
        }`}>
          <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-slate-100 flex-shrink-0">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {selectedStepIdx !== null ? `Step ${selectedStepIdx + 1} Snapshot` : 'After All Transactions'}
            </h4>
            <button onClick={() => setShowMobilePanel(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-y-auto flex-1 p-4">
            {selectedStepIdx !== null ? (
              <StepSnapshotPanel
                step={steps[selectedStepIdx]}
                stepIndex={selectedStepIdx}
                accounts={accounts}
                prevBalances={selectedStepIdx > 0 ? steps[selectedStepIdx - 1].balances : Object.fromEntries(accounts.map(a => [a.id, a.balance]))}
                onClose={() => { setSelectedStepIdx(null); setShowMobilePanel(false) }}
                totalSteps={steps.length}
                allSteps={steps}

                onNavigate={(newIdx) => {
                  if (newIdx >= 0 && newIdx < steps.length) {
                    setSelectedStepIdx(newIdx)
                    focusStepById(steps[newIdx].item.id)
                  }
                }}
                onConvert={() => setConfirmConvert(steps[selectedStepIdx].item)}
                onDuplicate={() => handleDuplicate(steps[selectedStepIdx].item)}
                onEdit={() => { setEditingItem(steps[selectedStepIdx].item); setShowForm(true) }}
                onDelete={() => setConfirmDelete(steps[selectedStepIdx].item)}
                selectedAccountType={selectedAccountType}
                setSelectedAccountType={setSelectedAccountType}
                interestEvents={interestEvents}
              />
            ) : (
              <>
                {(() => {
                  const todayNW = accounts.reduce((s, a) => s + a.balance, 0)
                  const projectedNW = accounts.reduce((s, a) => s + (finalBalances[a.id] ?? a.balance), 0)
                  const diff = projectedNW - todayNW
                  return (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 mb-4">
                      <p className="text-xs text-indigo-400 font-semibold uppercase tracking-wider mb-1">Projected Net Worth</p>
                      <p className={`text-lg font-bold tabular-nums ${projectedNW < 0 ? 'text-red-500' : 'text-indigo-700'}`}>
                        {projectedNW < 0 ? '-' : ''}{fmt(Math.abs(projectedNW))}
                      </p>
                      {diff !== 0 && (
                        <p className={`text-xs mt-0.5 font-medium ${diff >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {fmtSigned(diff)} from today
                        </p>
                      )}
                      <p className="text-xs text-indigo-300 mt-1">Today: {todayNW < -0.005 ? '-' : ''}{fmt(Math.abs(todayNW))}</p>
                    </div>
                  )
                })()}
                {(() => {
                  const TYPE_ORDER = ['checking', 'savings', 'cash', 'investment', 'credit', 'loan']
                  const displayAccounts = affectedAccountIds.length === 0
                    ? accounts
                    : accounts.filter(a => affectedAccountIds.includes(a.id) || finalBalances[a.id] !== undefined)
                  const grouped = TYPE_ORDER
                    .map(type => ({ type, items: displayAccounts.filter(a => a.type === type) }))
                    .filter(g => g.items.length > 0)
                  return (
                    <div className="space-y-4">
                      {grouped.map(({ type, items }) => (
                        <div key={type}>
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{ACCOUNT_LABELS[type] ?? type}</p>
                          <div className="space-y-2">
                            {items.map(a => {
                              const final = finalBalances[a.id] ?? a.balance
                              const diff = final - a.balance
                              const Icon = ACCOUNT_ICONS[a.type] ?? Wallet
                              return (
                                <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-3">
                                  <div className="flex items-center gap-2 mb-1">
                                    <Icon className="w-3.5 h-3.5 text-slate-400" />
                                    <p className="text-xs text-slate-500 truncate flex-1">{a.name}</p>
                                  </div>
                                  <p className={`text-sm font-semibold tabular-nums ${final < -0.005 ? 'text-red-500' : 'text-slate-800'}`}>
                                    {final < -0.005 ? '-' : ''}{fmt(Math.abs(final))}
                                  </p>
                                  {diff !== 0 && (
                                    <p className={`text-xs mt-0.5 ${diff > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                      {fmtSigned(diff)} from today
                                    </p>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </>
            )}
          </div>
        </div>
      </div>

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
  const amountRef = useRef<HTMLInputElement>(null)
  useEffect(() => { amountRef.current?.focus({ preventScroll: true }) }, [])

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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 animate-scale-in" onClick={e => e.stopPropagation()}>
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
                  ref={amountRef}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
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
    <div className="p-4 md:p-6 lg:p-8 md:pr-80 lg:pr-80 max-w-6xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-slate-800">Planning</h2>
        <p className="text-sm text-slate-500 mt-1">Forecast your cash flow and plan your debt payoff strategy.</p>
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


