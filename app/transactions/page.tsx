'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Plus, Trash2, ChevronLeft, ChevronRight, X, ArrowRight, ChevronDown, Check, Wallet, CreditCard, Banknote, PiggyBank, Landmark, Pencil, Search, RefreshCw, ChevronUp } from 'lucide-react'
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

interface RecurringTemplate {
  id: string
  type: 'income' | 'expense' | 'transfer'
  description: string
  amount: number
  frequency: string
  next_date: string
  category_id: number | null
  category_name: string | null
  category_color: string | null
  account_id: string | null
  account_name: string | null
  to_account_id: string | null
  to_account_name: string | null
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
  const [recurring, setRecurring] = useState<RecurringTemplate[]>([])
  const [showForm, setShowForm] = useState(false)
  const [showRecurringForm, setShowRecurringForm] = useState(false)
  const [showRecurring, setShowRecurring] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Filter state
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense' | 'transfer'>('all')
  const [filterCat, setFilterCat] = useState<string>('')

  // Form state
  const [formType, setFormType] = useState<'income' | 'expense' | 'transfer'>('expense')
  const [formAmount, setFormAmount] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formMemo, setFormMemo] = useState('')
  const [formCat, setFormCat] = useState<number | ''>('')
  const [formAccount, setFormAccount] = useState<string>('')
  const [formToAccount, setFormToAccount] = useState<string>('')
  const [formDate, setFormDate] = useState(today())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  // Recurring template form
  const [rtType, setRtType] = useState<'income' | 'expense' | 'transfer'>('expense')
  const [rtDesc, setRtDesc] = useState('')
  const [rtAmount, setRtAmount] = useState('')
  const [rtFreq, setRtFreq] = useState('monthly')
  const [rtNextDate, setRtNextDate] = useState(today())
  const [rtCat, setRtCat] = useState<number | ''>('')
  const [rtAccount, setRtAccount] = useState('')
  const [rtToAccount, setRtToAccount] = useState('')
  const [rtError, setRtError] = useState('')
  const [rtSaving, setRtSaving] = useState(false)
  const [deletingRt, setDeletingRt] = useState<string | null>(null)

  const loadTx = useCallback(async (m: string) => {
    setLoading(true)
    const res = await fetch(`/api/transactions?month=${m}`)
    if (res.status === 401) { lock(); setLoading(false); return }
    if (res.ok) setTransactions(await res.json())
    setLoading(false)
  }, [lock])

  const loadRecurring = useCallback(async () => {
    const res = await fetch('/api/recurring')
    if (res.status === 401) { lock(); return }
    if (res.ok) setRecurring(await res.json())
  }, [lock])

  useEffect(() => {
    fetch('/api/categories').then(r => { if (r.status === 401) { lock(); return [] } return r.ok ? r.json() : [] }).then(setCategories)
    fetch('/api/accounts').then(r => { if (r.status === 401) { lock(); return [] } return r.ok ? r.json() : [] }).then(setAccounts)
    loadRecurring()
  }, [lock, loadRecurring])

  useEffect(() => { loadTx(month) }, [month, loadTx])

  const prevMonth = () => {
    const [y, m] = month.split('-').map(Number)
    setMonth(toMonthString(new Date(y, m - 2, 1)))
  }
  const nextMonth = () => {
    const [y, m] = month.split('-').map(Number)
    setMonth(toMonthString(new Date(y, m, 1)))
  }

  const filteredCats = categories.filter(c => c.type === formType)
  const rtFilteredCats = categories.filter(c => c.type === rtType)

  // Client-side filtering
  const displayedTx = useMemo(() => {
    return transactions.filter(t => {
      if (filterType !== 'all' && t.type !== filterType) return false
      if (filterCat && String(t.category_id) !== filterCat) return false
      if (search) {
        const q = search.toLowerCase()
        if (
          !t.description.toLowerCase().includes(q) &&
          !(t.memo ?? '').toLowerCase().includes(q) &&
          !(t.category_name ?? '').toLowerCase().includes(q) &&
          !(t.account_name ?? '').toLowerCase().includes(q)
        ) return false
      }
      return true
    })
  }, [transactions, filterType, filterCat, search])

  const openEdit = (t: Transaction) => {
    setEditingId(t.id)
    setFormType(t.type)
    setFormAmount(String(t.amount))
    setFormDesc(t.description)
    setFormMemo(t.memo ?? '')
    setFormCat(t.category_id ?? '')
    setFormAccount(t.account_id ?? '')
    setFormToAccount(t.to_account_id ?? '')
    setFormDate(t.date)
    setFormError('')
    setShowForm(true)
  }

  const resetForm = () => {
    setEditingId(null)
    setFormType('expense')
    setFormAmount('')
    setFormDesc('')
    setFormMemo('')
    setFormCat('')
    setFormAccount('')
    setFormToAccount('')
    setFormDate(today())
    setFormError('')
  }

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
    const payload = {
      type: formType,
      amount,
      description: formDesc,
      memo: formMemo || null,
      category_id: formType !== 'transfer' ? (formCat || null) : null,
      account_id: formAccount || null,
      to_account_id: formType === 'transfer' ? (formToAccount || null) : null,
      date: formDate,
      ...(editingId ? { id: editingId } : {}),
    }
    const res = await fetch('/api/transactions', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      if (d.error === 'LOCKED') { lock(); return }
      setFormError(d.error ?? 'Failed to save')
      return
    }
    resetForm()
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

  const handleUseTemplate = async (rt: RecurringTemplate) => {
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: rt.type,
        amount: rt.amount,
        description: rt.description,
        category_id: rt.category_id,
        account_id: rt.account_id,
        to_account_id: rt.to_account_id,
        date: today(),
      }),
    })
    if (!res.ok) { const d = await res.json().catch(() => ({})); if (d.error === 'LOCKED') { lock(); return } }
    // Advance next_date
    const [y, m, d] = rt.next_date.split('-').map(Number)
    let next: Date
    if (rt.frequency === 'weekly') next = new Date(y, m - 1, d + 7)
    else if (rt.frequency === 'biweekly') next = new Date(y, m - 1, d + 14)
    else if (rt.frequency === 'monthly') next = new Date(y, m, d)
    else if (rt.frequency === 'quarterly') next = new Date(y, m + 2, d)
    else next = new Date(y + 1, m - 1, d)
    await fetch('/api/recurring', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rt.id, next_date: next.toISOString().slice(0, 10) }),
    })
    loadTx(month)
    loadRecurring()
  }

  const handleDeleteRecurring = async (id: string) => {
    if (!confirm('Remove this recurring template?')) return
    setDeletingRt(id)
    await fetch('/api/recurring', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setDeletingRt(null)
    loadRecurring()
  }

  const handleRecurringSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setRtError('')
    const amount = parseFloat(rtAmount)
    if (isNaN(amount) || amount <= 0) { setRtError('Enter a valid amount'); return }
    if (!rtDesc.trim()) { setRtError('Description is required'); return }
    setRtSaving(true)
    const res = await fetch('/api/recurring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: rtType,
        description: rtDesc,
        amount,
        frequency: rtFreq,
        next_date: rtNextDate,
        category_id: rtCat || null,
        account_id: rtAccount || null,
        to_account_id: rtType === 'transfer' ? (rtToAccount || null) : null,
      }),
    })
    setRtSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      if (d.error === 'LOCKED') { lock(); return }
      setRtError(d.error ?? 'Failed to save')
      return
    }
    setRtDesc(''); setRtAmount(''); setRtFreq('monthly'); setRtNextDate(today())
    setRtCat(''); setRtAccount(''); setRtToAccount('')
    setShowRecurringForm(false)
    loadRecurring()
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
          onClick={() => { resetForm(); setShowForm(true) }}
          className="flex items-center gap-2 bg-slate-800 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Transaction
        </button>
      </div>

      {/* Mini summary */}
      <div className="flex gap-4 mb-5">
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

      {/* Search + filter bar */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search transactions…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
          {(['all', 'income', 'expense', 'transfer'] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                filterType === t ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <select
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          <option value="">All Categories</option>
          {categories.map(c => (
            <option key={c.id} value={String(c.id)}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Transaction list */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-6 text-slate-400 text-sm">Loading…</div>
        ) : displayedTx.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            {transactions.length === 0
              ? <><span>No transactions this month. </span><button onClick={() => { resetForm(); setShowForm(true) }} className="underline hover:text-slate-600">Add one</button></>
              : 'No transactions match your filters.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-3 px-4 text-xs text-slate-500 font-medium">Date</th>
                <th className="text-left py-3 px-4 text-xs text-slate-500 font-medium">Description</th>
                <th className="text-left py-3 px-4 text-xs text-slate-500 font-medium">Category / Account</th>
                <th className="text-right py-3 px-4 text-xs text-slate-500 font-medium">Amount</th>
                <th className="py-3 px-4 w-16" />
              </tr>
            </thead>
            <tbody>
              {displayedTx.map(t => (
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
                      <div>
                        <span>{t.description || <span className="text-slate-400 italic">—</span>}</span>
                        {t.memo && <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{t.memo}</p>}
                      </div>
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
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        onClick={() => openEdit(t)}
                        className="text-slate-300 hover:text-slate-600 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        disabled={deleting === t.id}
                        className="text-slate-300 hover:text-red-400 transition-colors disabled:opacity-50"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recurring Templates Section */}
      <div className="mt-6 bg-white rounded-xl border border-slate-200 overflow-hidden">
        <button
          onClick={() => setShowRecurring(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-slate-400" />
            <span>Recurring Templates</span>
            {recurring.length > 0 && (
              <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{recurring.length}</span>
            )}
          </div>
          {showRecurring ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {showRecurring && (
          <div className="border-t border-slate-100">
            {recurring.length === 0 ? (
              <div className="px-5 py-6 text-center text-slate-400 text-sm">
                No recurring templates yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {recurring.map(rt => (
                  <div key={rt.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-700 font-medium truncate">{rt.description}</span>
                        {rt.category_name && (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium text-white flex-shrink-0"
                            style={{ backgroundColor: rt.category_color ?? '#94a3b8' }}
                          >
                            {rt.category_name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {rt.frequency.charAt(0).toUpperCase() + rt.frequency.slice(1)} · Next: {rt.next_date}
                        {rt.account_name && ` · ${rt.account_name}`}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold tabular-nums flex-shrink-0 ${
                      rt.type === 'income' ? 'text-green-600' : rt.type === 'expense' ? 'text-red-500' : 'text-slate-500'
                    }`}>
                      {rt.type === 'income' ? '+' : rt.type === 'expense' ? '-' : ''}{fmt(rt.amount)}
                    </span>
                    <button
                      onClick={() => handleUseTemplate(rt)}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors font-medium flex-shrink-0"
                    >
                      Use
                    </button>
                    <button
                      onClick={() => handleDeleteRecurring(rt.id)}
                      disabled={deletingRt === rt.id}
                      className="text-slate-300 hover:text-red-400 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="px-5 py-3 border-t border-slate-100">
              <button
                onClick={() => setShowRecurringForm(true)}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Template
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Transaction Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-slate-800">{editingId ? 'Edit Transaction' : 'Add Transaction'}</h3>
              <button onClick={() => { resetForm(); setShowForm(false) }} className="text-slate-400 hover:text-slate-600">
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
                    <label className="block text-xs text-slate-500 mb-1">Memo (optional)</label>
                    <textarea
                      placeholder="Additional notes…"
                      value={formMemo}
                      onChange={e => setFormMemo(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
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
                  onClick={() => { resetForm(); setShowForm(false) }}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Recurring Template Modal */}
      {showRecurringForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-slate-800">Add Recurring Template</h3>
              <button onClick={() => setShowRecurringForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleRecurringSubmit} className="space-y-4">
              <div className="flex rounded-lg overflow-hidden border border-slate-200">
                {(['expense', 'income', 'transfer'] as const).map(t => (
                  <button key={t} type="button" onClick={() => { setRtType(t); setRtCat('') }}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                      rtType === t
                        ? t === 'expense' ? 'bg-red-500 text-white' : t === 'income' ? 'bg-green-500 text-white' : 'bg-slate-600 text-white'
                        : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Description</label>
                <input type="text" placeholder="e.g. Netflix subscription" value={rtDesc} onChange={e => setRtDesc(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" required />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Amount ($)</label>
                <input type="number" step="0.01" min="0.01" placeholder="0.00" value={rtAmount} onChange={e => setRtAmount(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" required />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Frequency</label>
                <select value={rtFreq} onChange={e => setRtFreq(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white">
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Next Due Date</label>
                <input type="date" value={rtNextDate} onChange={e => setRtNextDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" required />
              </div>

              {rtType !== 'transfer' && (
                <>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Category</label>
                    <CustomSelect value={String(rtCat)} onChange={val => setRtCat(val ? Number(val) : '')} placeholder="— No category —"
                      options={rtFilteredCats.map(c => ({ value: String(c.id), label: c.name, color: c.color }))} />
                  </div>
                  {accounts.length > 0 && (
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Account (optional)</label>
                      <CustomSelect value={rtAccount} onChange={setRtAccount} placeholder="— No account —"
                        options={accounts.map(a => ({ value: a.id, label: a.name, sublabel: ACCOUNT_LABELS[a.type] ?? a.type, icon: ACCOUNT_ICONS[a.type] }))} />
                    </div>
                  )}
                </>
              )}

              {rtType === 'transfer' && (
                <>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">From Account</label>
                    <CustomSelect value={rtAccount} onChange={setRtAccount} placeholder="— Select account —"
                      options={accounts.map(a => ({ value: a.id, label: a.name, sublabel: ACCOUNT_LABELS[a.type] ?? a.type, icon: ACCOUNT_ICONS[a.type] }))} />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">To Account</label>
                    <CustomSelect value={rtToAccount} onChange={setRtToAccount} placeholder="— Select account —"
                      options={accounts.filter(a => a.id !== rtAccount).map(a => ({ value: a.id, label: a.name, sublabel: ACCOUNT_LABELS[a.type] ?? a.type, icon: ACCOUNT_ICONS[a.type] }))} />
                  </div>
                </>
              )}

              {rtError && <p className="text-red-500 text-sm">{rtError}</p>}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowRecurringForm(false)}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={rtSaving}
                  className="flex-1 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors">
                  {rtSaving ? 'Saving…' : 'Add Template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
