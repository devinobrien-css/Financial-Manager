'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, Trash2, ChevronLeft, ChevronRight, X, ArrowRight, ChevronDown, Check, Wallet, CreditCard, Banknote, PiggyBank, Landmark } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

interface Category {
  id: number
  name: string
  type: string
  color: string
}

interface Account {
  id: string
  name: string
  type: string
  balance: number
}

const ACCOUNT_LABELS: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit: 'Credit Card',
  cash: 'Cash',
  loan: 'Loan',
}

const ACCOUNT_ICONS: Record<string, React.ElementType> = {
  checking: Wallet,
  savings: PiggyBank,
  credit: CreditCard,
  cash: Banknote,
  loan: Landmark,
}

interface Transaction {
  id: string
  type: 'income' | 'expense' | 'transfer'
  amount: number
  description: string
  category_id: number | null
  category_name: string | null
  category_color: string | null
  account_id: string | null
  account_name: string | null
  to_account_id: string | null
  to_account_name: string | null
  date: string
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

const today = () => new Date().toISOString().slice(0, 10)

type SelectOption = {
  value: string
  label: string
  sublabel?: string
  color?: string
  icon?: React.ElementType
}

function CustomSelect({
  value,
  onChange,
  options,
  placeholder = '— Select —',
}: {
  value: string
  onChange: (val: string) => void
  options: SelectOption[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected?.color && (
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: selected.color }} />
          )}
          {selected?.icon && (() => { const Icon = selected.icon!; return <Icon className="w-4 h-4 text-slate-400 flex-shrink-0" /> })()}
          <span className={`truncate ${selected ? 'text-slate-800' : 'text-slate-400'}`}>
            {selected ? selected.label : placeholder}
          </span>
          {selected?.sublabel && (
            <span className="text-slate-400 text-xs flex-shrink-0">{selected.sublabel}</span>
          )}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 ml-2 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          <div className="max-h-56 overflow-y-auto py-1">
            {options.map(o => {
              const Icon = o.icon
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors hover:bg-slate-50 ${
                    value === o.value ? 'bg-slate-50' : ''
                  }`}
                >
                  {o.color && (
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: o.color }} />
                  )}
                  {Icon && <Icon className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <span className={`block truncate ${value === o.value ? 'text-slate-900 font-medium' : 'text-slate-700'}`}>
                      {o.label}
                    </span>
                    {o.sublabel && (
                      <span className="block text-xs text-slate-400 truncate">{o.sublabel}</span>
                    )}
                  </span>
                  {value === o.value && <Check className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function TransactionsPage() {
  const { lock } = useAuth()
  const [month, setMonth] = useState(toMonthString(new Date()))
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Form state
  const [formType, setFormType] = useState<'income' | 'expense' | 'transfer'>('expense')
  const [formAmount, setFormAmount] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formCat, setFormCat] = useState<number | ''>('')
  const [formAccount, setFormAccount] = useState<string>('')
  const [formToAccount, setFormToAccount] = useState<string>('')
  const [formDate, setFormDate] = useState(today())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const loadTx = useCallback(async (m: string) => {
    setLoading(true)
    const res = await fetch(`/api/transactions?month=${m}`)
    if (res.status === 401) { lock(); setLoading(false); return }
    if (res.ok) setTransactions(await res.json())
    setLoading(false)
  }, [lock])

  useEffect(() => {
    fetch('/api/categories').then(r => { if (r.status === 401) { lock(); return [] } return r.ok ? r.json() : [] }).then(setCategories)
    fetch('/api/accounts').then(r => { if (r.status === 401) { lock(); return [] } return r.ok ? r.json() : [] }).then(setAccounts)
  }, [lock])

  useEffect(() => { loadTx(month) }, [month, loadTx])

  const prevMonth = () => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 2, 1) // m-1 for 0-index, then -1 more for prev
    setMonth(toMonthString(d))
  }
  const nextMonth = () => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m, 1) // m-1 for 0-index, then +1 more for next
    setMonth(toMonthString(d))
  }

  const filteredCats = categories.filter(c => c.type === formType)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    const amount = parseFloat(formAmount)
    if (isNaN(amount) || amount <= 0) { setFormError('Enter a valid amount'); return }
    if (formType === 'transfer' && (!formAccount || !formToAccount)) {
      setFormError('Select both a source and destination account'); return
    }
    if (formType === 'transfer' && formAccount === formToAccount) {
      setFormError('Source and destination accounts must differ'); return
    }
    setSaving(true)
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: formType,
        amount,
        description: formDesc,
        category_id: formType !== 'transfer' ? (formCat || null) : null,
        account_id: formAccount || null,
        to_account_id: formType === 'transfer' ? (formToAccount || null) : null,
        date: formDate,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      if (d.error === 'LOCKED') { lock(); return }
      setFormError(d.error ?? 'Failed to save')
      return
    }
    setFormAmount('')
    setFormDesc('')
    setFormCat('')
    setFormAccount('')
    setFormToAccount('')
    setFormDate(today())
    setShowForm(false)
    loadTx(month)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this transaction?')) return
    setDeleting(id)
    await fetch('/api/transactions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setDeleting(null)
    loadTx(month)
  }

  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-semibold text-slate-800">Transactions</h2>
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors">
              <ChevronLeft className="w-4 h-4 text-slate-600" />
            </button>
            <span className="text-sm font-medium text-slate-700 w-40 text-center">{formatMonth(month)}</span>
            <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors">
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-slate-800 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Transaction
        </button>
      </div>

      {/* Mini summary */}
      <div className="flex gap-4 mb-6">
        <div className="bg-green-50 rounded-lg px-4 py-2 text-sm">
          <span className="text-slate-500">Income </span>
          <span className="font-semibold text-green-600">{fmt(income)}</span>
        </div>
        <div className="bg-red-50 rounded-lg px-4 py-2 text-sm">
          <span className="text-slate-500">Expenses </span>
          <span className="font-semibold text-red-500">{fmt(expenses)}</span>
        </div>
        <div className="bg-slate-50 rounded-lg px-4 py-2 text-sm">
          <span className="text-slate-500">Net </span>
          <span className={`font-semibold ${income - expenses >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {fmt(income - expenses)}
          </span>
        </div>
      </div>

      {/* Transaction list */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-6 text-slate-400 text-sm">Loading…</div>
        ) : transactions.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            No transactions this month.{' '}
            <button onClick={() => setShowForm(true)} className="underline hover:text-slate-600">Add one</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-3 px-4 text-xs text-slate-500 font-medium">Date</th>
                <th className="text-left py-3 px-4 text-xs text-slate-500 font-medium">Description</th>
                <th className="text-left py-3 px-4 text-xs text-slate-500 font-medium">Category / Account</th>
                <th className="text-right py-3 px-4 text-xs text-slate-500 font-medium">Amount</th>
                <th className="py-3 px-4 w-10" />
              </tr>
            </thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4 text-slate-500 whitespace-nowrap">{t.date}</td>
                  <td className="py-3 px-4 text-slate-700">
                    {t.type === 'transfer' ? (
                      <span className="flex items-center gap-1 text-slate-500 italic text-xs">
                        <span>{t.account_name ?? '?'}</span>
                        <ArrowRight className="w-3 h-3" />
                        <span>{t.to_account_name ?? '?'}</span>
                      </span>
                    ) : (
                      t.description || <span className="text-slate-400 italic">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {t.type === 'transfer' ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        Transfer
                      </span>
                    ) : t.category_name ? (
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: t.category_color ?? '#94a3b8' }}
                      >
                        {t.category_name}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                    {t.account_name && t.type !== 'transfer' && (
                      <span className="ml-1.5 text-xs text-slate-400">{t.account_name}</span>
                    )}
                  </td>
                  <td className={`py-3 px-4 text-right font-semibold tabular-nums ${
                    t.type === 'income' ? 'text-green-600'
                    : t.type === 'expense' ? 'text-red-500'
                    : 'text-slate-500'
                  }`}>
                    {t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}{fmt(t.amount)}
                  </td>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => handleDelete(t.id)}
                      disabled={deleting === t.id}
                      className="text-slate-300 hover:text-red-400 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Transaction Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-slate-800">Add Transaction</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Type toggle */}
              <div className="flex rounded-lg overflow-hidden border border-slate-200">
                {(['expense', 'income', 'transfer'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setFormType(t); setFormCat('') }}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                      formType === t
                        ? t === 'expense' ? 'bg-red-500 text-white'
                          : t === 'income' ? 'bg-green-500 text-white'
                          : 'bg-slate-600 text-white'
                        : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={formAmount}
                  onChange={e => setFormAmount(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                  required
                  autoFocus
                />
              </div>

              {formType === 'transfer' ? (
                <>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">From Account</label>
                    <CustomSelect
                      value={formAccount}
                      onChange={setFormAccount}
                      placeholder="— Select account —"
                      options={accounts.map(a => ({
                        value: a.id,
                        label: a.name,
                        sublabel: `${ACCOUNT_LABELS[a.type] ?? a.type}  ·  ${fmt(Math.abs(a.balance))}`,
                        icon: ACCOUNT_ICONS[a.type],
                      }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">To Account</label>
                    <CustomSelect
                      value={formToAccount}
                      onChange={setFormToAccount}
                      placeholder="— Select account —"
                      options={accounts.filter(a => a.id !== formAccount).map(a => ({
                        value: a.id,
                        label: a.name,
                        sublabel: `${ACCOUNT_LABELS[a.type] ?? a.type}  ·  ${fmt(Math.abs(a.balance))}`,
                        icon: ACCOUNT_ICONS[a.type],
                      }))}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Description (optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Monthly rent"
                      value={formDesc}
                      onChange={e => setFormDesc(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Category</label>
                    <CustomSelect
                      value={String(formCat)}
                      onChange={val => setFormCat(val ? Number(val) : '')}
                      placeholder="— No category —"
                      options={[
                        ...filteredCats.map(c => ({ value: String(c.id), label: c.name, color: c.color })),
                      ]}
                    />
                  </div>
                  {accounts.length > 0 && (
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Account (optional)</label>
                      <CustomSelect
                        value={formAccount}
                        onChange={setFormAccount}
                        placeholder="— No account —"
                        options={accounts.map(a => ({
                          value: a.id,
                          label: a.name,
                          sublabel: `${ACCOUNT_LABELS[a.type] ?? a.type}  ·  ${fmt(Math.abs(a.balance))}`,
                          icon: ACCOUNT_ICONS[a.type],
                        }))}
                      />
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-xs text-slate-500 mb-1">Date</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                  required
                />
              </div>

              {formError && <p className="text-red-500 text-sm">{formError}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
