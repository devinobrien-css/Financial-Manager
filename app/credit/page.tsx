'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, CheckCircle, Circle, AlertTriangle, TrendingUp, CreditCard, ShieldCheck, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { useAuth } from '@/lib/auth-context'

interface Account {
  id: string
  name: string
  type: string
  balance: number
  apr: number | null
  credit_limit: number | null
}

interface CreditScoreEntry {
  id: string
  score: number
  date: string
  notes: string | null
}

interface PayInFullEntry {
  id: string
  account_id: string
  month: string
  paid: boolean
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function toMonthString(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMonth(s: string) {
  const [y, m] = s.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleString('default', { month: 'short', year: 'numeric' })
}

function scoreColor(s: number) {
  if (s >= 750) return 'text-green-600'
  if (s >= 700) return 'text-blue-600'
  if (s >= 650) return 'text-yellow-600'
  return 'text-red-500'
}

function scoreBand(s: number) {
  if (s >= 800) return 'Exceptional'
  if (s >= 740) return 'Very Good'
  if (s >= 670) return 'Good'
  if (s >= 580) return 'Fair'
  return 'Poor'
}

// Months to payoff via amortization
function calcPayoff(balance: number, apr: number, monthlyPayment: number): { months: number | null; interest: number } {
  if (balance <= 0 || monthlyPayment <= 0) return { months: null, interest: 0 }
  const r = apr / 100 / 12
  if (r === 0) {
    const m = Math.ceil(balance / monthlyPayment)
    return { months: m, interest: 0 }
  }
  if (monthlyPayment <= balance * r) return { months: null, interest: 0 }
  const months = Math.ceil(-Math.log(1 - (r * balance) / monthlyPayment) / Math.log(1 + r))
  const interest = Math.max(0, monthlyPayment * months - balance)
  return { months, interest }
}

export default function CreditPage() {
  const { lock } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [scores, setScores] = useState<CreditScoreEntry[]>([])
  const [payInFull, setPayInFull] = useState<PayInFullEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Add score form
  const [showScoreForm, setShowScoreForm] = useState(false)
  const [newScore, setNewScore] = useState('')
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10))
  const [newNotes, setNewNotes] = useState('')
  const [savingScore, setSavingScore] = useState(false)
  const [confirmScore, setConfirmScore] = useState<CreditScoreEntry | null>(null)
  const [deletingScore, setDeletingScore] = useState(false)

  // Pay-in-full months to show
  const today = new Date()
  const pifMonths = Array.from({ length: 6 }, (_, i) =>
    toMonthString(new Date(today.getFullYear(), today.getMonth() - i, 1))
  ).reverse()

  // What-if simulator
  const [simAccountId, setSimAccountId] = useState('')
  const [simExtraPayment, setSimExtraPayment] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [acRes, scRes] = await Promise.all([
      fetch('/api/accounts'),
      fetch('/api/credit-score'),
    ])
    if (acRes.status === 401 || scRes.status === 401) { lock(); return }
    const accs = acRes.ok ? await acRes.json() as Account[] : []
    const sc = scRes.ok ? await scRes.json() as CreditScoreEntry[] : []
    setAccounts(accs)
    setScores(sc)

