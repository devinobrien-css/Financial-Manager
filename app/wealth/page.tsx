'use client'

import { useEffect, useState, useCallback } from 'react'
import { TrendingUp, TrendingDown, DollarSign, Flame, Trophy, Star, Target, Zap } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line, ReferenceLine,
} from 'recharts'
import { useAuth } from '@/lib/auth-context'

interface Account {
  id: string
  name: string
  type: string
  balance: number
  opening_balance: number
  credit_limit: number | null
}

interface Snapshot {
  id: string
  month: string
  amount: number
}

interface Transaction {
  type: 'income' | 'expense' | 'transfer'
  amount: number
  date: string
  account_id?: string | null
  to_account_id?: string | null
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function toMonthString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shortMonth(s: string) {
  const [y, m] = s.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleString('default', { month: 'short', year: '2-digit' })
}

function formatMonth(s: string) {
  const [y, m] = s.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleString('default', { month: 'long', year: 'numeric' })
}

// Amortization: months to pay off a debt
function monthsToPayoff(balance: number, apr: number, monthlyPayment: number): number | null {
  if (balance <= 0 || monthlyPayment <= 0) return null
  const r = apr / 100 / 12
  if (r === 0) return Math.ceil(balance / monthlyPayment)
  if (monthlyPayment <= balance * r) return null // will never pay off
  return Math.ceil(-Math.log(1 - (r * balance) / monthlyPayment) / Math.log(1 + r))
}

function totalInterest(balance: number, apr: number, monthlyPayment: number): number {
  const months = monthsToPayoff(balance, apr, monthlyPayment) ?? 0
  return Math.max(0, monthlyPayment * months - balance)
}

export default function WealthPage() {
  const { lock } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [trendData, setTrendData] = useState<Array<{ month: string; label: string; income: number; expenses: number; savings: number; rate: number }>>([])
  const [loading, setLoading] = useState(true)

  // FIRE calculator state
  const [fireMonthlyExpenses, setFireMonthlyExpenses] = useState('')
  const [firePortfolio, setFirePortfolio] = useState('')
  const [fireMonthlyContrib, setFireMonthlyContrib] = useState('')
  const [fireReturnRate, setFireReturnRate] = useState('7')

  const load = useCallback(async () => {
    setLoading(true)
    const [acRes, snapRes] = await Promise.all([
      fetch('/api/accounts'),
      fetch('/api/net-worth'),
    ])
    if (acRes.status === 401 || snapRes.status === 401) { lock(); return }
    const accs = acRes.ok ? await acRes.json() as Account[] : []
    const snaps = snapRes.ok ? await snapRes.json() as Snapshot[] : []
    setAccounts(accs)
    setSnapshots(snaps)

    // Load last 12 months of transactions for savings rate trend
    const today = new Date()
    const months: string[] = []
    for (let i = 11; i >= 0; i--) {
      months.push(toMonthString(new Date(today.getFullYear(), today.getMonth() - i, 1)))
    }
    const results = await Promise.all(
      months.map(mo =>
        fetch(`/api/transactions?month=${mo}`).then(r =>
          r.ok ? (r.json() as Promise<Transaction[]>) : Promise.resolve([] as Transaction[])
        )
      )
    )
    // Savings pool = checking + savings + investment. Transfers to credit/loan are debt paydown and reduce savings.
    const savingsPoolIds = new Set(
      accs.filter(a => a.type === 'checking' || a.type === 'savings' || a.type === 'investment').map(a => a.id),
    )
    const trend = results.map((txs, i) => {
      const inc = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const exp = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      // Transfers OUT of the savings pool to a non-pool account (credit / loan) = money no longer saved.
      const outflow = txs
        .filter(t => t.type === 'transfer'
          && t.account_id && savingsPoolIds.has(t.account_id)
          && (!t.to_account_id || !savingsPoolIds.has(t.to_account_id)))
        .reduce((s, t) => s + t.amount, 0)
      const sav = inc - exp - outflow
      const rate = inc > 0 ? Math.round((sav / inc) * 100) : 0
      return { month: months[i], label: shortMonth(months[i]), income: inc, expenses: exp, savings: sav, rate }
    })
    setTrendData(trend)

    // Auto-snapshot current month net worth
    const currentMonth = toMonthString(today)
    const currentNetWorth = accs.reduce((s: number, a: Account) => s + a.balance, 0)
    const alreadySnapped = snaps.some(s => s.month === currentMonth)
    if (!alreadySnapped && accs.length > 0) {
      const res = await fetch('/api/net-worth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: currentMonth, amount: currentNetWorth }),
      })
      if (res.ok) {
        const newSnap = await res.json() as Snapshot
        setSnapshots(prev => [...prev.filter(s => s.month !== currentMonth), newSnap].sort((a, b) => a.month.localeCompare(b.month)))
      }
    } else if (alreadySnapped) {
      // Update current month snapshot if net worth changed
      const snap = snaps.find(s => s.month === currentMonth)
      if (snap && Math.abs(snap.amount - currentNetWorth) > 0.01) {
        const res = await fetch('/api/net-worth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month: currentMonth, amount: currentNetWorth }),
        })
        if (res.ok) {
          setSnapshots(prev => prev.map(s => s.month === currentMonth ? { ...s, amount: currentNetWorth } : s))
        }
      }
    }

    setLoading(false)
  }, [lock])

  useEffect(() => { load() }, [load])

  const netWorth = accounts.reduce((s, a) => s + a.balance, 0)

  // Asset allocation by account type
  const allocationData = [
    { name: 'Checking/Cash', value: accounts.filter(a => a.type === 'checking' || a.type === 'cash').reduce((s, a) => s + Math.max(a.balance, 0), 0), color: '#3b82f6' },
    { name: 'Savings', value: accounts.filter(a => a.type === 'savings').reduce((s, a) => s + Math.max(a.balance, 0), 0), color: '#22c55e' },
    { name: 'Investments', value: accounts.filter(a => a.type === 'investment').reduce((s, a) => s + Math.max(a.balance, 0), 0), color: '#a855f7' },
    { name: 'Credit Debt', value: accounts.filter(a => a.type === 'credit' && a.balance < 0).reduce((s, a) => s + Math.abs(a.balance), 0), color: '#f87171' },
    { name: 'Loan Debt', value: accounts.filter(a => a.type === 'loan' && a.balance < 0).reduce((s, a) => s + Math.abs(a.balance), 0), color: '#f97316' },
  ].filter(d => d.value > 0)

  // Net worth history chart data: use snapshots + fill in trend months
  const nwChartData = snapshots.map(s => ({
    label: shortMonth(s.month),
    month: s.month,
    netWorth: s.amount,
  }))

  // Savings rate data
  const savingsRateData = trendData.filter(d => d.income > 0 || d.expenses > 0)
  const currentSavingsRate = savingsRateData.length > 0 ? savingsRateData[savingsRateData.length - 1].rate : 0
  const avgSavingsRate = savingsRateData.length > 0
    ? Math.round(savingsRateData.reduce((s, d) => s + d.rate, 0) / savingsRateData.length)
    : 0

  // FIRE calculation
  const fireExpenses = parseFloat(fireMonthlyExpenses) || 0
  const fireCurrentPortfolio = parseFloat(firePortfolio) || 0
  const fireContrib = parseFloat(fireMonthlyContrib) || 0
  const fireReturn = parseFloat(fireReturnRate) || 7
  const fireNumber = fireExpenses * 12 * 25
  const fireGap = Math.max(0, fireNumber - fireCurrentPortfolio)

  let fireYears: number | null = null
  if (fireGap > 0 && fireContrib > 0 && fireReturn > 0) {
    const r = fireReturn / 100 / 12
    // FV of current portfolio + FV annuity of monthly contributions = fireNumber
    // Solve numerically (simple iteration up to 50 years)
    let months = 0
    let portfolio = fireCurrentPortfolio
    while (portfolio < fireNumber && months < 600) {
      portfolio = portfolio * (1 + r) + fireContrib
      months++
    }
    fireYears = portfolio >= fireNumber ? Math.round(months / 12 * 10) / 10 : null
  } else if (fireGap === 0) {
    fireYears = 0
  }

  // Milestones
  const milestones = [
    { label: 'First $1,000 saved', icon: Star, reached: accounts.filter(a => a.type === 'savings').reduce((s, a) => s + a.balance, 0) >= 1000 },
    { label: 'Positive net worth', icon: TrendingUp, reached: netWorth > 0 },
    { label: 'Debt-free on credit cards', icon: Trophy, reached: accounts.filter(a => a.type === 'credit').every(a => a.balance >= 0) },
    { label: '$10,000 net worth', icon: Flame, reached: netWorth >= 10000 },
    { label: '$50,000 net worth', icon: Zap, reached: netWorth >= 50000 },
    { label: '$100,000 net worth', icon: Target, reached: netWorth >= 100000 },
    { label: 'First investment account', icon: TrendingUp, reached: accounts.some(a => a.type === 'investment') },
    { label: '20%+ savings rate (last month)', icon: Star, reached: currentSavingsRate >= 20 },
  ]

  if (loading) {
    return <div className="p-8 text-slate-400 text-sm">Loading…</div>
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-slate-800">Wealth Overview</h2>
        <p className="text-sm text-slate-500 mt-1">Track your net worth, savings rate, and path to financial independence.</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-500">Net Worth</span>
            <div className={`rounded-lg p-2 ${netWorth >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              {netWorth >= 0 ? <TrendingUp className="w-4 h-4 text-green-600" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
            </div>
          </div>
          <p className={`text-2xl font-semibold ${netWorth >= 0 ? 'text-green-600' : 'text-red-500'}`}>{netWorth < 0 ? '-' : ''}{fmt(Math.abs(netWorth))}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-500">Savings Rate (this month)</span>
            <div className={`rounded-lg p-2 ${currentSavingsRate >= 20 ? 'bg-green-50' : currentSavingsRate >= 0 ? 'bg-yellow-50' : 'bg-red-50'}`}>
              <DollarSign className={`w-4 h-4 ${currentSavingsRate >= 20 ? 'text-green-600' : currentSavingsRate >= 0 ? 'text-yellow-600' : 'text-red-500'}`} />
            </div>
          </div>
          <p className={`text-2xl font-semibold ${currentSavingsRate >= 20 ? 'text-green-600' : currentSavingsRate >= 0 ? 'text-yellow-600' : 'text-red-500'}`}>{currentSavingsRate}%</p>
          <p className="text-xs text-slate-400 mt-1">12-mo avg: {avgSavingsRate}%</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-500">Total Investments</span>
            <div className="rounded-lg p-2 bg-purple-50">
              <TrendingUp className="w-4 h-4 text-purple-600" />
            </div>
          </div>
          <p className="text-2xl font-semibold text-purple-600">
            {fmt(accounts.filter(a => a.type === 'investment').reduce((s, a) => s + a.balance, 0))}
          </p>
        </div>
      </div>

      {/* Net Worth History */}
      {nwChartData.length > 1 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
          <h3 className="text-sm font-medium text-slate-700 mb-4">Net Worth History</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={nwChartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)}`} />
              <Tooltip formatter={(v: number) => [fmt(v), 'Net Worth']} labelStyle={{ color: '#475569', fontSize: 12 }} contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
              <ReferenceLine y={0} stroke="#e2e8f0" strokeDasharray="4 4" />
              <Area type="monotone" dataKey="netWorth" stroke="#6366f1" strokeWidth={2} fill="url(#nwGrad)" dot={{ r: 3, fill: '#6366f1' }} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Asset Allocation */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-700 mb-4">Asset Allocation</h3>
          {allocationData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={allocationData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  dataKey="value"
                  stroke="none"
                >
                  {allocationData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: 11, color: '#475569' }}>{v}</span>} />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Add accounts to see allocation</div>
          )}
        </div>

        {/* Savings Rate Trend */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-700 mb-4">Savings Rate Trend (12 months)</h3>
          {savingsRateData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={savingsRateData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v: number) => [`${v}%`, 'Savings Rate']} labelStyle={{ color: '#475569', fontSize: 12 }} contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
                <ReferenceLine y={20} stroke="#22c55e" strokeDasharray="4 4" label={{ value: '20% goal', position: 'right', fontSize: 10, fill: '#22c55e' }} />
                <ReferenceLine y={0} stroke="#e2e8f0" />
                <Line type="monotone" dataKey="rate" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-slate-400 text-sm">No transaction data yet</div>
          )}
        </div>
      </div>

      {/* FIRE Calculator */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Flame className="w-4 h-4 text-orange-500" />
          <h3 className="text-sm font-medium text-slate-700">FIRE Calculator</h3>
          <span className="text-xs text-slate-400 ml-1">Financial Independence, Retire Early</span>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Monthly Expenses ($)</label>
              <input
                type="number"
                min="0"
                step="100"
                placeholder="e.g. 3500"
                value={fireMonthlyExpenses}
                onChange={e => setFireMonthlyExpenses(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Current Investment Portfolio ($)</label>
              <input
                type="number"
                min="0"
                step="1000"
                placeholder="e.g. 50000"
                value={firePortfolio}
                onChange={e => setFirePortfolio(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Monthly Contribution ($)</label>
              <input
                type="number"
                min="0"
                step="100"
                placeholder="e.g. 1000"
                value={fireMonthlyContrib}
                onChange={e => setFireMonthlyContrib(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Expected Annual Return (%)</label>
              <input
                type="number"
                min="0"
                max="30"
                step="0.5"
                value={fireReturnRate}
                onChange={e => setFireReturnRate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
          </div>
          <div className="flex flex-col justify-center space-y-4">
            {fireExpenses > 0 ? (
              <>
                <div className="bg-orange-50 rounded-xl p-4 border border-orange-100">
                  <p className="text-xs text-orange-500 mb-1">FIRE Number (25× rule)</p>
                  <p className="text-2xl font-semibold text-orange-600">{fmt(fireNumber)}</p>
                </div>
                <div className={`rounded-xl p-4 border ${fireGap === 0 ? 'bg-green-50 border-green-100' : 'bg-slate-50 border-slate-200'}`}>
                  <p className="text-xs text-slate-500 mb-1">Remaining Gap</p>
                  <p className={`text-xl font-semibold ${fireGap === 0 ? 'text-green-600' : 'text-slate-700'}`}>
                    {fireGap === 0 ? '🎉 You\'ve reached FIRE!' : fmt(fireGap)}
                  </p>
                </div>
                {fireYears !== null && (
                  <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                    <p className="text-xs text-indigo-500 mb-1">
                      {fireYears === 0 ? 'Status' : 'Estimated Years to FIRE'}
                    </p>
                    <p className="text-xl font-semibold text-indigo-700">
                      {fireYears === 0 ? 'Already there!' : `${fireYears} years`}
                    </p>
                  </div>
                )}
                {fireYears === null && fireContrib > 0 && (
                  <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                    <p className="text-xs text-red-500">Monthly contribution too low to reach FIRE at this return rate. Increase contributions.</p>
                  </div>
                )}
              </>
            ) : (
              <div className="text-slate-400 text-sm text-center">Enter your monthly expenses to calculate your FIRE number.</div>
            )}
          </div>
        </div>
      </div>

      {/* Milestones */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-medium text-slate-700 mb-4">Milestones</h3>
        <div className="grid grid-cols-2 gap-3">
          {milestones.map(({ label, icon: Icon, reached }) => (
            <div key={label} className={`flex items-center gap-3 p-3 rounded-lg border ${reached ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200 opacity-60'}`}>
              <div className={`rounded-lg p-1.5 ${reached ? 'bg-green-100' : 'bg-slate-200'}`}>
                <Icon className={`w-3.5 h-3.5 ${reached ? 'text-green-600' : 'text-slate-400'}`} />
              </div>
              <span className={`text-xs font-medium ${reached ? 'text-green-700' : 'text-slate-500'}`}>{label}</span>
              {reached && <span className="ml-auto text-green-500 text-xs">✓</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
