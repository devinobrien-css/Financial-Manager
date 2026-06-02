'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  PieChart,
  Pie,
} from 'recharts'

interface Transaction {
  id: string
  type: 'income' | 'expense' | 'transfer'
  amount: number
  description: string
  memo: string | null
  category_id: number | null
  category_name: string | null
  category_color: string | null
  account_id: string | null
  account_name: string | null
  to_account_id: string | null
  to_account_name: string | null
  date: string
}

interface Account {
  id: string
  type: string
}

type Range = '30d' | '90d' | '365d' | 'all'
type SpendTag = 'essential' | 'discretionary'

const TAG_STORAGE_KEY = 'spending-category-tags-v1'
const WEEKDAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ESSENTIAL_KEYWORDS = [
  'rent', 'mortgage', 'utility', 'utilities', 'grocery', 'groceries', 'insurance',
  'medical', 'health', 'pharmacy', 'transport', 'gas', 'fuel', 'childcare',
  'tuition', 'internet', 'phone', 'loan', 'debt',
]

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function shortFmt(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n)
}

function getRangeStart(range: Range): Date | null {
  const now = new Date()
  if (range === 'all') return null
  const d = new Date(now)
  if (range === '30d') d.setDate(now.getDate() - 30)
  if (range === '90d') d.setDate(now.getDate() - 90)
  if (range === '365d') d.setDate(now.getDate() - 365)
  return d
}

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7)
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function monthShortLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' })
}

function dateOnly(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function daysBetweenInclusive(start: Date, end: Date) {
  const ms = Math.max(0, dateOnly(end).getTime() - dateOnly(start).getTime())
  return Math.max(1, Math.floor(ms / (1000 * 60 * 60 * 24)) + 1)
}

function defaultTagForCategory(name: string): SpendTag {
  const lower = name.toLowerCase()
  return ESSENTIAL_KEYWORDS.some(k => lower.includes(k)) ? 'essential' : 'discretionary'
}

function MonthlyTrendTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 min-w-[210px]">
      <p className="text-sm font-semibold text-slate-800">{point.tooltipLabel}</p>
      <p className="text-xs text-slate-400 mt-0.5 mb-2">Full calendar month</p>
      <div className="space-y-1 text-sm">
        <p className="text-[#f87171] font-medium">Expenses: {fmt(point.expenses)}</p>
        <p className="text-[#6366f1] font-medium">Debt Paydown: {fmt(point.debtPaydown)}</p>
        {point.other > 0 && <p className="text-[#fb923c] font-medium">Other Outflows: {fmt(point.other)}</p>}
        <p className="text-slate-700 font-semibold pt-1 border-t border-slate-100">Total Outflow: {fmt(point.spending)}</p>
      </div>
    </div>
  )
}

