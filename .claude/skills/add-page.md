# Skill: Add a Feature Page

Use this skill when adding a new route/page to the app.

---

## Step 1 — Create the page file

```
app/<route>/page.tsx
```

## Step 2 — Auth gate (required on every page)

```tsx
'use client'

import { useAuth } from '@/lib/auth-context'

export default function MyPage() {
  const { state } = useAuth()

  if (state === 'checking') {
    return <div className="p-8 text-slate-500 dark:text-slate-400">Loading…</div>
  }
  if (state === 'needs-login') return null  // AppShell renders the login screen

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* page content */}
    </div>
  )
}
```

## Step 3 — Standard data-fetch pattern

```tsx
const [items, setItems] = useState<MyItem[]>([])
const [loading, setLoading] = useState(true)

useEffect(() => {
  fetch('/api/my-resource')
    .then(r => r.json())
    .then(setData)
    .finally(() => setLoading(false))
}, [])
```

Loading skeleton:
```tsx
if (loading) {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-14 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
      ))}
    </div>
  )
}
```

## Step 4 — Add a nav link in AppShell

Open `components/AppShell.tsx` and add an entry to the `navItems` array:

```tsx
{ href: '/my-route', icon: MyIcon, label: 'My Label' },
```

Pick an icon from `lucide-react`. Import it at the top of the file.

## Step 5 — Dark mode

Use Tailwind `dark:` variants consistently:

| Element | Light | Dark |
|---|---|---|
| Page bg | `bg-slate-50` | `dark:bg-slate-900` |
| Card bg | `bg-white` | `dark:bg-slate-800` |
| Primary text | `text-slate-800` | `dark:text-slate-100` |
| Muted text | `text-slate-500` | `dark:text-slate-400` |
| Border | `border-slate-200` | `dark:border-slate-700` |
| Input | `bg-white border-slate-200` | `dark:bg-slate-700 dark:border-slate-600` |

## Step 6 — Mutation pattern

```tsx
const handleSave = async () => {
  const res = await fetch('/api/my-resource', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field: value }),
  })
  if (!res.ok) {
    const err = await res.json()
    setError(err.error ?? 'Something went wrong')
    return
  }
  // Refresh list
  setItems(prev => [...prev, await res.json()])
}
```

For deletes, use `ConfirmDialog` from `components/ConfirmDialog.tsx`:
```tsx
import { ConfirmDialog } from '@/components/ConfirmDialog'

<ConfirmDialog
  open={confirmOpen}
  message="Delete this item? This cannot be undone."
  onConfirm={handleDelete}
  onCancel={() => setConfirmOpen(false)}
/>
```

---

## Checklist
- [ ] `'use client'` at the top
- [ ] Auth state checked; returns null when `needs-login`
- [ ] Tailwind dark-mode classes on all containers
- [ ] Nav entry added in `AppShell.tsx`
- [ ] No imports from `lib/db.ts`, `lib/crypto.ts`, or `lib/session.ts`
- [ ] Mutations reload/update local state after success
