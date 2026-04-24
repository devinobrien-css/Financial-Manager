'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ChevronLeft, ArrowRight } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

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
  name: string
  type: string
  balance: number
  opening_balance: number
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export default function StatementPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { lock } = useAuth()
  const [account, setAccount] = useState<Account | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [txRes, acRes] = await Promise.all([
      fetch(`/api/transactions?account_id=${id}&all=1`),
      fetch('/api/accounts'),
    ])
    if (txRes.status === 401 || acRes.status === 401) { lock(); setLoading(false); return }
    if (txRes.ok) {
      const data: Transaction[] = await txRes.json()
      setTransactions(data.sort((a, b) => a.date.localeCompare(b.date)))
    }
    if (acRes.ok) {
      const accounts: Account[] = await acRes.json()
      setAccount(accounts.find(a => a.id === id) ?? null)
    }
    setLoading(false)
  }, [id, lock])

  useEffect(() => { load() }, [load])

  // Build running balance
  const rows = (() => {
    if (!account) return []
    let balance = account.opening_balance
    const result: Array<Transaction & { runningBalance: number }> = []
    for (const t of transactions) {
      if (t.type === 'income') balance += t.amount
      else if (t.type === 'expense') balance -= t.amount
      else if (t.type === 'transfer') {
        if (t.account_id === id) balance -= t.amount
        else balance += t.amount
      }
      result.push({ ...t, runningBalance: balance })
    }
    return result.reverse() // newest first for display
  })()

  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push('/accounts')}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Accounts
        </button>
        <span className="text-slate-300">/</span>
        {account ? (
          <h2 className="text-2xl font-semibold text-slate-800">{account.name}</h2>
        ) : (
          <div className="h-7 w-40 bg-slate-100 rounded animate-pulse" />
        )}
      </div>

      {!loading && account && (
        <div className="flex gap-4 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 px-5 py-3">
            <p className="text-xs text-slate-400">Current Balance</p>
            <p className={`text-xl font-semibold tabular-nums ${account.balance < 0 ? 'text-red-500' : 'text-slate-800'}`}>
              {account.balance < 0 ? '-' : ''}{fmt(Math.abs(account.balance))}
            </p>
          </div>
          <div className="bg-green-50 rounded-xl border border-green-100 px-5 py-3">
            <p className="text-xs text-slate-400">Total In</p>
            <p className="text-xl font-semibold text-green-600">{fmt(income)}</p>
          </div>
          <div className="bg-red-50 rounded-xl border border-red-100 px-5 py-3">
            <p className="text-xs text-slate-400">Total Out</p>
            <p className="text-xl font-semibold text-red-500">{fmt(expenses)}</p>
          </div>
          <div className="bg-slate-50 rounded-xl border border-slate-200 px-5 py-3">
            <p className="text-xs text-slate-400">Transactions</p>
            <p className="text-xl font-semibold text-slate-700">{transactions.length}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-6 text-slate-400 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">No transactions for this account.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left py-3 px-4 text-xs text-slate-500 font-medium">Date</th>
                <th className="text-left py-3 px-4 text-xs text-slate-500 font-medium">Description</th>
                <th className="text-left py-3 px-4 text-xs text-slate-500 font-medium">Category</th>
                <th className="text-right py-3 px-4 text-xs text-slate-500 font-medium">Amount</th>
                <th className="text-right py-3 px-4 text-xs text-slate-500 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(t => {
                const isIn = t.type === 'income' || (t.type === 'transfer' && t.to_account_id === id)
                const isOut = t.type === 'expense' || (t.type === 'transfer' && t.account_id === id)
                return (
                  <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4 text-slate-400 whitespace-nowrap text-xs">{t.date}</td>
                    <td className="py-3 px-4 text-slate-700">
                      {t.type === 'transfer' ? (
                        <span className="flex items-center gap-1 text-slate-500 italic text-xs">
                          <span>{t.account_name ?? '?'}</span>
                          <ArrowRight className="w-3 h-3" />
                          <span>{t.to_account_name ?? '?'}</span>
                        </span>
                      ) : (
                        <div>
                          <span>{t.description || <span className="text-slate-400 italic">—</span>}</span>
                          {t.memo && <p className="text-xs text-slate-400 mt-0.5">{t.memo}</p>}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {t.type === 'transfer' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">Transfer</span>
                      ) : t.category_name ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
                          style={{ backgroundColor: t.category_color ?? '#94a3b8' }}
                        >
                          {t.category_name}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className={`py-3 px-4 text-right font-semibold tabular-nums text-sm ${isIn ? 'text-green-600' : isOut ? 'text-red-500' : 'text-slate-500'}`}>
                      {isIn ? '+' : isOut ? '-' : ''}{fmt(t.amount)}
                    </td>
                    <td className={`py-3 px-4 text-right tabular-nums text-sm font-medium ${t.runningBalance < 0 ? 'text-red-500' : 'text-slate-700'}`}>
                      {t.runningBalance < 0 ? '-' : ''}{fmt(Math.abs(t.runningBalance))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
