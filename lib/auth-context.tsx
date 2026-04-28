'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

// 'needs-login' covers both "no account yet" and "session expired"
type AuthState = 'checking' | 'needs-login' | 'unlocked'

interface AuthContextValue {
  state: AuthState
  username: string | null
  login: (username: string, password: string) => Promise<string | null>
  register: (username: string, password: string, code?: string) => Promise<string | null>
  lock: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('checking')
  const [username, setUsername] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.loggedIn) { setState('unlocked') } else { setState('needs-login') }
      })
      .catch(() => setState('needs-login'))
  }, [])

  const login = async (user: string, password: string): Promise<string | null> => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', username: user, password }),
    })
    const data = await res.json()
    if (res.ok) { setState('unlocked'); setUsername(data.username); return null }
    return data.error ?? 'Login failed'
  }

  const register = async (user: string, password: string, code?: string): Promise<string | null> => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register', username: user, password, registrationCode: code }),
    })
    const data = await res.json()
    if (res.ok) { setState('unlocked'); setUsername(data.username); return null }
    return data.error ?? 'Registration failed'
  }

  const lock = async () => {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lock' }),
    })
    setState('needs-login')
    setUsername(null)
  }

  return (
    <AuthContext.Provider value={{ state, username, login, register, lock }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
