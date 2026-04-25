'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, Trash2, X, Wallet, CreditCard, Banknote, PiggyBank, Landmark, Pencil, GripVertical, ChevronDown, FileText, ArrowRight, TrendingUp } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Account {
  id: string
  name: string
  type: 'checking' | 'savings' | 'credit' | 'cash' | 'loan' | 'investment'
  balance: number
  opening_balance: number
  apr: number | null
  credit_limit: number | null
  monthly_interest: number | null
}

function fmt(n: number) {
  return Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function fmtSigned(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

interface StatementTransaction {
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

function StatementModal({ accountId, accounts, onClose }: {
  accountId: string | null
  accounts: Account[]
  onClose: () => void
}) {
  const { lock } = useAuth()
  const [transactions, setTransactions] = useState<StatementTransaction[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!accountId) return
    setLoading(true)
    setTransactions([])
    fetch(`/api/transactions?account_id=${accountId}&all=1`)
      .then(r => { if (r.status === 401) { lock(); return null } return r.ok ? r.json() : [] })
      .then((data: StatementTransaction[] | null) => {
        if (data) setTransactions(data.toSorted((a, b) => a.date.localeCompare(b.date)))
        setLoading(false)
      })
  }, [accountId, lock])

  const account = accounts.find(a => a.id === accountId) ?? null

  const rows = (() => {
    if (!account || !accountId) return []
    let balance = account.opening_balance
    const result: Array<StatementTransaction & { runningBalance: number }> = []
    for (const t of transactions) {
      if (t.type === 'income') balance += t.amount
      else if (t.type === 'expense') balance -= t.amount
      else if (t.type === 'transfer') {
        if (t.account_id === accountId) balance -= t.amount
        else balance += t.amount
      }
      result.push({ ...t, runningBalance: balance })
    }
    return result.reverse()
  })()

  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const expenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  if (!accountId) return null

  return (
    <div
      role="presentation"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col" style={{ maxHeight: '88vh' }}>
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            {account
              ? <h3 className="text-lg font-semibold text-slate-800">{account.name}</h3>
              : <div className="h-6 w-32 bg-slate-100 rounded animate-pulse" />}
            <p className="text-xs text-slate-400 mt-0.5">Account Statement</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats row */}
        {!loading && account && (
          <div className="flex gap-4 px-6 py-4 border-b border-slate-100 flex-shrink-0">
            <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-400">Current Balance</p>
              <p className={`text-lg font-semibold tabular-nums ${account.balance < 0 ? 'text-red-500' : 'text-slate-800'}`}>
                {account.balance < 0 ? '-' : ''}{fmt(account.balance)}
              </p>
            </div>
            <div className="bg-green-50 rounded-xl border border-green-100 px-4 py-3">
              <p className="text-xs text-slate-400">Total In</p>
              <p className="text-lg font-semibold text-green-600">{fmtSigned(income)}</p>
            </div>
            <div className="bg-red-50 rounded-xl border border-red-100 px-4 py-3">
              <p className="text-xs text-slate-400">Total Out</p>
              <p className="text-lg font-semibold text-red-500">{fmtSigned(expenses)}</p>
            </div>
            <div className="bg-slate-50 rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-xs text-slate-400">Transactions</p>
              <p className="text-lg font-semibold text-slate-700">{transactions.length}</p>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="p-6 text-slate-400 text-sm">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">No transactions for this account.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 z-10">
                <tr className="border-b border-slate-100">
                  <th className="text-left py-3 px-4 text-xs text-slate-500 font-medium">Date</th>
                  <th className="text-left py-3 px-4 text-xs text-slate-500 font-medium">Description</th>
                  <th className="text-left py-3 px-4 text-xs text-slate-500 font-medium">Category</th>
                  <th className="text-right py-3 px-4 text-xs text-slate-500 font-medium">Amount</th>
                  <th className="text-right py-3 px-4 text-xs text-slate-500 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(t => {
                  const isIn = t.type === 'income' || (t.type === 'transfer' && t.to_account_id === accountId)
                  const isOut = t.type === 'expense' || (t.type === 'transfer' && t.account_id === accountId)
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
                      <td className={`py-3 px-4 text-right font-semibold tabular-nums ${isIn ? 'text-green-600' : isOut ? 'text-red-500' : 'text-slate-500'}`}>
                        {isIn ? '+' : isOut ? '-' : ''}{fmt(t.amount)}
                      </td>
                      <td className={`py-3 px-4 text-right tabular-nums font-medium ${t.runningBalance < 0 ? 'text-red-500' : 'text-slate-700'}`}>
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
    </div>
  )
}

const ACCOUNT_ICONS: Record<string, React.ElementType> = {
  checking: Wallet,
  savings: PiggyBank,
  credit: CreditCard,
  cash: Banknote,
  loan: Landmark,
  investment: TrendingUp,
}

const ACCOUNT_LABELS: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit: 'Credit Card',
  cash: 'Cash',
  loan: 'Loan',
  investment: 'Investment',
}

const ACCOUNT_COLORS: Record<string, string> = {
  checking:   'bg-blue-50 text-blue-600',
  savings:    'bg-green-50 text-green-600',
  credit:     'bg-red-50 text-red-500',
  cash:       'bg-amber-50 text-amber-600',
  loan:       'bg-orange-50 text-orange-600',
  investment: 'bg-purple-50 text-purple-600',
}

const ACCOUNT_GROUPS = [
  { key: 'debit',      label: 'Checking & Cash', types: ['checking', 'cash'],  isDebt: false },
  { key: 'savings',    label: 'Savings',          types: ['savings'],           isDebt: false },
  { key: 'investment', label: 'Investments',       types: ['investment'],        isDebt: false },
  { key: 'credit',     label: 'Credit Cards',      types: ['credit'],            isDebt: true  },
  { key: 'loans',      label: 'Loans',             types: ['loan'],              isDebt: true  },
] as const

interface SortableAccountRowProps {
  account: Account
  onEdit: (a: Account) => void
  onDelete: (id: string) => void
  onViewStatement: (id: string) => void
  deleting: string | null
}

function SortableAccountRow({ account, onEdit, onDelete, onViewStatement, deleting }: SortableAccountRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: account.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  const Icon = ACCOUNT_ICONS[account.type]
  const isDebt = account.type === 'credit' || account.type === 'loan'
  const isNegative = account.balance < 0
  const isPaidOff = isDebt && !isNegative
  const balanceColor = isNegative ? 'text-red-500' : 'text-slate-400'

  const showUtilization = account.type === 'credit' && account.credit_limit !== null
  const utilized = showUtilization ? Math.abs(Math.min(account.balance, 0)) : 0
  const utilizationPct = showUtilization ? Math.min((utilized / account.credit_limit!) * 100, 100) : 0
  const utilizationColor = utilizationPct >= 90 ? '#ef4444' : utilizationPct >= 70 ? '#f97316' : '#22c55e'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white rounded-xl border transition-opacity overflow-hidden ${
        isPaidOff ? 'border-slate-100 opacity-50' : 'border-slate-200'
      }`}
    >
      <div className="p-5 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing touch-none"
          aria-label="Drag to reorder"
          tabIndex={-1}
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <div className={`rounded-xl p-3 ${isPaidOff ? 'bg-slate-100 text-slate-400' : ACCOUNT_COLORS[account.type]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className={`font-medium ${isPaidOff ? 'text-slate-400' : 'text-slate-800'}`}>{account.name}</p>
            {account.apr !== null && !isPaidOff && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-600">
                {account.apr}% APR
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{ACCOUNT_LABELS[account.type]}</p>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="text-right">
          <p className={`text-lg font-semibold tabular-nums ${balanceColor}`}>
            {isNegative ? '-' : ''}{Math.abs(account.balance).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
          </p>
          <p className="text-xs text-slate-400">
            {isDebt ? (isNegative ? 'You owe' : 'Paid off') : 'Balance'}
          </p>
          {account.monthly_interest !== null && account.monthly_interest > 0 && (
            <p className="text-xs text-orange-500 mt-0.5">
              ~{Math.abs(account.monthly_interest).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}/mo interest
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onViewStatement(account.id)}
            className="text-slate-300 hover:text-slate-600 transition-colors"
            title="View statement"
          >
            <FileText className="w-4 h-4" />
          </button>
          <button
            onClick={() => onEdit(account)}
            className="text-slate-300 hover:text-slate-600 transition-colors"
            title="Edit account"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(account.id)}
            disabled={deleting === account.id}
            className="text-slate-300 hover:text-red-400 transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      </div>

      {showUtilization && (
        <div className="px-5 pb-4">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-slate-400">{fmt(utilized)} <span className="text-slate-300">/</span> {fmt(account.credit_limit!)} limit</span>
            <span className="font-medium" style={{ color: utilizationColor }}>{utilizationPct.toFixed(0)}% utilized</span>
          </div>
          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${utilizationPct}%`, backgroundColor: utilizationColor }} />
          </div>
        </div>
      )}
    </div>
  )
}

type GroupDef = typeof ACCOUNT_GROUPS[number]

interface AccountGroupProps {
  group: GroupDef
  accounts: Account[]
  onReorder: (types: readonly string[], newIds: string[]) => void
  onEdit: (a: Account) => void
  onDelete: (id: string) => void
  onViewStatement: (id: string) => void
  deleting: string | null
}

function AccountGroup({ group, accounts, onReorder, onEdit, onDelete, onViewStatement, deleting }: AccountGroupProps) {
  const [collapsed, setCollapsed] = useState(false)
  const groupSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const groupAccounts = accounts.filter(a => (group.types as readonly string[]).includes(a.type))
  if (groupAccounts.length === 0) return null

  const total = groupAccounts.reduce((s, a) => s + a.balance, 0)
  const totalMonthly = groupAccounts.reduce((s, a) => s + (a.monthly_interest ?? 0), 0)

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = groupAccounts.findIndex(a => a.id === active.id)
    const newIndex = groupAccounts.findIndex(a => a.id === over.id)
    onReorder(group.types, arrayMove(groupAccounts, oldIndex, newIndex).map(a => a.id))
  }

  return (
    <div className="mb-8">
      {/* Group header */}
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 mb-3 group text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex-1">
          {group.label}
          <span className="ml-2 font-normal normal-case tracking-normal text-slate-300">
            ({groupAccounts.length})
          </span>
        </span>
        {totalMonthly > 0 && (
          <span className="text-xs text-orange-500 mr-2">
            ~{fmt(totalMonthly)}/mo interest
          </span>
        )}
        <span className={`text-sm font-semibold tabular-nums ${group.isDebt && total < 0 ? 'text-red-500' : 'text-slate-700'}`}>
          {total < 0 ? '-' : ''}{fmt(total)}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-transform ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>

      {!collapsed && (
        <DndContext sensors={groupSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={groupAccounts.map(a => a.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {groupAccounts.map(account => (
                <SortableAccountRow
                  key={account.id}
                  account={account}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onViewStatement={onViewStatement}
                  deleting={deleting}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}

export default function AccountsPage() {
  const { lock } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [statementAccountId, setStatementAccountId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<'checking' | 'savings' | 'credit' | 'cash' | 'loan' | 'investment'>('checking')
  const [formBalance, setFormBalance] = useState('')
  const [formApr, setFormApr] = useState('')
  const [formCreditLimit, setFormCreditLimit] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const reorderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/accounts')
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      if (d.error === 'LOCKED') { lock(); setLoading(false); return }
    } else {
      setAccounts(await res.json())
    }
    setLoading(false)
  }, [lock])

  useEffect(() => { load() }, [load])

  const handleGroupReorder = useCallback((types: readonly string[], newGroupIds: string[]) => {
    setAccounts(prev => {
      // Slots occupied by this group in the master array (in current order)
      const groupSlots: number[] = []
      prev.forEach((a, i) => { if ((types as readonly string[]).includes(a.type)) groupSlots.push(i) })
      // Map new IDs back to full account objects
      const reordered = newGroupIds.map(id => prev.find(a => a.id === id)!)
      const next = [...prev]
      groupSlots.forEach((slot, i) => { next[slot] = reordered[i] })
      if (reorderTimer.current) clearTimeout(reorderTimer.current)
      reorderTimer.current = setTimeout(() => {
        fetch('/api/accounts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reorder: next.map(a => a.id) }),
        })
      }, 300)
      return next
    })
  }, [])

  const totalAssets = accounts
    .filter(a => a.type !== 'credit' && a.type !== 'loan')
    .reduce((s, a) => s + Math.max(a.balance, 0), 0)

  const totalDebt = accounts
    .filter(a => a.type === 'credit' || a.type === 'loan')
    .reduce((s, a) => s + Math.abs(Math.min(a.balance, 0)), 0)

  const netWorth = accounts.reduce((s, a) => s + a.balance, 0)

  const totalMonthlyInterest = accounts
    .reduce((s, a) => s + (a.monthly_interest ?? 0), 0)

  const openEdit = (account: Account) => {
    setEditingAccount(account)
    setFormName(account.name)
    setFormType(account.type)
    const isDebt = account.type === 'credit' || account.type === 'loan'
    setFormBalance(isDebt ? Math.abs(account.opening_balance).toFixed(2) : account.opening_balance.toFixed(2))
    setFormApr(account.apr !== null ? String(account.apr) : '')
    setFormCreditLimit(account.credit_limit !== null ? String(account.credit_limit) : '')
    setFormError('')
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    const bal = parseFloat(formBalance || '0')
    if (isNaN(bal) || bal < 0) { setFormError('Enter a valid non-negative amount'); return }
    setSaving(true)
    const isEdit = editingAccount !== null
    const res = await fetch('/api/accounts', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        isEdit
          ? { id: editingAccount.id, name: formName, type: formType, opening_balance: bal, apr: formApr || null, credit_limit: formCreditLimit || null }
          : { name: formName, type: formType, opening_balance: bal, apr: formApr || null, credit_limit: formCreditLimit || null }
      ),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      if (d.error === 'LOCKED') { lock(); return }
      setFormError(d.error ?? 'Failed')
      return
    }
    setFormName('')
    setFormType('checking')
    setFormBalance('')
    setFormApr('')
    setFormCreditLimit('')
    setEditingAccount(null)
    setShowForm(false)
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this account? Transactions linked to it will become unlinked.')) return
    setDeleting(id)
    await fetch('/api/accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setDeleting(null)
    load()
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-semibold text-slate-800">Accounts</h2>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-slate-800 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Account
        </button>
      </div>

      {/* Summary row */}
      <div className={`grid gap-4 mb-8 ${totalMonthlyInterest > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-500 mb-1">Total Assets</p>
          <p className="text-2xl font-semibold text-green-600">{fmt(totalAssets)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-500 mb-1">Total Debt</p>
          <p className="text-2xl font-semibold text-red-500">{fmt(totalDebt)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-500 mb-1">Net Worth</p>
          <p className={`text-2xl font-semibold ${netWorth >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {netWorth < 0 ? '-' : ''}{fmt(netWorth)}
          </p>
        </div>
        {totalMonthlyInterest > 0 && (
          <div className="bg-orange-50 rounded-xl border border-orange-100 p-5">
            <p className="text-xs text-orange-500 mb-1">Est. Monthly Interest</p>
            <p className="text-2xl font-semibold text-orange-600">{fmt(totalMonthlyInterest)}</p>
          </div>
        )}
      </div>

      {/* Account list */}
      {loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm">
          No accounts yet.{' '}
          <button onClick={() => setShowForm(true)} className="underline hover:text-slate-600">
            Add your first account
          </button>
        </div>
      ) : (
        <div>
          {ACCOUNT_GROUPS.map(group => (
            <AccountGroup
              key={group.label}
              group={group}
              accounts={accounts}
              onReorder={handleGroupReorder}
              onEdit={openEdit}
              onDelete={handleDelete}
              onViewStatement={setStatementAccountId}
              deleting={deleting}
            />
          ))}
        </div>
      )}

      {/* Statement Modal */}
      <StatementModal
        accountId={statementAccountId}
        accounts={accounts}
        onClose={() => setStatementAccountId(null)}
      />

      {/* Add Account Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-slate-800">
                {editingAccount ? 'Edit Account' : 'Add Account'}
              </h3>
              <button onClick={() => { setShowForm(false); setEditingAccount(null) }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Account Name</label>
                <input
                  type="text"
                  placeholder="e.g. Chase Checking"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Account Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['checking', 'savings', 'credit', 'cash', 'loan', 'investment'] as const).map(t => {
                    const Icon = ACCOUNT_ICONS[t]
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => { setFormType(t); setFormApr('') }}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                          formType === t
                            ? 'border-slate-800 bg-slate-800 text-white'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {ACCOUNT_LABELS[t]}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  {(formType === 'credit' || formType === 'loan') ? 'Current Debt (what you owe today)' : 'Current Balance'}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={formBalance}
                    onChange={e => setFormBalance(e.target.value)}
                    className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                  />
                </div>
                {(formType === 'credit' || formType === 'loan') && (
                  <p className="text-xs text-slate-400 mt-1">
                    Enter how much you currently owe. Future charges will increase this.
                  </p>
                )}
              </div>

              {(formType === 'credit' || formType === 'loan') && (
                <div>
                  <label className="block text-xs text-slate-500 mb-1">APR % (optional)</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      placeholder="e.g. 24.99"
                      value={formApr}
                      onChange={e => setFormApr(e.target.value)}
                      className="w-full pr-8 pl-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Used to estimate monthly interest cost. Leave blank if unknown.
                  </p>
                </div>
              )}

              {formType === 'credit' && (
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Credit Limit (optional)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 5000.00"
                      value={formCreditLimit}
                      onChange={e => setFormCreditLimit(e.target.value)}
                      className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Shows a utilization bar on the account card.
                  </p>
                </div>
              )}

              {formError && <p className="text-red-500 text-sm">{formError}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setEditingAccount(null) }}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : editingAccount ? 'Save Changes' : 'Add Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
