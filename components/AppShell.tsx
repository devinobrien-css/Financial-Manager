'use client'

import { ReactNode, useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { LockKeyhole, LayoutDashboard, ListOrdered, LogOut, Wallet, Target, Flag, BarChart2, Sun, Moon, TrendingUp, ShieldCheck } from 'lucide-react'

function LoginScreen() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [registrationCode, setRegistrationCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username.trim()) { setError('Username is required'); return }
    if (mode === 'register') {
      if (password !== confirmPassword) { setError('Passwords do not match'); return }
      if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    }
    setLoading(true)
    const err = mode === 'register'
      ? await register(username, password, registrationCode || undefined)
      : await login(username, password)
    setLoading(false)
    if (err) setError(err)
  }

  const switchMode = (next: 'login' | 'register') => {
    setMode(next); setError(''); setPassword(''); setConfirmPassword('')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <div className="bg-slate-100 rounded-full p-4">
            <LockKeyhole className="w-8 h-8 text-slate-600" />
          </div>
        </div>
        <h1 className="text-xl font-semibold text-center text-slate-800 mb-1">Financial Manager</h1>
        <p className="text-sm text-slate-500 text-center mb-6">
          {mode === 'login' ? 'Sign in to access your encrypted data.' : 'Create an account. All data is encrypted with your password.'}
        </p>

        {/* Mode tabs */}
        <div className="flex rounded-lg bg-slate-100 p-0.5 mb-5">
          {(['login', 'register'] as const).map(m => (
            <button key={m} type="button" onClick={() => switchMode(m)}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                mode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {m === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            autoFocus
            autoCapitalize="none"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          {mode === 'register' && (
            <>
              <input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
              <input
                type="text"
                placeholder="Registration code (if required)"
                value={registrationCode}
                onChange={e => setRegistrationCode(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </>
          )}
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Working…' : mode === 'login' ? 'Sign In' : 'Create Account & Enter'}
          </button>
        </form>
      </div>
    </div>
  )
}

const navGroups = [
  {
    label: 'Overview',
    items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Manage',
    items: [
      { href: '/accounts', label: 'Accounts', icon: Wallet },
      { href: '/transactions', label: 'Transactions', icon: ListOrdered },
      { href: '/reports', label: 'Reports', icon: BarChart2 },
    ],
  },
  {
    label: 'Plan',
    items: [
      { href: '/planning', label: 'Planning', icon: Target },
      { href: '/goals', label: 'Goals', icon: Flag },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/wealth', label: 'Wealth', icon: TrendingUp },
      { href: '/credit', label: 'Credit Health', icon: ShieldCheck },
    ],
  },
]

export function AppShell({ children }: { children: ReactNode }) {
  const { state, username, lock } = useAuth()
  const pathname = usePathname()
  const [darkMode, setDarkMode] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('dark-mode')
    if (stored === 'true') { setDarkMode(true); document.documentElement.classList.add('dark') }
  }, [])

  const toggleDark = () => {
    setDarkMode(prev => {
      const next = !prev
      document.documentElement.classList.toggle('dark', next)
      localStorage.setItem('dark-mode', String(next))
      return next
    })
  }

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
        Loading…
      </div>
    )
  }

  if (state === 'needs-login') {
    return <LoginScreen />
  }

  return (
    <div className="min-h-screen">
      {/* Sidebar */}
      <aside className="fixed top-0 left-0 h-screen w-56 bg-slate-900 text-slate-300 flex flex-col py-6 px-4 pb-14 z-40">
        <div className="mb-8 px-2">
          <h1 className="text-white font-semibold text-base">Finance</h1>
          <p className="text-slate-500 text-xs mt-0.5">{username ?? 'Loading…'}</p>
        </div>
        <nav className="flex-1 space-y-5">
          {navGroups.map(({ label, items }) => (
            <div key={label}>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 px-3 mb-1">{label}</p>
              <div className="space-y-0.5">
                {items.map(({ href, label: itemLabel, icon: Icon }) => {
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
                      {itemLabel}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
        <button
          onClick={toggleDark}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors mt-2"
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {darkMode ? 'Light Mode' : 'Dark Mode'}
        </button>
        <button
          onClick={lock}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-white transition-colors mt-2"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </aside>

      {/* Main */}
      <main className="ml-56 min-h-screen bg-slate-50 dark:bg-slate-900">
        {children}
      </main>
    </div>
  )
}
