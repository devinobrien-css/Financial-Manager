'use client'

import { ReactNode, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { LockKeyhole, LayoutDashboard, ListOrdered, LogOut, Wallet, Target, Flag } from 'lucide-react'

function LockScreen() {
  const { state, unlock, setup } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const isSetup = state === 'needs-setup'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (isSetup && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (isSetup && password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    const err = isSetup ? await setup(password) : await unlock(password)
    setLoading(false)
    if (err) setError(err)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <div className="bg-slate-100 rounded-full p-4">
            <LockKeyhole className="w-8 h-8 text-slate-600" />
          </div>
        </div>
        <h1 className="text-xl font-semibold text-center text-slate-800 mb-1">
          {isSetup ? 'Create Your Password' : 'Unlock Financial Manager'}
        </h1>
        <p className="text-sm text-slate-500 text-center mb-6">
          {isSetup
            ? 'Your password encrypts all financial data locally.'
            : 'Enter your password to decrypt and access your data.'}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            autoFocus
          />
          {isSetup && (
            <input
              type="password"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          )}
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Working…' : isSetup ? 'Set Password & Enter' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  )
}

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/accounts', label: 'Accounts', icon: Wallet },
  { href: '/transactions', label: 'Transactions', icon: ListOrdered },
  { href: '/planning', label: 'Planning', icon: Target },
  { href: '/goals', label: 'Goals', icon: Flag },
]

export function AppShell({ children }: { children: ReactNode }) {
  const { state, lock } = useAuth()
  const pathname = usePathname()

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
        Loading…
      </div>
    )
  }

  if (state === 'needs-setup' || state === 'locked') {
    return <LockScreen />
  }

  return (
    <div className="min-h-screen">
      {/* Sidebar */}
      <aside className="fixed top-0 left-0 h-screen w-56 bg-slate-900 text-slate-300 flex flex-col py-6 px-4 pb-14 z-40">
        <div className="mb-8 px-2">
          <h1 className="text-white font-semibold text-base">Finance</h1>
          <p className="text-slate-500 text-xs mt-0.5">Local · Encrypted</p>
        </div>
        <nav className="flex-1 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-slate-700 text-white'
                    : 'hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>
        <button
          onClick={lock}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors mt-2"
        >
          <LogOut className="w-4 h-4" />
          Lock
        </button>
      </aside>

      {/* Main */}
      <main className="ml-56 min-h-screen">
        {children}
      </main>
    </div>
  )
}
