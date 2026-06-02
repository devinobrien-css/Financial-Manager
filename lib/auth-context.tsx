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
  changeUsername: (newUsername: string) => Promise<string | null>
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('checking')
  const [username, setUsername] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const checkStatus = async (attempt = 0): Promise<void> => {
      try {
        const r = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status' }),
        })
        if (cancelled) return
        const data = await r.json()
        if (data.loggedIn) { setState('unlocked'); setUsername(data.username ?? null) } else { setState('needs-login') }
      } catch {
        if (cancelled) return
        // Retry once after 2 s (handles cold-start / transient network errors)
        if (attempt === 0) {
          setTimeout(() => { if (!cancelled) checkStatus(1) }, 2000)
        } else {
          setState('needs-login')
        }
      }
    }

    checkStatus()
    return () => { cancelled = true }
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

  const changeUsername = async (newUsername: string): Promise<string | null> => {
    const res = await fetch('/api/auth', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'change-username', newUsername }),
    })
    const data = await res.json()
    if (res.ok) { setUsername(data.username); return null }
    return data.error ?? 'Failed to update username'
  }

  const changePassword = async (currentPassword: string, newPassword: string): Promise<string | null> => {
    const res = await fetch('/api/auth', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'change-password', currentPassword, newPassword }),
    })
    const data = await res.json()
    if (res.ok) return null
    return data.error ?? 'Failed to update password'
  }

  return (
    <AuthContext.Provider value={{ state, username, login, register, lock, changeUsername, changePassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
