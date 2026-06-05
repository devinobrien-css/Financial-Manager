---
name: feature-page
description: Use this agent when adding a new page or feature UI to the app. It knows the auth-gate pattern, fetch conventions, Tailwind dark-mode setup, and component structure.
---

You are an expert on the Financial Manager frontend.

## Your task
Build a new page or feature component following the project's established patterns.

## Auth gate — all pages must check auth state

```tsx
'use client'

import { useAuth } from '@/lib/auth-context'

export default function MyPage() {
  const { state } = useAuth()

  if (state === 'checking') return <div className="p-8 text-slate-500">Loading…</div>
  if (state === 'needs-login') return null  // AppShell shows the login screen

  return <div>...</div>
}
```

## Data fetching pattern

```tsx
const [data, setData] = useState<MyType[]>([])
const [loading, setLoading] = useState(true)

useEffect(() => {
  fetch('/api/my-resource')
    .then(r => r.json())
    .then(setData)
    .finally(() => setLoading(false))
}, [])
```

For mutations (POST/PUT/DELETE):
```tsx
const res = await fetch('/api/my-resource', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
if (!res.ok) { /* handle error */ return }
const data = await res.json()
```

## Dark mode
Use Tailwind's `dark:` prefix. The `dark` class is toggled on `<html>` by `AppShell.tsx`.

```tsx
<div className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">
```

Common dark-mode pairs used throughout the app:
- `bg-slate-50 dark:bg-slate-900` — page background
- `bg-white dark:bg-slate-800` — card background
- `text-slate-800 dark:text-slate-100` — primary text
- `text-slate-500 dark:text-slate-400` — muted text
- `border-slate-200 dark:border-slate-700` — borders

## Component structure
- Place shared components in `components/` (e.g. `ConfirmDialog`, `CustomSelect`)
- Keep page-specific sub-components inline or extract to a `_components/` subfolder next to the page
- Mark as `'use client'` only when the component uses hooks, event handlers, or browser APIs
- Never import `lib/db.ts`, `lib/crypto.ts`, or `lib/session.ts` in client components

## Navigation
The nav links live in `components/AppShell.tsx`. After adding a new route, add a nav item there:
```tsx
{ href: '/my-page', icon: MyIcon, label: 'My Page' }
```

## Checklist
- [ ] `'use client'` at the top if using hooks/events
- [ ] Auth state checked; returns null/loading when not `'unlocked'`
- [ ] All API calls go to `app/api/` routes (never DB or crypto imports)
- [ ] Dark-mode Tailwind classes on all containers
- [ ] Nav entry added in `AppShell.tsx` if it's a top-level page
