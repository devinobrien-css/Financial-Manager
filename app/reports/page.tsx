'use client'

import { useEffect, useState, useCallback } from 'react'
import { Download } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'

interface Transaction {
  id: string
  type: 'income' | 'expense' | 'transfer'
  amount: number
  description: string
  memo: string | null
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

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function toMonthString(y: number, m: number) {
  return `${y}-${String(m).padStart(2, '0')}`
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function ReportsPage() {
  const { lock } = useAuth()
  const [year, setYear] = useState(new Date().getFullYear())
  const [monthlyData, setMonthlyData] = useState<Array<{
    month: string; label: string; income: number; expenses: number; savings: number; debtPaid: number
  }>>([])
  const [allTx, setAllTx] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)

  const loadYear = useCallback(async (y: number) => {
    setLoading(true)
    const months = Array.from({ length: 12 }, (_, i) => toMonthString(y, i + 1))
    const acRes = await fetch('/api/accounts')
    if (acRes.status === 401) { lock(); setLoading(false); return }
    const accounts = acRes.ok ? (await acRes.json()) as Account[] : []
    const savingsPoolIds = new Set(
      accounts.filter(a => a.type === 'checking' || a.type === 'savings' || a.type === 'investment').map(a => a.id),
    )
    const debtAcctIds = new Set(accounts.filter(a => a.type === 'credit' || a.type === 'loan').map(a => a.id))

    const results = await Promise.all(
      months.map(m =>
        fetch(`/api/transactions?month=${m}`).then(r => {
          if (r.status === 401) { lock(); return [] as Transaction[] }
          return r.ok ? (r.json() as Promise<Transaction[]>) : ([] as Transaction[])
        })
      )
    )
    const monthly = results.map((txs, i) => {
      const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const expenses = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      // Outflow from savings pool (checking/savings/investment) to credit or loan = debt paydown.
      const debtPaid = txs
        .filter(t => t.type === 'transfer'
          && t.account_id && savingsPoolIds.has(t.account_id)
          && t.to_account_id && debtAcctIds.has(t.to_account_id))
        .reduce((s, t) => s + t.amount, 0)
      // "Saved" = money that ended up in (or stayed in) the savings pool.
      const savings = income - expenses - debtPaid
      return { month: months[i], label: SHORT_MONTHS[i], income, expenses, savings, debtPaid }
    })
    setMonthlyData(monthly)
    setAllTx(results.flat())
    setLoading(false)
  }, [lock])

  useEffect(() => { loadYear(year) }, [year, loadYear])

  const annualIncome = monthlyData.reduce((s, m) => s + m.income, 0)
  const annualExpenses = monthlyData.reduce((s, m) => s + m.expenses, 0)
  const annualDebtPaid = monthlyData.reduce((s, m) => s + m.debtPaid, 0)
  const annualNet = annualIncome - annualExpenses - annualDebtPaid
  const avgMonthlySavings = annualNet / 12

  const bestMonth = monthlyData
    .filter(m => m.savings > 0)
    .reduce<(typeof monthlyData[0]) | null>((best, m) =>
      m.savings > (best?.savings ?? -Infinity) ? m : best, null)
  const worstMonth = monthlyData
    .filter(m => m.expenses > 0)
    .reduce<(typeof monthlyData[0]) | null>((worst, m) =>
      m.expenses > (worst?.expenses ?? -Infinity) ? m : worst, null)

  // Category breakdown for the full year
  const catTotals = Object.values(
    allTx.filter(t => t.type === 'expense').reduce<Record<string, { name: string; value: number; color: string }>>((acc, t) => {
      const key = t.category_name ?? 'Uncategorized'
      if (!acc[key]) acc[key] = { name: key, value: 0, color: t.category_color ?? '#94a3b8' }
      acc[key].value += t.amount
      return acc
    }, {})
  ).sort((a, b) => b.value - a.value)

  const totalExpForPct = catTotals.reduce((s, c) => s + c.value, 0)

  const exportCSV = () => {
    const rows = allTx
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(t => [
        t.date,
        t.type,
        t.amount.toFixed(2),
        `"${(t.description ?? '').replace(/"/g, '""')}"`,
        `"${(t.memo ?? '').replace(/"/g, '""')}"`,
        `"${(t.category_name ?? '').replace(/"/g, '""')}"`,
        `"${(t.account_name ?? '').replace(/"/g, '""')}"`,
        `"${(t.to_account_name ?? '').replace(/"/g, '""')}"`,
      ].join(','))

    const header = 'Date,Type,Amount,Description,Memo,Category,Account,To Account'
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transactions-${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-semibold text-slate-800">Reports</h2>
          <p className="text-sm text-slate-500 mt-1">Year-in-review summary and export.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg">
            <button
              onClick={() => setYear(y => y - 1)}
              className="px-3 py-2 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-l-lg transition-colors"
            >
              ‹
            </button>
            <span className="px-3 py-2 text-sm font-medium text-slate-700 min-w-16 text-center">{year}</span>
            <button
              onClick={() => setYear(y => y + 1)}
              className="px-3 py-2 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-r-lg transition-colors"
            >
              ›
            </button>
          </div>
          <button
            onClick={exportCSV}
            disabled={allTx.length === 0}
            className="flex items-center gap-2 bg-slate-800 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : (
        <>
          {/* Annual summary cards */}
          <div className="grid grid-cols-5 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs text-slate-500 mb-1">Annual Income</p>
              <p className="text-2xl font-semibold text-green-600 tabular-nums">{fmt(annualIncome)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs text-slate-500 mb-1">Annual Expenses</p>
              <p className="text-2xl font-semibold text-red-500 tabular-nums">{fmt(annualExpenses)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs text-slate-500 mb-1">Debt Paid Down</p>
              <p className="text-2xl font-semibold text-blue-600 tabular-nums">{fmt(annualDebtPaid)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs text-slate-500 mb-1">Net Saved</p>
              <p className={`text-2xl font-semibold tabular-nums ${annualNet >= 0 ? 'text-slate-800' : 'text-red-500'}`}>{fmt(annualNet)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <p className="text-xs text-slate-500 mb-1">Avg Monthly Savings</p>
              <p className={`text-2xl font-semibold tabular-nums ${avgMonthlySavings >= 0 ? 'text-slate-800' : 'text-red-500'}`}>{fmt(avgMonthlySavings)}</p>
            </div>
          </div>

          {/* Highlights */}
          {(bestMonth || worstMonth) && (
            <div className="grid grid-cols-2 gap-4 mb-8">
              {bestMonth && bestMonth.savings > 0 && (
                <div className="bg-green-50 rounded-xl border border-green-100 px-5 py-4">
                  <p className="text-xs text-green-700 font-medium uppercase tracking-wide mb-1">Best Month</p>
                  <p className="text-lg font-semibold text-green-800">{SHORT_MONTHS[parseInt(bestMonth.month.split('-')[1]) - 1]}</p>
                  <p className="text-sm text-green-600">{fmt(bestMonth.savings)} saved</p>
                </div>
              )}
              {worstMonth && (
                <div className="bg-orange-50 rounded-xl border border-orange-100 px-5 py-4">
                  <p className="text-xs text-orange-700 font-medium uppercase tracking-wide mb-1">Most Spending</p>
                  <p className="text-lg font-semibold text-orange-800">{SHORT_MONTHS[parseInt(worstMonth.month.split('-')[1]) - 1]}</p>
                  <p className="text-sm text-orange-600">{fmt(worstMonth.expenses)} expenses</p>
                </div>
              )}
            </div>
          )}

          {/* Monthly income vs expenses chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
            <h3 className="text-sm font-medium text-slate-700 mb-4">Monthly Overview — {year}</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthlyData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="income" fill="#bbf7d0" name="Income" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expenses" fill="#fecaca" name="Expenses" radius={[3, 3, 0, 0]} />
                <Bar dataKey="debtPaid" fill="#bfdbfe" name="Debt Paydown" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-slate-400 mt-2">Debt paydown = transfers from checking/savings/investment to credit or loan accounts.</p>
          </div>

          {/* Monthly net chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
            <h3 className="text-sm font-medium text-slate-700 mb-4">Monthly Savings (Income − Expenses − Debt Paydown)</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={monthlyData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : Math.round(v)}`} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="savings" name="Net" radius={[3, 3, 0, 0]}>
                  {monthlyData.map(entry => (
                    <Cell key={entry.month} fill={entry.savings >= 0 ? '#22c55e' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Annual category breakdown */}
          {catTotals.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-medium text-slate-700 mb-4">Annual Expenses by Category</h3>
              <div className="space-y-3">
                {catTotals.slice(0, 12).map(cat => {
                  const pct = totalExpForPct > 0 ? (cat.value / totalExpForPct) * 100 : 0
                  return (
                    <div key={cat.name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-slate-600 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                          {cat.name}
                        </span>
                        <span className="text-sm font-medium text-slate-700 tabular-nums">
                          {fmt(cat.value)}
                          <span className="text-xs text-slate-400 ml-1.5">({pct.toFixed(0)}%)</span>
                        </span>
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

          {allTx.length === 0 && (
            <div className="text-center text-slate-400 text-sm mt-16">
              No transactions found for {year}.
            </div>
          )}
        </>
      )}
    </div>
  )
}