export default function SpendingPage() {
  const { lock } = useAuth()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<Range>('90d')
  const [categoryTags, setCategoryTags] = useState<Record<string, SpendTag>>({})
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null)
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [txRes, acRes] = await Promise.all([
      fetch('/api/transactions?all=1'),
      fetch('/api/accounts'),
    ])
    if (txRes.status === 401 || acRes.status === 401) {
      lock()
      setLoading(false)
      return
    }
    if (txRes.ok) setTransactions(await txRes.json())
    if (acRes.ok) setAccounts(await acRes.json())
    setLoading(false)
  }, [lock])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TAG_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, SpendTag>
        setCategoryTags(parsed)
      }
    } catch {
      setCategoryTags({})
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(TAG_STORAGE_KEY, JSON.stringify(categoryTags))
  }, [categoryTags])

  const debtAccountIds = useMemo(() => {
    return new Set(
      accounts
        .filter(a => a.type === 'credit' || a.type === 'loan')
        .map(a => a.id)
    )
  }, [accounts])

  const assetAccountIds = useMemo(() => {
    // Only exclude savings/investment — checking/cash could be external payees (landlord, etc.)
    return new Set(
      accounts
        .filter(a => a.type === 'savings' || a.type === 'investment')
        .map(a => a.id)
    )
  }, [accounts])

  const expenseOnlyTx = useMemo(() => {
    return transactions
      .filter(t => t.type === 'expense')
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [transactions])

  const debtPaydownTx = useMemo(() => {
    return transactions
      .filter(t => t.type === 'transfer' && t.to_account_id && debtAccountIds.has(t.to_account_id))
      .map(t => ({
        ...t,
        category_name: 'Debt Paydown',
        category_color: '#6366f1',
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [transactions, debtAccountIds])

  // Transfers that go to a non-asset, non-debt account (external payee, deleted account, etc.)
  // These are real outflows that were previously invisible.
  const otherOutflowTx = useMemo(() => {
    return transactions
      .filter(t => {
        if (t.type !== 'transfer') return false
        if (!t.to_account_id) return false
        if (debtAccountIds.has(t.to_account_id)) return false  // already in debtPaydownTx
        if (assetAccountIds.has(t.to_account_id)) return false  // true internal transfer
        return true  // external/unknown destination = real outflow
      })
      .map(t => ({
        ...t,
        category_name: t.category_name ?? 'Other Outflow',
        category_color: '#fb923c',
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [transactions, debtAccountIds, assetAccountIds])

  const allOutflowTx = useMemo(() => {
    return [...expenseOnlyTx, ...debtPaydownTx, ...otherOutflowTx].sort((a, b) => a.date.localeCompare(b.date))
  }, [expenseOnlyTx, debtPaydownTx, otherOutflowTx])

  const periods = useMemo(() => {
    if (allOutflowTx.length === 0) {
      return {
        currentStart: null as Date | null,
        currentEnd: null as Date | null,
        previousStart: null as Date | null,
        previousEnd: null as Date | null,
        days: 1,
      }
    }

    const latestDate = new Date(allOutflowTx[allOutflowTx.length - 1].date)
    const currentEnd = range === 'all' ? latestDate : new Date()
    const currentStart = getRangeStart(range) ?? new Date(allOutflowTx[0].date)
    const days = daysBetweenInclusive(currentStart, currentEnd)

    if (range === 'all') {
      return {
        currentStart,
        currentEnd,
        previousStart: null,
        previousEnd: null,
        days,
      }
    }

    const previousEnd = new Date(currentStart)
    previousEnd.setDate(previousEnd.getDate() - 1)
    const previousStart = new Date(previousEnd)
    previousStart.setDate(previousStart.getDate() - (days - 1))

    return {
      currentStart,
      currentEnd,
      previousStart,
      previousEnd,
      days,
    }
  }, [allOutflowTx, range])

  const inWindow = (dateStr: string, start: Date | null, end: Date | null) => {
    if (!start || !end) return false
    const d = new Date(dateStr)
    return d >= start && d <= end
  }

  const expenseTx = useMemo(() => {
    if (!periods.currentStart || !periods.currentEnd) return []
    return expenseOnlyTx.filter(t => inWindow(t.date, periods.currentStart, periods.currentEnd))
  }, [expenseOnlyTx, periods.currentStart, periods.currentEnd])

  const debtTxInRange = useMemo(() => {
    if (!periods.currentStart || !periods.currentEnd) return []
    return debtPaydownTx.filter(t => inWindow(t.date, periods.currentStart, periods.currentEnd))
  }, [debtPaydownTx, periods.currentStart, periods.currentEnd])

  const otherOutflowTxInRange = useMemo(() => {
    if (!periods.currentStart || !periods.currentEnd) return []
    return otherOutflowTx.filter(t => inWindow(t.date, periods.currentStart, periods.currentEnd))
  }, [otherOutflowTx, periods.currentStart, periods.currentEnd])

  const previousExpenseTx = useMemo(() => {
    if (!periods.previousStart || !periods.previousEnd) return []
    return expenseOnlyTx.filter(t => inWindow(t.date, periods.previousStart, periods.previousEnd))
  }, [expenseOnlyTx, periods.previousStart, periods.previousEnd])

  const dateWindow = useMemo(() => {
    if (expenseTx.length === 0) return { start: null as string | null, end: null as string | null, days: periods.days }
    const start = expenseTx[0].date
    const end = expenseTx[expenseTx.length - 1].date
    return { start, end, days: periods.days }
  }, [expenseTx, periods.days])

  const stats = useMemo(() => {
    const total = expenseTx.reduce((s, t) => s + t.amount, 0)
    const count = expenseTx.length
    const avgTxn = count > 0 ? total / count : 0
    const avgDay = total / Math.max(1, dateWindow.days)
    const largest = expenseTx.reduce<Transaction | null>((m, t) => (!m || t.amount > m.amount ? t : m), null)
    return { total, count, avgTxn, avgDay, largest }
  }, [expenseTx, dateWindow.days])

  const previousStats = useMemo(() => {
    const total = previousExpenseTx.reduce((s, t) => s + t.amount, 0)
    const count = previousExpenseTx.length
    const avgTxn = count > 0 ? total / count : 0
    const avgDay = total / Math.max(1, periods.days)
    return { total, count, avgTxn, avgDay }
  }, [previousExpenseTx, periods.days])

  const comparison = useMemo(() => {
    const totalDiff = stats.total - previousStats.total
    const avgDayDiff = stats.avgDay - previousStats.avgDay
    const totalPct = previousStats.total > 0 ? (totalDiff / previousStats.total) * 100 : null
    const avgDayPct = previousStats.avgDay > 0 ? (avgDayDiff / previousStats.avgDay) * 100 : null
    return { totalDiff, avgDayDiff, totalPct, avgDayPct }
  }, [stats.total, stats.avgDay, previousStats.total, previousStats.avgDay])

  const categoryData = useMemo(() => {
    const byCat = expenseTx.reduce<Record<string, { name: string; value: number; color: string }>>((acc, t) => {
      const key = t.category_name ?? 'Uncategorized'
      if (!acc[key]) acc[key] = { name: key, value: 0, color: t.category_color ?? '#94a3b8' }
      acc[key].value += t.amount
      return acc
    }, {})
    return Object.values(byCat).sort((a, b) => b.value - a.value)
  }, [expenseTx])

  const previousCategoryTotals = useMemo(() => {
    return previousExpenseTx.reduce<Record<string, number>>((acc, t) => {
      const key = t.category_name ?? 'Uncategorized'
      acc[key] = (acc[key] ?? 0) + t.amount
      return acc
    }, {})
  }, [previousExpenseTx])

  const categoryAlerts = useMemo(() => {
    if (range === 'all') return [] as Array<{ name: string; current: number; previous: number; pct: number | null }>

    const alerts = categoryData
      .map(cat => {
        const prev = previousCategoryTotals[cat.name] ?? 0
        const current = cat.value
        const diff = current - prev
        const pct = prev > 0 ? (diff / prev) * 100 : null

        const grewFromZero = prev === 0 && current >= 200
        const spiked = prev > 0 && diff >= 75 && (pct ?? 0) >= 25
        if (!grewFromZero && !spiked) return null

        return { name: cat.name, current, previous: prev, pct }
      })
      .filter((v): v is { name: string; current: number; previous: number; pct: number | null } => Boolean(v))
      .sort((a, b) => b.current - a.current)

    return alerts.slice(0, 4)
  }, [categoryData, previousCategoryTotals, range])

  const merchantData = useMemo(() => {
    const byDesc = expenseTx.reduce<Record<string, { name: string; value: number; count: number }>>((acc, t) => {
      const key = (t.description || 'Unknown').trim() || 'Unknown'
      if (!acc[key]) acc[key] = { name: key, value: 0, count: 0 }
      acc[key].value += t.amount
      acc[key].count += 1
      return acc
    }, {})
    return Object.values(byDesc)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [expenseTx])

  const weekdayData = useMemo(() => {
    const seeded = WEEKDAY_ORDER.map(d => ({ day: d, value: 0, count: 0 }))
    for (const t of expenseTx) {
      const day = new Date(t.date).getDay()
      seeded[day].value += t.amount
      seeded[day].count += 1
    }
    return seeded
  }, [expenseTx])

  const monthlyTrend = useMemo(() => {
    const monthsInRange = new Set([...expenseTx, ...debtTxInRange, ...otherOutflowTxInRange].map(t => monthKey(t.date)))

    const byMonth = [...expenseOnlyTx, ...debtPaydownTx, ...otherOutflowTx].reduce<Record<string, { expenses: number; debtPaydown: number; other: number }>>((acc, t) => {
      const k = monthKey(t.date)
      if (!monthsInRange.has(k)) return acc
      if (!acc[k]) acc[k] = { expenses: 0, debtPaydown: 0, other: 0 }
      if (t.type === 'expense') acc[k].expenses += t.amount
      else if (debtAccountIds.has(t.to_account_id ?? '')) acc[k].debtPaydown += t.amount
      else acc[k].other += t.amount
      return acc
    }, {})

    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([k, v]) => ({
        month: k,
        label: monthShortLabel(k),
        tooltipLabel: monthLabel(k),
        expenses: v.expenses,
        debtPaydown: v.debtPaydown,
        other: v.other,
        spending: v.expenses + v.debtPaydown + v.other,
      }))
  }, [expenseTx, debtTxInRange, otherOutflowTxInRange, expenseOnlyTx, debtPaydownTx, otherOutflowTx, debtAccountIds])

  const essentialSplit = useMemo(() => {
    let essential = 0
    let discretionary = 0

    for (const cat of categoryData) {
      const tag = categoryTags[cat.name] ?? defaultTagForCategory(cat.name)
      if (tag === 'essential') essential += cat.value
      else discretionary += cat.value
    }

    const total = essential + discretionary
    const essentialPct = total > 0 ? (essential / total) * 100 : 0
    const discretionaryPct = total > 0 ? (discretionary / total) * 100 : 0

    return { essential, discretionary, total, essentialPct, discretionaryPct }
  }, [categoryData, categoryTags])

  const insights = useMemo(() => {
    if (expenseTx.length === 0) return [] as string[]
    const weekend = weekdayData[0].value + weekdayData[6].value
    const weekendShare = stats.total > 0 ? (weekend / stats.total) * 100 : 0
    const topCat = categoryData[0]
    const catShare = topCat && stats.total > 0 ? (topCat.value / stats.total) * 100 : 0
    const topMerchant = merchantData[0]

    const list: string[] = []
    if (topCat) list.push(`${topCat.name} is your largest category at ${catShare.toFixed(1)}% of spending.`)
    if (topMerchant) list.push(`${topMerchant.name} is your biggest merchant at ${fmt(topMerchant.value)}.`)
    list.push(`Weekend spending is ${weekendShare.toFixed(1)}% of your total.`)
    if (comparison.totalPct !== null) {
      list.push(`Total spending is ${comparison.totalPct >= 0 ? 'up' : 'down'} ${Math.abs(comparison.totalPct).toFixed(1)}% vs previous period.`)
    }
    return list
  }, [expenseTx.length, weekdayData, stats.total, categoryData, merchantData, comparison.totalPct])

  const totalForCategoryPct = categoryData.reduce((s, c) => s + c.value, 0)

  const categoryTransactions = useMemo(() => {
    if (!selectedCategory) return [] as Transaction[]
    return expenseTx
      .filter(t => (t.category_name ?? 'Uncategorized') === selectedCategory)
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [expenseTx, selectedCategory])

  const selectedCategoryTotal = useMemo(() => {
    return categoryTransactions.reduce((sum, t) => sum + t.amount, 0)
  }, [categoryTransactions])

  const monthTransactions = useMemo(() => {
    if (!selectedMonth) return [] as Transaction[]
    return [...expenseOnlyTx, ...debtPaydownTx, ...otherOutflowTx]
      .filter(t => monthKey(t.date) === selectedMonth)
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [expenseOnlyTx, debtPaydownTx, otherOutflowTx, selectedMonth])

  const monthExpenseTransactions = useMemo(() => {
    return monthTransactions.filter(t => t.type === 'expense')
  }, [monthTransactions])

  const monthExpenseByCategory = useMemo(() => {
    const byCat = monthExpenseTransactions.reduce<Record<string, number>>((acc, t) => {
      const key = t.category_name ?? 'Uncategorized'
      acc[key] = (acc[key] ?? 0) + t.amount
      return acc
    }, {})
    return Object.entries(byCat)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [monthExpenseTransactions])

  const monthExpenseTotal = useMemo(() => {
    return monthExpenseTransactions.reduce((sum, t) => sum + t.amount, 0)
  }, [monthExpenseTransactions])

  const monthDebtPaydownTotal = useMemo(() => {
    return monthTransactions
      .filter(t => t.type === 'transfer' && t.to_account_id && debtAccountIds.has(t.to_account_id))
      .reduce((sum, t) => sum + t.amount, 0)
  }, [monthTransactions, debtAccountIds])

  const monthOtherOutflowTotal = useMemo(() => {
    return monthTransactions
      .filter(t => t.type === 'transfer' && t.to_account_id && !debtAccountIds.has(t.to_account_id))
      .reduce((sum, t) => sum + t.amount, 0)
  }, [monthTransactions, debtAccountIds])

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h2 className="text-2xl font-semibold text-slate-800">Spending Habits</h2>
          <p className="text-sm text-slate-500 mt-1">Breakdown of where, when, and how much you spend.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
            {([
              { key: '30d', label: '30D' },
              { key: '90d', label: '90D' },
              { key: '365d', label: '1Y' },
              { key: 'all', label: 'All' },
            ] as Array<{ key: Range; label: string }>).map(opt => (
              <button
                key={opt.key}
                onClick={() => setRange(opt.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  range === opt.key ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {!loading && expenseTx.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-1.5 text-xs text-slate-600 shadow-sm">
              <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
              <span>{dateWindow.start} to {dateWindow.end} ({dateWindow.days} days)</span>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400">Loading spending data...</div>
      ) : expenseTx.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-sm">
          No expense transactions found for this range.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm">
              <p className="text-xs text-slate-500 mb-1">Total Expenses</p>
              <p className="text-lg font-semibold text-red-500 tabular-nums">{fmt(stats.total)}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm">
              <p className="text-xs text-slate-500 mb-1">Transactions</p>
              <p className="text-lg font-semibold text-slate-800 tabular-nums">{stats.count}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm">
              <p className="text-xs text-slate-500 mb-1">Average / Tx</p>
              <p className="text-lg font-semibold text-slate-800 tabular-nums">{fmt(stats.avgTxn)}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm">
              <p className="text-xs text-slate-500 mb-1">Average / Day</p>
              <p className="text-lg font-semibold text-slate-800 tabular-nums">{fmt(stats.avgDay)}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-sm">
              <p className="text-xs text-slate-500 mb-1">Largest Expense</p>
              <p className="text-lg font-semibold text-slate-800 tabular-nums">{stats.largest ? fmt(stats.largest.amount) : '-'} </p>
              {stats.largest && <p className="text-xs text-slate-500 truncate mt-1">{stats.largest.description}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-3 mb-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="-mx-4 -mt-4 mb-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50/80 rounded-t-2xl">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Period Comparison</p>
              </div>
              {range === 'all' ? (
                <p className="text-sm text-slate-500">Comparison is available for 30D, 90D, and 1Y ranges.</p>
              ) : (
                <>
                  <p className={`text-lg font-semibold tabular-nums ${comparison.totalDiff <= 0 ? 'text-green-600' : 'text-orange-600'}`}>
                    {comparison.totalDiff >= 0 ? '+' : '-'}{fmt(Math.abs(comparison.totalDiff))}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    vs previous period ({comparison.totalPct === null ? 'n/a' : `${comparison.totalPct.toFixed(1)}%`})
                  </p>
                  <p className="text-xs text-slate-400 mt-2">
                    Current {fmt(stats.total)} vs Previous {fmt(previousStats.total)}
                  </p>
                </>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="-mx-4 -mt-4 mb-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50/80 rounded-t-2xl">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Essential vs Discretionary</p>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden mb-2">
                <div className="h-full bg-teal-500 rounded-full" style={{ width: `${essentialSplit.essentialPct}%` }} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-slate-600">
                <span>Essential {fmt(essentialSplit.essential)} ({essentialSplit.essentialPct.toFixed(1)}%)</span>
                <span className="sm:text-right">Discretionary {fmt(essentialSplit.discretionary)} ({essentialSplit.discretionaryPct.toFixed(1)}%)</span>
              </div>
            </div>
          </div>

          {range !== 'all' && categoryAlerts.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 mb-4 shadow-sm">
              <p className="text-sm font-semibold text-orange-700 mb-2">Spend Alerts</p>
              <div className="space-y-1.5 text-sm text-orange-800">
                {categoryAlerts.map(alert => (
                  <p key={alert.name}>
                    {alert.name}: now {fmt(alert.current)}
                    {alert.previous > 0
                      ? `, up ${alert.pct?.toFixed(1)}% from ${fmt(alert.previous)}`
                      : ', newly elevated this period'}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1fr] gap-4 mb-4 items-start">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="-mx-4 -mt-4 mb-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50/80 rounded-t-2xl">
                <h3 className="text-sm font-medium text-slate-700">Spending by Category</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Click a slice or row to view transactions</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-4 items-start">
                <div className="h-[220px] md:h-[200px] md:sticky md:top-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData.slice(0, 8)}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={48}
                        outerRadius={78}
                        paddingAngle={2}
                        onClick={(entry: { name?: string }) => {
                          if (entry?.name) setSelectedCategory(entry.name)
                        }}
                        onMouseEnter={(entry: { name?: string }) => setHoveredCategory(entry?.name ?? null)}
                        onMouseLeave={() => setHoveredCategory(null)}
                        cursor="pointer"
                      >
                        {categoryData.slice(0, 8).map(c => (
                          <Cell
                            key={c.name}
                            fill={c.color}
                            fillOpacity={!hoveredCategory || hoveredCategory === c.name ? 1 : 0.45}
                            stroke={hoveredCategory === c.name ? '#0f172a' : 'transparent'}
                            strokeWidth={hoveredCategory === c.name ? 1 : 0}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmt(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5">
                {categoryData.slice(0, 8).map(c => {
                  const tag = categoryTags[c.name] ?? defaultTagForCategory(c.name)
                  return (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setSelectedCategory(c.name)}
                      className="w-full text-left flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                        <span className="text-slate-700 font-medium leading-tight" title={c.name}>{c.name}</span>
                      </div>
                      <div className="flex items-center gap-2.5 pl-2">
                        <div className="text-right min-w-[74px]">
                          <p className="font-semibold text-slate-700 tabular-nums leading-none">{fmt(c.value)}</p>
                          <p className="text-slate-400 mt-1">
                            {totalForCategoryPct > 0 ? ((c.value / totalForCategoryPct) * 100).toFixed(1) : '0.0'}%
                          </p>
                        </div>
                        <select
                          value={tag}
                          onChange={e => {
                            e.stopPropagation()
                            const next = e.target.value as SpendTag
                            setCategoryTags(prev => ({ ...prev, [c.name]: next }))
                          }}
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 bg-white min-w-[112px]"
                        >
                          <option value="essential">Essential</option>
                          <option value="discretionary">Discretionary</option>
                        </select>
                      </div>
                    </button>
                  )
                })}
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="-mx-4 -mt-4 mb-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50/80 rounded-t-2xl">
                <h3 className="text-sm font-medium text-slate-700">Spending by Day of Week</h3>
              </div>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={weekdayData} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => shortFmt(v)} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {weekdayData.map((d, i) => <Cell key={`${d.day}-${i}`} fill={i === 0 || i === 6 ? '#f97316' : '#38bdf8'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4 mb-4 items-start">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="-mx-4 -mt-4 mb-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50/80 rounded-t-2xl">
                <h3 className="text-sm font-medium text-slate-700">Top Merchants</h3>
              </div>
              <div className="space-y-1.5">
                {merchantData.map((m, idx) => (
                  <div key={m.name} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/70">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-700 font-medium truncate">{idx + 1}. {m.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{m.count} transactions</p>
                    </div>
                    <p className="text-sm text-slate-800 font-semibold tabular-nums">{fmt(m.value)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="-mx-4 -mt-4 mb-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50/80 rounded-t-2xl">
                <h3 className="text-sm font-medium text-slate-700">Monthly Spending Trend</h3>
              </div>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart
                  data={monthlyTrend}
                  margin={{ top: 8, right: 4, left: -12, bottom: 0 }}
                  onClick={(state: any) => {
                    const month = state?.activePayload?.[0]?.payload?.month
                    if (month) setSelectedMonth(month)
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => shortFmt(v)} />
                  <Tooltip content={<MonthlyTrendTooltip />} />
                  <Bar
                    dataKey="expenses"
                    stackId="outflow"
                    name="Expenses"
                    fill="#f87171"
                    cursor="pointer"
                    onClick={(payload: any) => {
                      const month = payload?.month
                      if (month) setSelectedMonth(month)
                    }}
                    onMouseEnter={(payload: any) => setHoveredMonth(payload?.month ?? null)}
                    onMouseLeave={() => setHoveredMonth(null)}
                  >
                    {monthlyTrend.map(point => (
                      <Cell
                        key={`exp-${point.month}`}
                        fillOpacity={!hoveredMonth || hoveredMonth === point.month ? 1 : 0.45}
                      />
                    ))}
                  </Bar>
                  <Bar
                    dataKey="debtPaydown"
                    stackId="outflow"
                    name="Debt Paydown"
                    fill="#6366f1"
                    cursor="pointer"
                    onClick={(payload: any) => {
                      const month = payload?.month
                      if (month) setSelectedMonth(month)
                    }}
                    onMouseEnter={(payload: any) => setHoveredMonth(payload?.month ?? null)}
                    onMouseLeave={() => setHoveredMonth(null)}
                  >
                    {monthlyTrend.map(point => (
                      <Cell
                        key={`debt-${point.month}`}
                        fillOpacity={!hoveredMonth || hoveredMonth === point.month ? 1 : 0.45}
                      />
                    ))}
                  </Bar>
                  <Bar
                    dataKey="other"
                    stackId="outflow"
                    name="Other Outflows"
                    fill="#fb923c"
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={(payload: any) => {
                      const month = payload?.month
                      if (month) setSelectedMonth(month)
                    }}
                    onMouseEnter={(payload: any) => setHoveredMonth(payload?.month ?? null)}
                    onMouseLeave={() => setHoveredMonth(null)}
                  >
                    {monthlyTrend.map(point => (
                      <Cell
                        key={`other-${point.month}`}
                        fillOpacity={!hoveredMonth || hoveredMonth === point.month ? 1 : 0.45}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-[11px] text-slate-400">Bars reflect full calendar month totals for the months touched by the selected range. Expenses include all expense categories (incl. Uncategorized). Debt Paydown is transfers to credit/loan.</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Click a bar to open that same full month's breakdown</p>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#f87171]" />Expenses</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#6366f1]" />Debt Paydown</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#fb923c]" />Other Outflows</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 text-slate-100 rounded-2xl p-4 shadow-sm">
            <h3 className="text-sm font-semibold mb-2">Habit Insights</h3>
            <div className="space-y-1.5 text-sm text-slate-200">
              {insights.map((insight, i) => (
                <p key={i}>- {insight}</p>
              ))}
            </div>
          </div>

          {selectedCategory && (
            <div
              className="fixed inset-0 bg-black/40 z-50 p-4 flex items-center justify-center"
              onClick={() => setSelectedCategory(null)}
            >
              <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden animate-scale-in"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
                  <div>
                    <h4 className="text-lg font-semibold text-slate-800">{selectedCategory}</h4>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {categoryTransactions.length} transactions · {fmt(selectedCategoryTotal)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(null)}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="overflow-y-auto max-h-[calc(85vh-78px)] p-4 space-y-2">
                  {categoryTransactions.length === 0 ? (
                    <p className="text-sm text-slate-400">No transactions in this category for the selected range.</p>
                  ) : (
                    categoryTransactions.map(tx => (
                      <div key={tx.id} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-800 font-medium truncate">{tx.description || 'Untitled transaction'}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {tx.date}
                            {tx.account_name ? ` · ${tx.account_name}` : ''}
                            {tx.to_account_name ? ` → ${tx.to_account_name}` : ''}
                          </p>
                        </div>
                        <p className="text-sm font-semibold tabular-nums text-slate-800">{fmt(tx.amount)}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {selectedMonth && (
            <div
              className="fixed inset-0 bg-black/40 z-50 p-4 flex items-center justify-center"
              onClick={() => setSelectedMonth(null)}
            >
              <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden animate-scale-in"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
                  <div>
                    <h4 className="text-lg font-semibold text-slate-800">{monthLabel(selectedMonth)} Full Month Breakdown</h4>
                    <p className="text-sm text-slate-500 mt-0.5">
                      Expenses {fmt(monthExpenseTotal)}
                      {monthDebtPaydownTotal > 0 ? ` · Debt Paydown ${fmt(monthDebtPaydownTotal)}` : ''}
                      {monthOtherOutflowTotal > 0 ? ` · Other ${fmt(monthOtherOutflowTotal)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedMonth(null)}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="overflow-y-auto max-h-[calc(85vh-78px)] p-4 space-y-4">
                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">By Category</p>
                    {monthExpenseByCategory.length === 0 ? (
                      <p className="text-sm text-slate-400">No expense-category transactions for this month.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {monthExpenseByCategory.map(item => (
                          <div key={item.name} className="flex items-center justify-between text-sm">
                            <span className="text-slate-600">{item.name}</span>
                            <span className="text-slate-800 font-semibold tabular-nums">{fmt(item.value)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Transactions</p>
                    {monthTransactions.length === 0 ? (
                      <p className="text-sm text-slate-400">No spending transactions in this month.</p>
                    ) : (
                      <div className="space-y-2">
                        {monthTransactions.map(tx => (
                          <div key={tx.id} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm text-slate-800 font-medium truncate">{tx.description || 'Untitled transaction'}</p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {tx.date}
                                {tx.type === 'expense' ? ` · ${tx.category_name ?? 'Uncategorized'}` : tx.to_account_name ? ` → ${tx.to_account_name}` : ' · Transfer'}
                              </p>
                            </div>
                            <p className="text-sm font-semibold tabular-nums text-slate-800">{fmt(tx.amount)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
