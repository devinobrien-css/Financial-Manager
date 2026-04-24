'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

type AuthState = 'checking' | 'needs-setup' | 'locked' | 'unlocked'

interface AuthContextValue {
  state: AuthState
  unlock: (password: string) => Promise<string | null>
  setup: (password: string) => Promise<string | null>
  lock: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('checking')

  useEffect(() => {
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status', password: '' }),
    })
      .then(r => r.json())
      .then(data => {
        setState(data.isSetUp ? 'locked' : 'needs-setup')
      })
      .catch(() => setState('locked'))
  }, [])

  const setup = async (password: string): Promise<string | null> => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setup', password }),
    })
    const data = await res.json()
    if (res.ok) { setState('unlocked'); return null }
    return data.error ?? 'Setup failed'
  }

  const unlock = async (password: string): Promise<string | null> => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unlock', password }),
    })
    const data = await res.json()
    if (res.ok) { setState('unlocked'); return null }
    return data.error ?? 'Unlock failed'
  }

  const lock = async () => {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lock', password: '' }),
    })
    setState('locked')
  }

  return (
    <AuthContext.Provider value={{ state, unlock, setup, lock }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
