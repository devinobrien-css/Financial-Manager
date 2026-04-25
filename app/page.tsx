'use client'

import { useEffect, useState, useCallback } from 'react'
import { TrendingUp, TrendingDown, DollarSign, ChevronLeft, ChevronRight, Landmark, Activity } from 'lucide-react'
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
  credit_limit: number | null
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
  const [trendData, setTrendData] = useState<Array<{ month: string; label: string; income: number; expenses: number; debtPaid: number; savings: number; rate: number }>>([])
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
    // Savings pool = checking + savings + investment. Transfers to credit/loan are debt paydown and reduce savings.
    const acRes = await fetch('/api/accounts')
    const acList = acRes.ok ? (await acRes.json()) as Account[] : []
    const savingsPoolIds = new Set(
      acList.filter(a => a.type === 'checking' || a.type === 'savings' || a.type === 'investment').map(a => a.id),
    )
    const debtAcctIds = new Set(acList.filter(a => a.type === 'credit' || a.type === 'loan').map(a => a.id))
    const trend = results.map((txs, i) => {
      const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      // Transfers OUT of savings pool to credit/loan = debt paydown.
      const debtPaid = txs
        .filter(t => t.type === 'transfer'
          && t.account_id && savingsPoolIds.has(t.account_id)
          && t.to_account_id && debtAcctIds.has(t.to_account_id))
        .reduce((s, t) => s + t.amount, 0)
      const sav = inc - exp - debtPaid
      const rate = inc > 0 ? Math.round((sav / inc) * 100) : 0
      return { month: months[i], label: shortMonth(months[i]), income: inc, expenses: exp, debtPaid, savings: sav, rate }
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

  // Savings pool IDs (checking + savings + investment)
  const savingsPoolIds = new Set(
    accounts.filter(a => a.type === 'checking' || a.type === 'savings' || a.type === 'investment').map(a => a.id),
  )

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

  // Credit utilization per card (only cards with a set limit)
  const creditUtilization = accounts
    .filter(a => a.type === 'credit' && a.credit_limit !== null && a.credit_limit > 0)
    .map(a => {
      const used = Math.abs(Math.min(a.balance, 0))
      const pct = Math.min((used / a.credit_limit!) * 100, 100)
      const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f97316' : '#22c55e'
      return { id: a.id, name: a.name, used, limit: a.credit_limit!, pct, color }
    })
  const totalCreditUsed = creditUtilization.reduce((s, c) => s + c.used, 0)
  const totalCreditLimit = creditUtilization.reduce((s, c) => s + c.limit, 0)
  const overallUtilizationPct = totalCreditLimit > 0 ? Math.min((totalCreditUsed / totalCreditLimit) * 100, 100) : null
  const overallUtilizationColor = overallUtilizationPct === null ? '#94a3b8' : overallUtilizationPct >= 90 ? '#ef4444' : overallUtilizationPct >= 70 ? '#f97316' : '#22c55e'

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

  // Outflow breakdown = expenses by category + a debt-paydown wedge.
  // Used for the dashboard donut so debt payments are visible alongside spending.
  const outflowBreakdown = [
    ...expenseByCat.map(c => ({ name: c.name, value: c.value, color: c.color })),
    ...(debtPayments > 0 ? [{ name: 'Debt Paydown', value: debtPayments, color: '#3b82f6' }] : []),
  ]

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
  const dailyMap: Record<string, { income: number; expense: number; debtPaid: number }> = {}
  for (const t of transactions) {
    if (!dailyMap[t.date]) dailyMap[t.date] = { income: 0, expense: 0, debtPaid: 0 }
    if (t.type === 'income') dailyMap[t.date].income += t.amount
    else if (t.type === 'expense') dailyMap[t.date].expense += t.amount
    else if (
      t.type === 'transfer'
      && t.account_id && savingsPoolIds.has(t.account_id)
      && t.to_account_id && debtAccountIds.has(t.to_account_id)
    ) {
      dailyMap[t.date].debtPaid += t.amount
    }
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

  // Savings rate — money kept in or moved to checking/savings/investment.
  // Transfers OUT of that pool to credit/loan are debt paydown, not savings.
  const savingsOutflow = transactions
    .filter(t => t.type === 'transfer'
      && t.account_id && savingsPoolIds.has(t.account_id)
      && (!t.to_account_id || !savingsPoolIds.has(t.to_account_id)))
    .reduce((s, t) => s + t.amount, 0)
  const trueSavings = net - savingsOutflow
  const savingsRate = income > 0 ? Math.round((trueSavings / income) * 100) : 0

  // Debt paydown rate — % of income that went to paying down credit/loan balances.
  const debtPaydownRate = income > 0 ? Math.round((debtPayments / income) * 100) : 0

  // Spending velocity (projection to end of month — only for current month)
  const isCurrentMonth = toMonthString(new Date()) === month
  const [yearNum, monthNum] = month.split('-').map(Number)
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate()
  const daysElapsed = isCurrentMonth ? new Date().getDate() : daysInMonth
  const projectedMonthSpend = isCurrentMonth && daysElapsed > 0 && daysElapsed < daysInMonth
    ? (expenses / daysElapsed) * daysInMonth
    : null

  // Unusual spending: expenses notably above the category's per-transaction average
  const catTxCounts: Record<string, number> = {}
  for (const t of transactions) {
    if (t.type !== 'expense') continue
    const key = t.category_name ?? 'Uncategorized'
    catTxCounts[key] = (catTxCounts[key] ?? 0) + 1
  }
  const catAvgMap: Record<string, number> = {}
  for (const cat of expenseByCat) {
    const count = catTxCounts[cat.name] ?? 1
    catAvgMap[cat.name] = cat.value / count
  }
  const unusualTransactions = transactions
    .filter(t => t.type === 'expense' && t.amount >= 25)
    .filter(t => {
      const count = catTxCounts[t.category_name ?? ''] ?? 0
      if (count < 2) return false
      const avg = catAvgMap[t.category_name ?? ''] ?? t.amount
      return t.amount >= avg * 1.8
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3)

  // Monthly financial health score (0–100)
  const savingsScore = income > 0
    ? (savingsRate >= 20 ? 100 : savingsRate >= 10 ? 75 : savingsRate >= 0 ? 50 : 25)
    : 50
  const utilizationAvgScore = creditUtilization.length === 0 ? 100
    : Math.round(creditUtilization.reduce((s, c) => s + (c.pct < 10 ? 100 : c.pct < 30 ? 80 : c.pct < 70 ? 50 : 20), 0) / creditUtilization.length)
  const budgetAdherenceScore = budgetRows.length === 0 ? 100
    : Math.round((budgetRows.filter(b => !b.over).length / budgetRows.length) * 100)
  const healthScore = Math.round(savingsScore * 0.4 + utilizationAvgScore * 0.3 + budgetAdherenceScore * 0.3)
  const healthScoreColor = healthScore >= 80 ? 'text-green-600' : healthScore >= 60 ? 'text-yellow-600' : 'text-red-500'
  const healthScoreLabel = healthScore >= 80 ? 'Excellent' : healthScore >= 60 ? 'Good' : healthScore >= 40 ? 'Fair' : 'Needs Attention'

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
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
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

          {/* Credit utilization alert */}
          {overallUtilizationPct !== null && overallUtilizationPct >= 30 && (
            <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <span className="text-orange-500 text-lg leading-none mt-0.5">⚠</span>
              <div>
                <p className="text-sm font-medium text-orange-700">Credit utilization is above 30%</p>
                <p className="text-xs text-orange-500 mt-0.5">
                  Overall: {overallUtilizationPct.toFixed(0)}% ·{' '}
                  {creditUtilization.filter(c => c.pct >= 30).map(c => `${c.name}: ${c.pct.toFixed(0)}%`).join(' · ')}
                </p>
              </div>
            </div>
          )}

          {/* Unusual spending alert */}
          {unusualTransactions.length > 0 && (
            <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-start gap-3">
              <span className="text-yellow-600 text-lg leading-none mt-0.5">💡</span>
              <div>
                <p className="text-sm font-medium text-yellow-700">Unusual spending detected this month</p>
                <p className="text-xs text-yellow-600 mt-0.5">
                  {unusualTransactions.map(t => `${t.description}: ${fmt(t.amount)}`).join(' · ')}
                </p>
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className={`grid gap-4 mb-4 ${hasAccounts ? 'grid-cols-4' : 'grid-cols-3'}`}>
            {cards.map(({ label, value, color, icon: Icon, bg }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-slate-500">{label}</span>
                  <div className={`${bg} rounded-lg p-2`}>
                    <Icon className={`w-4 h-4 ${color}`} />
                  </div>
                </div>
                <p className={`text-2xl font-semibold ${color}`}>{value}</p>
                {label === 'Net This Month' && income > 0 && (
                  <p className={`text-xs mt-1 ${savingsRate >= 20 ? 'text-green-500' : savingsRate >= 0 ? 'text-yellow-500' : 'text-red-400'}`}>
                    {savingsRate}% savings rate
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Financial Pulse row */}
          {(income > 0 || expenses > 0) && (
            <div className="grid grid-cols-4 gap-4 mb-8">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-xs text-slate-500">Monthly Health Score</span>
                </div>
                <p className={`text-2xl font-semibold ${healthScoreColor}`}>{healthScore}</p>
                <p className={`text-xs mt-0.5 ${healthScoreColor}`}>{healthScoreLabel}</p>
                <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${healthScore}%`, backgroundColor: healthScore >= 80 ? '#22c55e' : healthScore >= 60 ? '#eab308' : '#ef4444' }} />
                </div>
                <p className="text-xs text-slate-300 mt-1.5">Savings 40% · Utilization 30% · Budget 30%</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-xs text-slate-500">Savings Rate</span>
                </div>
                <p className={`text-2xl font-semibold ${savingsRate >= 20 ? 'text-green-600' : savingsRate >= 0 ? 'text-yellow-600' : 'text-red-500'}`}>
                  {income > 0 ? `${savingsRate}%` : 'N/A'}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {income > 0
                    ? (savingsRate >= 20 ? 'Great — above 20% goal' : savingsRate >= 0 ? 'Below 20% goal' : 'Spending more than earning')
                    : 'No income yet this month'}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingDown className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs text-slate-500">Debt Paydown Rate</span>
                </div>
                <p className={`text-2xl font-semibold ${debtPaydownRate > 0 ? 'text-blue-600' : 'text-slate-400'}`}>
                  {income > 0 ? `${debtPaydownRate}%` : 'N/A'}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {income > 0
                    ? (debtPayments > 0 ? `${fmt(debtPayments)} toward debt` : 'No debt payments this month')
                    : 'No income yet this month'}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-3.5 h-3.5 text-orange-400" />
                  <span className="text-xs text-slate-500">{isCurrentMonth ? 'Spending Velocity' : 'Period Spending'}</span>
                </div>
                {projectedMonthSpend !== null ? (
                  <>
                    <p className={`text-2xl font-semibold ${income > 0 && projectedMonthSpend > income ? 'text-red-500' : 'text-slate-700'}`}>
                      {fmt(projectedMonthSpend)}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Projected by end of month (day {daysElapsed}/{daysInMonth})
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-2xl font-semibold text-slate-700">{fmt(expenses)}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Total for this period</p>
                  </>
                )}
              </div>
            </div>
          )}

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
                    <Bar dataKey="debtPaid" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Debt Paid" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Expense breakdown donut */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-medium text-slate-700 mb-4">Money Out Breakdown</h3>
              {outflowBreakdown.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No outflows</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={outflowBreakdown}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                    >
                      {outflowBreakdown.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
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
                    <Bar dataKey="debtPaid" fill="#bfdbfe" name="Debt Paydown" radius={[3, 3, 0, 0]} />
                    <Line type="monotone" dataKey="savings" stroke="#6366f1" strokeWidth={2} dot={false} name="Saved" />
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
              {creditUtilization.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-medium text-slate-700">Credit Utilization</h3>
                    {overallUtilizationPct !== null && (
                      <span className="text-xs font-semibold" style={{ color: overallUtilizationColor }}>
                        {overallUtilizationPct.toFixed(0)}% overall
                      </span>
                    )}
                  </div>
                  {overallUtilizationPct !== null && (
                    <div className="mb-4">
                      <div className="relative h-2 w-full bg-slate-100 rounded-full mb-1">
                        <div className="h-full rounded-full transition-all" style={{ width: `${overallUtilizationPct}%`, backgroundColor: overallUtilizationColor }} />
                        {/* Recommended 30% marker */}
                        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center" style={{ left: '30%' }}>
                          <div className="w-0.5 h-4 bg-slate-400 rounded-full" />
                        </div>
                      </div>
                      <div className="relative flex justify-between text-xs text-slate-400">
                        <span>{fmt(totalCreditUsed)} used</span>
                        <span className="absolute text-slate-300" style={{ left: '30%', transform: 'translateX(-50%)' }}>30%</span>
                        <span>{fmt(totalCreditLimit)} total limit</span>
                      </div>
                    </div>
                  )}
                  <div className="space-y-3">
                    {creditUtilization.map(c => (
                      <div key={c.id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-slate-600 truncate max-w-[60%]">{c.name}</span>
                          <span className="text-xs font-medium tabular-nums" style={{ color: c.color }}>
                            {c.pct.toFixed(0)}% &nbsp;<span className="text-slate-400 font-normal">{fmt(c.used)} / {fmt(c.limit)}</span>
                          </span>
                        </div>
                        <div className="relative h-1.5 w-full bg-slate-100 rounded-full">
                          <div className="h-full rounded-full transition-all" style={{ width: `${c.pct}%`, backgroundColor: c.color }} />
                          {/* Recommended 30% marker */}
                          <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-3.5 bg-slate-400 rounded-full" style={{ left: '30%' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-300 mt-3">Recommended: keep utilization below 30%</p>
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
