'use client'

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Plus, X, Trash2, CheckCircle2, Circle, Pencil, GripHorizontal } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useAuth } from '@/lib/auth-context'

interface Goal {
  id: string
  title: string
  notes: string | null
  target_amount: number | null
  saved_amount: number | null
  target_date: string | null
  color: string
  completed: boolean
  created_at: string
}

const STORAGE_KEY = 'goals-board-positions'
function loadPositions(): Record<string, { x: number; y: number }> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') } catch { return {} }
}

const COLOR_ACCENTS: Record<string, { border: string; dot: string }> = {
  blue:   { border: 'border-l-blue-400',    dot: 'bg-blue-400' },
  green:  { border: 'border-l-emerald-400', dot: 'bg-emerald-400' },
  yellow: { border: 'border-l-yellow-400',  dot: 'bg-yellow-400' },
  red:    { border: 'border-l-red-400',     dot: 'bg-red-400' },
}
const COLOR_KEYS = Object.keys(COLOR_ACCENTS)

function fmt(n: number) { return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) }
function fmtDate(iso: string) { return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }

// ─── Goal Card ───────────────────────────────────────────────────────────────

function GoalCard({ goal, x, y, isDragging, onHandlePointerDown, onToggle, onEdit, onDelete }: {
  goal: Goal; x: number; y: number; isDragging: boolean
  onHandlePointerDown: React.PointerEventHandler<HTMLDivElement>
  onToggle: (g: Goal) => void; onEdit: () => void; onDelete: (id: string) => void
}) {
  const accent = COLOR_ACCENTS[goal.color] ?? COLOR_ACCENTS.blue
  const isOverdue = goal.target_date && !goal.completed && new Date(goal.target_date + 'T00:00:00') < new Date()
  const hasSavings = goal.target_amount != null && goal.saved_amount != null
  const savingsPct = hasSavings ? Math.min((goal.saved_amount! / goal.target_amount!) * 100, 100) : null
  return (
    <div className="w-56 group select-none" style={{ position: 'absolute', left: x, top: y, zIndex: isDragging ? 50 : 1, opacity: goal.completed ? 0.5 : 1 }}>
      <div className={`bg-white rounded-xl border border-slate-200 border-l-4 ${accent.border} shadow-sm`}>
        <div
          className="px-3 py-2 flex items-center justify-between border-b border-slate-100"
          onPointerDown={onHandlePointerDown}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <div className={`w-2 h-2 rounded-full ${accent.dot}`} />
          <GripHorizontal className="w-3.5 h-3.5 text-slate-300" />
        </div>
        <div className="px-4 pt-3 pb-2 flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <button onClick={() => onToggle(goal)} className="shrink-0 mt-0.5 text-slate-400 hover:text-slate-600 transition-colors">
              {goal.completed ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
            </button>
            <p className={`flex-1 text-sm font-medium text-slate-800 leading-snug break-words ${goal.completed ? 'line-through text-slate-400' : ''}`}>
              {goal.title}
            </p>
          </div>
          {goal.notes && <p className="text-xs text-slate-500 leading-relaxed line-clamp-3 ml-6">{goal.notes}</p>}
          {(goal.target_amount != null || goal.target_date) && (
            <div className="flex flex-wrap gap-1 ml-6">
              {goal.target_amount != null && (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                  {goal.saved_amount != null ? `${fmt(goal.saved_amount)} / ` : ''}{fmt(goal.target_amount)}
                </span>
              )}
              {goal.target_date && <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${isOverdue ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}`}>{isOverdue ? '⚠ ' : ''}{fmtDate(goal.target_date)}</span>}
            </div>
          )}
          {savingsPct !== null && (
            <div className="ml-6">
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${savingsPct}%`, backgroundColor: savingsPct >= 100 ? '#22c55e' : accent.dot.replace('bg-', '') === 'blue-400' ? '#60a5fa' : '#a3e635' }}
                />
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{Math.round(savingsPct)}% saved</p>
            </div>
          )}
        </div>
        <div className="px-4 pb-3 flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 transition-colors"><Pencil className="w-3 h-3" /> Edit</button>
          <button onClick={() => onDelete(goal.id)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-600 transition-colors"><Trash2 className="w-3 h-3" /> Remove</button>
        </div>
      </div>
    </div>
  )
}

// ─── Goal Form ────────────────────────────────────────────────────────────────

function GoalForm({ initial, onSave, onClose }: {
  initial: Goal | null
  onSave: (d: { title: string; notes: string; target_amount: string; saved_amount: string; target_date: string; color: string }) => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [amount, setAmount] = useState(initial?.target_amount != null ? String(initial.target_amount) : '')
  const [savedAmount, setSavedAmount] = useState(initial?.saved_amount != null ? String(initial.saved_amount) : '')
  const [date, setDate] = useState(initial?.target_date ?? '')
  const [color, setColor] = useState(initial?.color ?? 'blue')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true)
    await onSave({ title, notes, target_amount: amount, saved_amount: savedAmount, target_date: date, color })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">{initial ? 'Edit Goal' : 'Add Goal'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <p className="text-xs font-medium text-slate-500 mb-2">Color Label</p>
              <div className="flex gap-2">
                {COLOR_KEYS.map(c => (
                  <button key={c} type="button" onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full ${COLOR_ACCENTS[c].dot} border-2 transition-transform ${color === c ? 'border-slate-700 scale-110' : 'border-transparent'}`} />
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Title</label>
              <input type="text" placeholder="e.g. Pay off Chase Freedom" value={title} onChange={e => setTitle(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" autoFocus required />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Notes (optional)</label>
              <textarea placeholder="Strategy, motivation, steps..." value={notes} onChange={e => setNotes(e.target.value)}
                rows={3} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Target Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                  <input type="number" step="0.01" min="0" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}
                    className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Amount Saved</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                  <input type="number" step="0.01" min="0" placeholder="0.00" value={savedAmount} onChange={e => setSavedAmount(e.target.value)}
                    className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Target Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors">
                {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add Goal'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ─── Goals Page ───────────────────────────────────────────────────────────────

export default function GoalsPage() {
  const { lock } = useAuth()
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null)
  const [confirmGoal, setConfirmGoal] = useState<Goal | null>(null)
  const [deleting, setDeleting] = useState(false)
  const boardRef = useRef<HTMLDivElement>(null)
  const posInitialized = useRef(false)

  const loadGoals = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/plans')
    if (!res.ok) { const d = await res.json().catch(() => ({})); if (d.error === 'LOCKED') lock(); setLoading(false); return }
    setGoals(await res.json())
    setLoading(false)
  }, [lock])

  useEffect(() => { loadGoals() }, [loadGoals])
  useEffect(() => { setPositions(loadPositions()) }, [])

  useEffect(() => {
    if (!posInitialized.current) { posInitialized.current = true; return }
    if (!dragging) localStorage.setItem(STORAGE_KEY, JSON.stringify(positions))
  }, [dragging, positions])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      const board = boardRef.current
      if (!board) return
      const rect = board.getBoundingClientRect()
      const x = Math.max(0, Math.min(e.clientX - rect.left - dragging.ox, rect.width - 240))
      const y = Math.max(0, e.clientY - rect.top - dragging.oy)
      setPositions(prev => ({ ...prev, [dragging.id]: { x, y } }))
    }
    const onUp = () => setDragging(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [dragging])

  const handleDragStart = useCallback((id: string, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const board = boardRef.current
    if (!board) return
    const rect = board.getBoundingClientRect()
    const idx = goals.findIndex(g => g.id === id)
    const pos = positions[id] ?? { x: (idx % 4) * 240 + 16, y: Math.floor(idx / 4) * 220 + 16 }
    setDragging({ id, ox: e.clientX - rect.left - pos.x, oy: e.clientY - rect.top - pos.y })
  }, [goals, positions])

  const boardMinHeight = useMemo(() => {
    let max = 320
    goals.forEach((g, i) => {
      const p = positions[g.id] ?? { x: (i % 4) * 240 + 16, y: Math.floor(i / 4) * 220 + 16 }
      max = Math.max(max, p.y + 240)
    })
    return max
  }, [goals, positions])

  const handleGoalSave = async (data: { title: string; notes: string; target_amount: string; saved_amount: string; target_date: string; color: string }) => {
    const isEdit = editingGoal !== null
    const payload = {
      title: data.title, notes: data.notes,
      target_amount: data.target_amount ? Number.parseFloat(data.target_amount) : null,
      saved_amount: data.saved_amount ? Number.parseFloat(data.saved_amount) : null,
      target_date: data.target_date || null,
      color: data.color,
      ...(isEdit ? { id: editingGoal.id } : {}),
    }
    const res = await fetch('/api/plans', { method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) { const d = await res.json().catch(() => ({})); if (d.error === 'LOCKED') lock(); return }
    setShowGoalForm(false); setEditingGoal(null); loadGoals()
  }

  const toggleGoalComplete = async (goal: Goal) => {
    await fetch('/api/plans', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: goal.id, completed: !goal.completed }) })
    loadGoals()
  }

  const deleteGoal = async (id: string) => {
    setDeleting(true)
    await fetch('/api/plans', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setDeleting(false)
    setConfirmGoal(null)
    loadGoals()
  }

  const requestDeleteGoal = (id: string) => {
    const g = goals.find(x => x.id === id)
    if (g) setConfirmGoal(g)
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-semibold text-slate-800">Goals</h2>
          <p className="text-sm text-slate-500 mt-1">Track and organize your financial goals. Drag to rearrange.</p>
        </div>
        <button
          onClick={() => { setEditingGoal(null); setShowGoalForm(true) }}
          className="flex items-center gap-2 bg-slate-800 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Goal
        </button>
      </div>

      <div
        ref={boardRef}
        className="rounded-xl border border-slate-200"
        style={{
          position: 'relative',
          minHeight: boardMinHeight,
          backgroundImage: 'radial-gradient(circle, #e2e8f0 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          backgroundColor: '#f8fafc',
          cursor: dragging ? 'grabbing' : 'default',
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center text-slate-400 text-sm" style={{ minHeight: 200 }}>Loading…</div>
        ) : goals.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-slate-400" style={{ minHeight: 200 }}>
            <p className="text-sm mb-2">No goals yet.</p>
            <button onClick={() => { setEditingGoal(null); setShowGoalForm(true) }} className="text-sm underline hover:text-slate-600 transition-colors">Add your first goal</button>
          </div>
        ) : (
          goals.map((goal, i) => {
            const pos = positions[goal.id] ?? { x: (i % 4) * 240 + 16, y: Math.floor(i / 4) * 220 + 16 }
            return (
              <GoalCard
                key={goal.id}
                goal={goal}
                x={pos.x}
                y={pos.y}
                isDragging={dragging?.id === goal.id}
                onHandlePointerDown={e => handleDragStart(goal.id, e)}
                onToggle={toggleGoalComplete}
                onEdit={() => { setEditingGoal(goal); setShowGoalForm(true) }}
                onDelete={requestDeleteGoal}
              />
            )
          })
        )}
      </div>

      {showGoalForm && (
        <GoalForm initial={editingGoal} onSave={handleGoalSave} onClose={() => { setShowGoalForm(false); setEditingGoal(null) }} />
      )}

      <ConfirmDialog
        open={confirmGoal !== null}
        title="Remove this goal?"
        message={confirmGoal ? <>This will permanently remove <strong>{confirmGoal.title}</strong>. This cannot be undone.</> : ''}
        confirmLabel="Remove"
        loading={deleting}
        onConfirm={() => confirmGoal && deleteGoal(confirmGoal.id)}
        onCancel={() => setConfirmGoal(null)}
      />
    </div>
  )
}