    // Load pay-in-full for last 6 months
    const pifResults = await Promise.all(
      pifMonths.map(m => fetch(`/api/pay-in-full?month=${m}`).then(r => r.ok ? r.json() as Promise<PayInFullEntry[]> : Promise.resolve([] as PayInFullEntry[])))
    )
    setPayInFull(pifResults.flat())
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lock])

  useEffect(() => { load() }, [load])

  const creditAccounts = accounts.filter(a => a.type === 'credit')

  const handleAddScore = async (e: React.FormEvent) => {
    e.preventDefault()
    const score = parseInt(newScore)
    if (isNaN(score) || score < 300 || score > 850) return
    setSavingScore(true)
    const res = await fetch('/api/credit-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score, date: newDate, notes: newNotes || undefined }),
    })
    if (res.status === 401) { lock(); return }
    if (res.ok) {
      const entry = await res.json() as CreditScoreEntry
      setScores(prev => [entry, ...prev])
      setNewScore('')
      setNewNotes('')
      setShowScoreForm(false)
    }
    setSavingScore(false)
  }

  const handleDeleteScore = async (id: string) => {
    setDeletingScore(true)
    await fetch('/api/credit-score', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setScores(prev => prev.filter(s => s.id !== id))
    setDeletingScore(false)
    setConfirmScore(null)
  }

  const handleTogglePayInFull = async (accountId: string, month: string, currentPaid: boolean) => {
    const res = await fetch('/api/pay-in-full', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_id: accountId, month, paid: !currentPaid }),
    })
    if (res.status === 401) { lock(); return }
    if (res.ok) {
      const updated = await res.json() as PayInFullEntry
      setPayInFull(prev => {
        const filtered = prev.filter(p => !(p.account_id === accountId && p.month === month))
        return [...filtered, updated]
      })
    }
  }

  const getPifStatus = (accountId: string, month: string) => {
    return payInFull.find(p => p.account_id === accountId && p.month === month)?.paid ?? false
  }

  // Score chart data
  const scoreChartData = [...scores]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(s => ({ date: s.date.slice(0, 7), score: s.score, label: formatMonth(s.date.slice(0, 7)) }))

  const latestScore = scores.length > 0 ? scores[0] : null

  // Score factor checklist
  const overallUtilizationPct = (() => {
    const total = creditAccounts.filter(a => a.credit_limit && a.credit_limit > 0)
    const used = total.reduce((s, a) => s + Math.abs(Math.min(a.balance, 0)), 0)
    const limit = total.reduce((s, a) => s + (a.credit_limit ?? 0), 0)
    return limit > 0 ? (used / limit) * 100 : null
  })()

  const perCardUtilization = creditAccounts
    .filter(a => a.credit_limit && a.credit_limit > 0)
    .map(a => {
      const used = Math.abs(Math.min(a.balance, 0))
      const pct = (used / a.credit_limit!) * 100
      return { id: a.id, name: a.name, used, limit: a.credit_limit!, pct }
    })

  // Pay-in-full streak: count consecutive months paid for current month going back
  const pifStreaks = creditAccounts.map(a => {
    let streak = 0
    for (const m of [...pifMonths].reverse()) {
      if (getPifStatus(a.id, m)) streak++
      else break
    }
    return { id: a.id, name: a.name, streak }
  })

  const allCardsBelow30 = perCardUtilization.length > 0 && perCardUtilization.every(c => c.pct < 30)
  const hasPifStreak = pifStreaks.some(s => s.streak >= 3)

  const scoreChecklist = [
    { label: 'Overall utilization below 30%', ok: overallUtilizationPct !== null && overallUtilizationPct < 30, detail: overallUtilizationPct !== null ? `${overallUtilizationPct.toFixed(1)}% overall` : 'No credit limit set' },
    { label: 'All cards individually below 30%', ok: allCardsBelow30, detail: allCardsBelow30 ? 'All cards in good range' : perCardUtilization.filter(c => c.pct >= 30).map(c => `${c.name}: ${c.pct.toFixed(0)}%`).join(', ') },
    { label: 'Paid in full 3+ months in a row', ok: hasPifStreak, detail: hasPifStreak ? `Best streak: ${Math.max(...pifStreaks.map(s => s.streak))} months` : 'No 3-month streak yet' },
    { label: 'No maxed-out cards (>90% util)', ok: perCardUtilization.every(c => c.pct < 90), detail: perCardUtilization.filter(c => c.pct >= 90).map(c => c.name).join(', ') || 'All cards OK' },
    { label: 'Credit limit set on all cards', ok: creditAccounts.every(a => a.credit_limit && a.credit_limit > 0), detail: creditAccounts.filter(a => !a.credit_limit).map(a => a.name).join(', ') || 'All limits recorded' },
  ]

  // What-if simulation
  const simAccount = accounts.find(a => a.id === simAccountId)
  const simBalance = simAccount ? Math.abs(Math.min(simAccount.balance, 0)) : 0
  const simApr = simAccount?.apr ?? 0
  const minPayment = Math.max(25, simBalance * 0.02)
  const extraAmount = parseFloat(simExtraPayment) || 0
  const simWithMin = simBalance > 0 && simApr > 0 ? calcPayoff(simBalance, simApr, minPayment) : null
  const simWithExtra = simBalance > 0 && simApr > 0 ? calcPayoff(simBalance, simApr, minPayment + extraAmount) : null
  const interestSaved = (simWithMin && simWithExtra) ? Math.max(0, simWithMin.interest - simWithExtra.interest) : 0
  const monthsSaved = (simWithMin?.months && simWithExtra?.months) ? Math.max(0, simWithMin.months - simWithExtra.months) : 0

  if (loading) {
    return <div className="p-8 text-slate-400 text-sm">Loading…</div>
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-slate-800">Credit Health</h2>
        <p className="text-sm text-slate-500 mt-1">Monitor your credit score, utilization, and payment habits.</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-500">Current Score</span>
            <div className="rounded-lg p-2 bg-blue-50">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
            </div>
          </div>
          {latestScore ? (
            <>
              <p className={`text-2xl font-semibold ${scoreColor(latestScore.score)}`}>{latestScore.score}</p>
              <p className="text-xs text-slate-400 mt-1">{scoreBand(latestScore.score)} · {latestScore.date}</p>
            </>
          ) : (
            <p className="text-slate-400 text-sm">No score logged yet</p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-500">Overall Utilization</span>
            <div className={`rounded-lg p-2 ${overallUtilizationPct !== null && overallUtilizationPct < 30 ? 'bg-green-50' : 'bg-orange-50'}`}>
              <CreditCard className={`w-4 h-4 ${overallUtilizationPct !== null && overallUtilizationPct < 30 ? 'text-green-600' : 'text-orange-500'}`} />
            </div>
          </div>
          <p className={`text-2xl font-semibold ${overallUtilizationPct !== null && overallUtilizationPct < 30 ? 'text-green-600' : overallUtilizationPct !== null && overallUtilizationPct < 70 ? 'text-orange-500' : 'text-red-500'}`}>
            {overallUtilizationPct !== null ? `${overallUtilizationPct.toFixed(1)}%` : 'N/A'}
          </p>
          <p className="text-xs text-slate-400 mt-1">Goal: keep below 30%</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-500">Score Checklist</span>
            <div className="rounded-lg p-2 bg-indigo-50">
              <TrendingUp className="w-4 h-4 text-indigo-600" />
            </div>
          </div>
          <p className="text-2xl font-semibold text-indigo-600">{scoreChecklist.filter(c => c.ok).length}/{scoreChecklist.length}</p>
          <p className="text-xs text-slate-400 mt-1">factors in good shape</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Credit Score History */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-slate-700">Score History</h3>
            <button
              onClick={() => setShowScoreForm(true)}
              className="flex items-center gap-1.5 text-xs bg-slate-800 text-white rounded-lg px-3 py-1.5 hover:bg-slate-700 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Log Score
            </button>
          </div>

          {scoreChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={scoreChartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis domain={[300, 850]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
                <ReferenceLine y={740} stroke="#22c55e" strokeDasharray="3 3" label={{ value: 'Great', position: 'right', fontSize: 9, fill: '#22c55e' }} />
                <ReferenceLine y={670} stroke="#eab308" strokeDasharray="3 3" label={{ value: 'Good', position: 'right', fontSize: 9, fill: '#eab308' }} />
                <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex flex-col items-center justify-center text-slate-400 text-sm gap-2">
              <p>No score entries yet.</p>
              <button onClick={() => setShowScoreForm(true)} className="underline text-slate-500 hover:text-slate-700">Log your first score</button>
            </div>
          )}

          {/* Recent entries list */}
          {scores.length > 0 && (
            <div className="mt-3 space-y-1.5 max-h-32 overflow-y-auto">
              {scores.slice(0, 8).map(s => (
                <div key={s.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg hover:bg-slate-50">
                  <span className="text-slate-500">{s.date}</span>
                  <span className={`font-medium tabular-nums ${scoreColor(s.score)}`}>{s.score}</span>
                  <span className="text-slate-400">{scoreBand(s.score)}</span>
                  {s.notes && <span className="text-slate-400 truncate max-w-24">{s.notes}</span>}
                  <button onClick={() => setConfirmScore(s)} className="text-slate-300 hover:text-red-400 ml-1">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Score Factor Checklist */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-700 mb-4">Score Factor Checklist</h3>
          <div className="space-y-3">
            {scoreChecklist.map(({ label, ok, detail }) => (
              <div key={label} className="flex items-start gap-2.5">
                {ok
                  ? <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                  : <Circle className="w-4 h-4 text-slate-300 mt-0.5 shrink-0" />
                }
                <div>
                  <p className={`text-xs font-medium ${ok ? 'text-slate-700' : 'text-slate-500'}`}>{label}</p>
                  <p className={`text-xs ${ok ? 'text-green-600' : 'text-slate-400'}`}>{detail}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Per-card utilization bars */}
          {perCardUtilization.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-500 mb-2">Per-card utilization</p>
              <div className="space-y-2">
                {perCardUtilization.map(c => {
                  const barColor = c.pct >= 90 ? '#ef4444' : c.pct >= 30 ? '#f97316' : '#22c55e'
                  return (
                    <div key={c.id}>
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>{c.name}</span>
                        <span className="tabular-nums">{fmt(c.used)} / {fmt(c.limit)} · {c.pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden relative">
                        <div style={{ width: `${c.pct}%`, backgroundColor: barColor }} className="h-full rounded-full transition-all" />
                        <div className="absolute top-0 bottom-0 w-px bg-orange-400 opacity-70" style={{ left: '30%' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pay-In-Full Tracker */}
      {creditAccounts.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
          <h3 className="text-sm font-medium text-slate-700 mb-1">Pay-In-Full Tracker</h3>
          <p className="text-xs text-slate-400 mb-4">Track which months you paid your full statement balance.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left py-2 pr-4 text-xs text-slate-500 font-medium">Card</th>
                  {pifMonths.map(m => (
                    <th key={m} className="text-center py-2 px-2 text-xs text-slate-500 font-medium">{formatMonth(m)}</th>
                  ))}
                  <th className="text-center py-2 pl-4 text-xs text-slate-500 font-medium">Streak</th>
                </tr>
              </thead>
              <tbody>
                {creditAccounts.map(a => {
                  const streak = pifStreaks.find(s => s.id === a.id)?.streak ?? 0
                  return (
                    <tr key={a.id} className="border-t border-slate-100">
                      <td className="py-3 pr-4 text-xs font-medium text-slate-700">{a.name}</td>
                      {pifMonths.map(m => {
                        const paid = getPifStatus(a.id, m)
                        return (
                          <td key={m} className="text-center py-3 px-2">
                            <button
                              onClick={() => handleTogglePayInFull(a.id, m, paid)}
                              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center mx-auto transition-colors ${paid ? 'border-green-500 bg-green-500 text-white' : 'border-slate-300 hover:border-slate-400'}`}
                            >
                              {paid && <span className="text-xs leading-none">✓</span>}
                            </button>
                          </td>
                        )
                      })}
                      <td className="text-center py-3 pl-4">
                        {streak >= 3
                          ? <span className="text-xs font-medium text-green-600 bg-green-50 rounded-full px-2 py-0.5">{streak}🔥</span>
                          : <span className="text-xs text-slate-400">{streak}mo</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* What-If Debt Payoff Simulator */}
      {accounts.filter(a => (a.type === 'credit' || a.type === 'loan') && a.balance < 0 && a.apr).length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-medium text-slate-700">What-If Debt Payoff Simulator</h3>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Select Account</label>
                <select
                  value={simAccountId}
                  onChange={e => setSimAccountId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                >
                  <option value="">— choose a debt account —</option>
                  {accounts.filter(a => (a.type === 'credit' || a.type === 'loan') && a.balance < 0 && a.apr).map(a => (
                    <option key={a.id} value={a.id}>{a.name} (owe {fmt(Math.abs(a.balance))} @ {a.apr}%)</option>
                  ))}
                </select>
              </div>
              {simAccountId && simBalance > 0 && (
                <>
                  <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 space-y-1">
                    <div className="flex justify-between"><span>Balance:</span><span className="font-medium">{fmt(simBalance)}</span></div>
                    <div className="flex justify-between"><span>APR:</span><span className="font-medium">{simApr}%</span></div>
                    <div className="flex justify-between"><span>Est. min payment (2%):</span><span className="font-medium">{fmt(minPayment)}</span></div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Extra Monthly Payment ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="50"
                      placeholder="e.g. 200"
                      value={simExtraPayment}
                      onChange={e => setSimExtraPayment(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                  </div>
                </>
              )}
            </div>
            {simAccountId && simBalance > 0 && simApr > 0 && (
              <div className="space-y-3">
                <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                  <p className="text-xs text-red-500 mb-1">Minimum payment only (~{fmt(minPayment)}/mo)</p>
                  <p className="text-lg font-semibold text-red-600">
                    {simWithMin?.months ? `${simWithMin.months} months` : 'Won\'t pay off'}
                  </p>
                  {simWithMin?.interest !== undefined && (
                    <p className="text-xs text-red-400 mt-0.5">Total interest: {fmt(simWithMin.interest)}</p>
                  )}
                </div>
                {extraAmount > 0 && (
                  <div className="bg-green-50 rounded-xl p-4 border border-green-100">
                    <p className="text-xs text-green-600 mb-1">With {fmt(extraAmount)} extra/mo ({fmt(minPayment + extraAmount)} total)</p>
                    <p className="text-lg font-semibold text-green-700">
                      {simWithExtra?.months ? `${simWithExtra.months} months` : 'Won\'t pay off'}
                    </p>
                    {simWithExtra?.interest !== undefined && (
                      <p className="text-xs text-green-500 mt-0.5">Total interest: {fmt(simWithExtra.interest)}</p>
                    )}
                  </div>
                )}
                {extraAmount > 0 && monthsSaved > 0 && (
                  <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                    <p className="text-xs text-indigo-500 mb-1">You save</p>
                    <p className="text-base font-semibold text-indigo-700">{monthsSaved} months + {fmt(interestSaved)} in interest</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Score Modal */}
      {showScoreForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-slate-800">Log Credit Score</h3>
              <button onClick={() => setShowScoreForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddScore} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Credit Score (300–850)</label>
                <input
                  type="number"
                  min="300"
                  max="850"
                  placeholder="e.g. 720"
                  value={newScore}
                  onChange={e => setNewScore(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Date</label>
                <input
                  type="date"
                  value={newDate}
                  onChange={e => setNewDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Notes (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Chase app · post balance payoff"
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
              <button
                type="submit"
                disabled={savingScore}
                className="w-full bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {savingScore ? 'Saving…' : 'Save Score'}
              </button>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmScore !== null}
        title="Delete credit score entry?"
        message={confirmScore ? <>This will remove your score of <strong>{confirmScore.score}</strong> from {confirmScore.date}. This cannot be undone.</> : ''}
        confirmLabel="Delete"
        loading={deletingScore}
        onConfirm={() => confirmScore && handleDeleteScore(confirmScore.id)}
        onCancel={() => setConfirmScore(null)}
      />
    </div>
  )
}
