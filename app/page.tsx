'use client'

import { useEffect, useState, useCallback } from 'react'
import { TrendingUp, TrendingDown, DollarSign, ChevronLeft, ChevronRight, Landmark } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  ComposedChart, Line, CartesianGrid,
  AreaChart, Area, ReferenceLine,
} from 'recharts'

interface Transaction {
  id: string
  type: 'income' | 'expense' | 'transfer'
  amount: number
  description: string
  category_id: number | null
  category_name: string | null
  category_color: string | null
  account_id: string | null
  to_account_id: string | null
  date: string
}

interface Account {
  id: string
  name: string
  type: string
  balance: number
  opening_balance: number
}

interface Category {
  id: number
  name: string
  type: string
  color: string
  monthly_budget: number | null
}

function toMonthString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMonth(s: string) {
  const [y, m] = s.split('-')
  return new Date(parseInt(y), parseInt(m) - 1).toLocaleString('default', { month: 'long', year: 'numeric' })
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function shortMonth(s: string): string {
  const [y, m] = s.split('-')
  return new Date(Number.parseInt(y, 10), Number.parseInt(m, 10) - 1).toLocaleString('default', { month: 'short' })
}

function fmtK(v: number): string {
  const abs = Math.abs(v)
  const prefix = v < 0 ? '-$' : '$'
  return abs >= 1000 ? `${prefix}${(abs / 1000).toFixed(0)}k` : `${prefix}${Math.round(abs)}`
}

export default function DashboardPage() {
  const [month, setMonth] = useState(toMonthString(new Date()))
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [trendData, setTrendData] = useState<Array<{ month: string; label: string; income: number; expenses: number; savings: number; rate: number }>>([])
  const [prevCatMap, setPrevCatMap] = useState<Record<string, { name: string; value: number; color: string }>>({})

  const load = useCallback(async (m: string) => {
    setLoading(true)
    const [txRes, acRes, catRes] = await Promise.all([
      fetch(`/api/transactions?month=${m}`),
      fetch('/api/accounts'),
      fetch('/api/categories'),
    ])
    if (txRes.ok) setTransactions(await txRes.json())
    if (acRes.ok) setAccounts(await acRes.json())
    if (catRes.ok) setCategories(await catRes.json())
    setLoading(false)
  }, [])

  const loadTrend = useCallback(async (currentMonth: string) => {
    const months: string[] = []
    for (let i = 5; i >= 0; i--) {
      const [y, m] = currentMonth.split('-').map(Number)
      months.push(toMonthString(new Date(y, m - 1 - i, 1)))
    }
    const results = await Promise.all(
      months.map(mo =>
        fetch(`/api/transactions?month=${mo}`).then(r =>
          r.ok ? (r.json() as Promise<Transaction[]>) : Promise.resolve([] as Transaction[])
        )
      )
    )
    const trend = results.map((txs, i) => {
      const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      const sav = inc - exp
      const rate = inc > 0 ? Math.round((sav / inc) * 100) : 0
      return { month: months[i], label: shortMonth(months[i]), income: inc, expenses: exp, savings: sav, rate }
    })
    setTrendData(trend)
    // prev month = results[4] (5th of 6 = one month before current)
    const prevTxs = results[4]
    const prevMap: Record<string, { name: string; value: number; color: string }> = {}
    for (const t of prevTxs) {
      if (t.type !== 'expense') continue
      const key = String(t.category_id ?? 'uncategorized')
      if (!prevMap[key]) prevMap[key] = { name: t.category_name ?? 'Uncategorized', value: 0, color: t.category_color ?? '#94a3b8' }
      prevMap[key].value += t.amount
    }
    setPrevCatMap(prevMap)
  }, [])

  useEffect(() => { load(month) }, [month, load])
  useEffect(() => { loadTrend(month) }, [month, loadTrend])

  const prevMonth = () => {
    const [y, m] = month.split('-').map(Number)
    setMonth(toMonthString(new Date(y, m - 2, 1)))
  }
  const nextMonth = () => {
    const [y, m] = month.split('-').map(Number)
    setMonth(toMonthString(new Date(y, m, 1)))
  }

  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const net = income - expenses
  const netWorth = accounts.reduce((s, a) => s + a.balance, 0)
  const hasAccounts = accounts.length > 0

  // Debt account IDs (credit + loan)
  const debtAccountIds = new Set(accounts.filter(a => a.type === 'credit' || a.type === 'loan').map(a => a.id))

  // Transfers going TO a debt account = debt payments
  const debtPayments = transactions
    .filter(t => t.type === 'transfer' && t.to_account_id && debtAccountIds.has(t.to_account_id))
    .reduce((s, t) => s + t.amount, 0)

  // Per-account debt payment breakdown
  const debtPaymentByAccount = accounts
    .filter(a => debtAccountIds.has(a.id))
    .map(a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      paid: transactions
        .filter(t => t.type === 'transfer' && t.to_account_id === a.id)
        .reduce((s, t) => s + t.amount, 0),
    }))
    .filter(a => a.paid > 0)

  // Asset vs. debt breakdown (for donut chart)
  const totalAssetVal = accounts
    .filter(a => a.type !== 'credit' && a.type !== 'loan')
    .reduce((s, a) => s + Math.max(a.balance, 0), 0)
  const totalDebtVal = accounts
    .filter(a => (a.type === 'credit' || a.type === 'loan') && a.balance < 0)
    .reduce((s, a) => s + Math.abs(a.balance), 0)
  const assetVsDebtData = [
    ...(totalAssetVal > 0 ? [{ name: 'Assets', value: totalAssetVal, color: '#22c55e' }] : []),
    ...(totalDebtVal > 0 ? [{ name: 'Debt', value: totalDebtVal, color: '#f87171' }] : []),
  ]

  // Debt payoff progress bars (per debt account)
  const debtProgress = accounts
    .filter(a => (a.type === 'credit' || a.type === 'loan') && a.opening_balance < 0)
    .map(a => {
      const originalDebt = Math.abs(a.opening_balance)
      const remaining = Math.abs(Math.min(a.balance, 0))
      const paid = Math.max(0, originalDebt - remaining)
      const pct = originalDebt > 0 ? (paid / originalDebt) * 100 : 100
      return { id: a.id, name: a.name, originalDebt, remaining, pct: Math.min(100, pct) }
    })
    .filter(a => a.originalDebt > 0)

  // Category breakdown for expenses
  const expenseByCat = Object.values(
    transactions
      .filter(t => t.type === 'expense')
      .reduce<Record<string, { key: string; name: string; value: number; color: string }>>((acc, t) => {
        const key = String(t.category_id ?? 'uncategorized')
        const name = t.category_name ?? 'Uncategorized'
        const color = t.category_color ?? '#94a3b8'
        if (!acc[key]) acc[key] = { key, name, value: 0, color }
        acc[key].value += t.amount
        return acc
      }, {})
  ).sort((a, b) => b.value - a.value)

  // Category vs. prior month comparison (top 5 categories)
  const catComparisonData = expenseByCat.slice(0, 5).map(cat => ({
    name: cat.name.length > 12 ? `${cat.name.slice(0, 11)}\u2026` : cat.name,
    current: cat.value,
    prior: prevCatMap[cat.key]?.value ?? 0,
  }))
  const hasCatComparison =
    catComparisonData.some(c => c.prior > 0) &&
    catComparisonData.some(c => c.current > 0)

  // Net worth trajectory (approximate — backtrack from current net worth using monthly savings)
  const netWorthTrend = trendData.map((d, i) => {
    const futureSavings = trendData.slice(i + 1).reduce((s, m) => s + m.savings, 0)
    return { label: d.label, month: d.month, netWorth: netWorth - futureSavings }
  })

  // Spending by day of week (for current month)
  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dowSpending = DOW_LABELS.map((name, i) => ({
    name,
    amount: transactions
      .filter(t => {
        if (t.type !== 'expense') return false
        const [y, m, d] = t.date.split('-').map(Number)
        return new Date(y, m - 1, d).getDay() === i
      })
      .reduce((s, t) => s + t.amount, 0),
  }))

  // Income by category
  const incomeByCat = Object.values(
    transactions
      .filter(t => t.type === 'income')
      .reduce<Record<string, { name: string; value: number; color: string }>>((acc, t) => {
        const key = String(t.category_id ?? 'income')
        if (!acc[key]) acc[key] = { name: t.category_name ?? 'Income', value: 0, color: t.category_color ?? '#22c55e' }
        acc[key].value += t.amount
        return acc
      }, {})
  ).sort((a, b) => b.value - a.value)

  // Daily totals for bar chart
  const dailyMap: Record<string, { income: number; expense: number }> = {}
  for (const t of transactions) {
    if (t.type === 'transfer') continue
    if (!dailyMap[t.date]) dailyMap[t.date] = { income: 0, expense: 0 }
    if (t.type === 'income') dailyMap[t.date].income += t.amount
    else if (t.type === 'expense') dailyMap[t.date].expense += t.amount
  }
  const dailyData = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date: date.slice(5), ...vals }))

  const cards = [
    { label: 'Income', value: fmt(income), color: 'text-green-600', icon: TrendingUp, bg: 'bg-green-50' },
    { label: 'Expenses', value: fmt(expenses), color: 'text-red-500', icon: TrendingDown, bg: 'bg-red-50' },
    { label: 'Net This Month', value: fmt(net), color: net >= 0 ? 'text-green-600' : 'text-red-500', icon: DollarSign, bg: 'bg-slate-50' },
    ...(hasAccounts ? [{ label: 'Net Worth', value: fmt(netWorth), color: netWorth >= 0 ? 'text-green-600' : 'text-red-500', icon: Landmark, bg: 'bg-indigo-50' }] : []),
  ]

  // Budget progress: categories with monthly_budget vs actual spending
  const budgetRows = categories
    .filter(c => c.type === 'expense' && c.monthly_budget != null && c.monthly_budget > 0)
    .map(c => {
      const spent = expenseByCat.find(e => e.name === c.name)?.value ?? 0
      const pct = Math.min((spent / c.monthly_budget!) * 100, 200)
      const over = spent > c.monthly_budget!
      return { id: c.id, name: c.name, color: c.color, budget: c.monthly_budget!, spent, pct, over }
    })
    .sort((a, b) => b.pct - a.pct)

  const overBudgetCats = budgetRows.filter(b => b.over)

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header + month nav */}
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-semibold text-slate-800">Dashboard</h2>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors">
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <span className="text-sm font-medium text-slate-700 w-40 text-center">{formatMonth(month)}</span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors">
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : (
        <>
          {/* Over-budget alert */}
          {overBudgetCats.length > 0 && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <span className="text-red-500 text-lg leading-none mt-0.5">⚠</span>
              <div>
                <p className="text-sm font-medium text-red-700">
                  {overBudgetCats.length === 1
                    ? `${overBudgetCats[0].name} is over budget`
                    : `${overBudgetCats.length} categories are over budget`}
                </p>
                <p className="text-xs text-red-500 mt-0.5">
                  {overBudgetCats.map(c => `${c.name} (${fmt(c.spent)} / ${fmt(c.budget)})`).join(' · ')}
                </p>
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className={`grid gap-4 mb-8 ${hasAccounts ? 'grid-cols-4' : 'grid-cols-3'}`}>
            {cards.map(({ label, value, color, icon: Icon, bg }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-slate-500">{label}</span>
                  <div className={`${bg} rounded-lg p-2`}>
                    <Icon className={`w-4 h-4 ${color}`} />
                  </div>
                </div>
                <p className={`text-2xl font-semibold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Net Worth Trajectory */}
          {netWorthTrend.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-slate-700">Net Worth Trajectory</h3>
                <span className={`text-sm font-semibold tabular-nums ${
                  netWorth >= 0 ? 'text-green-600' : 'text-red-500'
                }`}>{netWorth < 0 ? '-' : ''}{fmt(Math.abs(netWorth))}</span>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={netWorthTrend} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
                  <Tooltip formatter={(v: number) => [fmt(v), 'Net Worth']} />
                  <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.5} />
                  <Area
                    type="monotone"
                    dataKey="netWorth"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#nwGrad)"
                    dot={{ r: 3, fill: '#6366f1' }}
                    name="Net Worth"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-2 gap-6 mb-8">
            {/* Daily bar chart */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-medium text-slate-700 mb-4">Daily Activity</h3>
              {dailyData.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dailyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Bar dataKey="income" fill="#22c55e" radius={[3, 3, 0, 0]} name="Income" />
                    <Bar dataKey="expense" fill="#ef4444" radius={[3, 3, 0, 0]} name="Expense" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Expense breakdown donut */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-medium text-slate-700 mb-4">Expense Breakdown</h3>
              {expenseByCat.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No expenses</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={expenseByCat}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                    >
                      {expenseByCat.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* 6-Month Trend + Monthly Savings Rate */}
          <div className="grid grid-cols-2 gap-6 mb-8">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-medium text-slate-700 mb-4">6-Month Trend</h3>
              {trendData.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={trendData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Bar dataKey="income" fill="#bbf7d0" name="Income" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="expenses" fill="#fecaca" name="Expenses" radius={[3, 3, 0, 0]} />
                    <Line type="monotone" dataKey="savings" stroke="#6366f1" strokeWidth={2} dot={false} name="Net" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-medium text-slate-700 mb-4">Monthly Savings Rate</h3>
              {trendData.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={trendData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip formatter={(v: number) => `${v}%`} />
                    <Bar dataKey="rate" name="Savings Rate" radius={[3, 3, 0, 0]}>
                      {trendData.map((entry) => (
                        <Cell key={entry.month} fill={entry.rate >= 0 ? '#22c55e' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Monthly Budgets */}
          {budgetRows.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
              <h3 className="text-sm font-medium text-slate-700 mb-4">Monthly Budgets</h3>
              <div className="space-y-3">
                {budgetRows.map(b => {
                  const barColor = b.over ? '#ef4444' : b.pct >= 80 ? '#f97316' : '#22c55e'
                  return (
                    <div key={b.id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-slate-600 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                          {b.name}
                          {b.over && <span className="text-xs text-red-500 font-medium">over budget!</span>}
                        </span>
                        <span className="text-xs tabular-nums text-slate-500">
                          {fmt(b.spent)} / {fmt(b.budget)}
                        </span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${Math.min(b.pct, 100)}%`, backgroundColor: barColor }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Top expense categories */}
          {expenseByCat.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
              <h3 className="text-sm font-medium text-slate-700 mb-4">Top Categories</h3>
              <div className="space-y-3">
                {expenseByCat.slice(0, 6).map(cat => {
                  const pct = expenses > 0 ? (cat.value / expenses) * 100 : 0
                  return (
                    <div key={cat.name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-slate-600">{cat.name}</span>
                        <span className="text-sm font-medium text-slate-800">{fmt(cat.value)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: cat.color }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Category vs. Prior Month */}
          {hasCatComparison && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
              <h3 className="text-sm font-medium text-slate-700 mb-4">Category vs. Prior Month</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={catComparisonData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtK} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="current" fill="#6366f1" name="This Month" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="prior" fill="#cbd5e1" name="Prior Month" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Day-of-Week Spending + Income Sources */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-medium text-slate-700 mb-4">Spending by Day of Week</h3>
              {dowSpending.every(d => d.amount === 0) ? (
                <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No expenses this month</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={dowSpending} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${Math.round(v)}`} />
                    <Tooltip formatter={(v: number) => [fmt(v), 'Spent']} />
                    <Bar dataKey="amount" name="Spent" radius={[3, 3, 0, 0]}>
                      {dowSpending.map((entry) => {
                        const max = Math.max(...dowSpending.map(d => d.amount))
                        return <Cell key={entry.name} fill={entry.amount === max && max > 0 ? '#f97316' : '#cbd5e1'} />
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-medium text-slate-700 mb-4">Income Sources</h3>
              {incomeByCat.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No income this month</div>
              ) : incomeByCat.length === 1 ? (
                <div className="h-48 flex flex-col items-center justify-center gap-1">
                  <p className="text-xs text-slate-400">{incomeByCat[0].name}</p>
                  <p className="text-2xl font-semibold text-green-600">{fmt(incomeByCat[0].value)}</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={incomeByCat}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={72}
                    >
                      {incomeByCat.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Assets vs. Debt + Debt Payoff Progress */}
          {(assetVsDebtData.length > 1 || debtProgress.length > 0) && (
            <div className={`grid gap-6 mb-6 ${assetVsDebtData.length > 1 && debtProgress.length > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {assetVsDebtData.length > 1 && (
                <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col">
                  <h3 className="text-sm font-medium text-slate-700 mb-2">Assets vs. Debt</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={assetVsDebtData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                      >
                        {assetVsDebtData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmt(v)} />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 11, lineHeight: '1.8' }} />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Summary stats */}
                  <div className="mt-4 space-y-2.5 flex-1">
                    <div className="flex items-center justify-between py-2 border-t border-slate-100">
                      <span className="text-xs text-slate-500">Total Assets</span>
                      <span className="text-sm font-semibold text-green-600">{fmt(totalAssetVal)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-t border-slate-100">
                      <span className="text-xs text-slate-500">Total Debt</span>
                      <span className="text-sm font-semibold text-red-500">{fmt(totalDebtVal)}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-t border-slate-100">
                      <span className="text-xs text-slate-500">Net Worth</span>
                      <span className={`text-sm font-semibold ${(totalAssetVal - totalDebtVal) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {fmt(totalAssetVal - totalDebtVal)}
                      </span>
                    </div>
                    {totalAssetVal > 0 && (
                      <div className="flex items-center justify-between py-2 border-t border-slate-100">
                        <span className="text-xs text-slate-500">Debt-to-Asset Ratio</span>
                        <span className={`text-sm font-semibold ${totalDebtVal / totalAssetVal > 1 ? 'text-red-500' : totalDebtVal / totalAssetVal > 0.5 ? 'text-orange-500' : 'text-green-600'}`}>
                          {(totalDebtVal / totalAssetVal * 100).toFixed(0)}%
                        </span>
                      </div>
                    )}
                    {/* Per-account asset list */}
                    <div className="pt-2 border-t border-slate-100">
                      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Account Breakdown</p>
                      <div className="space-y-1.5">
                        {accounts.map(a => (
                          <div key={a.id} className="flex items-center justify-between">
                            <span className="text-xs text-slate-500 truncate max-w-[60%]">{a.name}</span>
                            <span className={`text-xs font-medium tabular-nums ${a.balance < 0 ? 'text-red-400' : 'text-slate-700'}`}>
                              {fmt(a.balance)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {debtProgress.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-sm font-medium text-slate-700 mb-4">Debt Payoff Progress</h3>
                  <div className="space-y-4 mt-2">
                    {debtProgress.map(d => (
                      <div key={d.id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-slate-600 truncate max-w-[55%]">{d.name}</span>
                          <span className="text-xs text-slate-500 tabular-nums">{fmt(d.remaining)} left</span>
                        </div>
                        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${d.pct}%`,
                              backgroundColor: d.pct >= 100 ? '#22c55e' : '#f97316',
                            }}
                          />
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-xs text-slate-400">{Math.round(d.pct)}% paid off</span>
                          <span className="text-xs text-slate-400">{fmt(d.originalDebt)} original</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Debt payments breakdown */}
          {debtPaymentByAccount.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-slate-700">Debt Payments This Month</h3>
                <span className="text-sm font-semibold text-orange-600">{fmt(debtPayments)} total</span>
              </div>
              <ResponsiveContainer width="100%" height={Math.max(80, debtPaymentByAccount.length * 48)}>
                <BarChart
                  data={debtPaymentByAccount.map(a => ({ name: a.name, amount: a.paid }))}
                  layout="vertical"
                  margin={{ top: 0, right: 60, left: 0, bottom: 0 }}
                >
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="amount" fill="#fb923c" radius={[0, 3, 3, 0]} name="Paid" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  )
}
