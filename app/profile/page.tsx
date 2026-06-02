'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { User, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react'

type Status = { type: 'success' | 'error'; message: string } | null

export default function ProfilePage() {
  const { username, changeUsername, changePassword, lock } = useAuth()

  // ── Username form ──────────────────────────────────────────────────────────
  const [newUsername, setNewUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<Status>(null)
  const [savingUsername, setSavingUsername] = useState(false)
  const usernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (username) setNewUsername(username)
  }, [username])

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUsername.trim() || newUsername.trim() === username) return
    setSavingUsername(true)
    setUsernameStatus(null)
    const err = await changeUsername(newUsername.trim())
    setSavingUsername(false)
    setUsernameStatus(err ? { type: 'error', message: err } : { type: 'success', message: 'Username updated.' })
  }

  // ── Password form ──────────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordStatus, setPasswordStatus] = useState<Status>(null)
  const [savingPassword, setSavingPassword] = useState(false)

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ type: 'error', message: 'New passwords do not match.' })
      return
    }
    if (newPassword.length < 8) {
      setPasswordStatus({ type: 'error', message: 'Password must be at least 8 characters.' })
      return
    }
    setSavingPassword(true)
    setPasswordStatus(null)
    const err = await changePassword(currentPassword, newPassword)
    setSavingPassword(false)
    if (err) {
      setPasswordStatus({ type: 'error', message: err })
    } else {
      setPasswordStatus({ type: 'success', message: 'Password updated successfully.' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="max-w-2xl">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-slate-800">Profile & Settings</h2>
        <p className="text-sm text-slate-500 mt-1">Manage your account details and security settings.</p>
      </div>

      {/* Username */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
            <User className="w-4.5 h-4.5 text-slate-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Username</h3>
            <p className="text-xs text-slate-500">Change your display name</p>
          </div>
        </div>
        <form onSubmit={handleUsernameSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Username</label>
            <input
              ref={usernameRef}
              type="text"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              autoCapitalize="none"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              required
            />
          </div>
          {usernameStatus && (
            <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
              usernameStatus.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-100'
                : 'bg-red-50 text-red-600 border border-red-100'
            }`}>
              {usernameStatus.type === 'success'
                ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                : <AlertCircle className="w-4 h-4 shrink-0" />}
              {usernameStatus.message}
            </div>
          )}
          <button
            type="submit"
            disabled={savingUsername || !newUsername.trim() || newUsername.trim() === username}
            className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
          >
            {savingUsername ? 'Saving…' : 'Save Username'}
          </button>
        </form>
      </div>

      {/* Password */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
            <KeyRound className="w-4.5 h-4.5 text-slate-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Change Password</h3>
            <p className="text-xs text-slate-500">Your password also encrypts all of your financial data</p>
          </div>
        </div>
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              required
              minLength={8}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              required
            />
          </div>
          {passwordStatus && (
            <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
              passwordStatus.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-100'
                : 'bg-red-50 text-red-600 border border-red-100'
            }`}>
              {passwordStatus.type === 'success'
                ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                : <AlertCircle className="w-4 h-4 shrink-0" />}
              {passwordStatus.message}
            </div>
          )}
          <button
            type="submit"
            disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
            className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
          >
            {savingPassword ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>

      {/* Danger zone */}
      <div className="bg-white rounded-2xl border border-red-100 p-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Sign Out</h3>
        <p className="text-xs text-slate-500 mb-4">Locks your data and ends the current session.</p>
        <button
          onClick={lock}
          className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors"
        >
          Sign Out
        </button>
      </div>
      </div>
    </div>
  )
}
