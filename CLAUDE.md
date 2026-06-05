# Financial Manager — CLAUDE.md

Local-first personal finance tracker. **All financial data is encrypted at rest** using AES-256-GCM with a key derived from the user's password. There is no remote database; everything lives in per-user SQLite files on disk.

---

## Quick Start

```bash
npm install
npm run dev        # http://localhost:3000
```

### Environment variables (`.env.local`)
| Variable | Default | Notes |
|---|---|---|
| `SESSION_SECRET` | `dev-only-secret-change-in-production` | **Must** be changed in production |
| `REGISTRATION_CODE` | _(unset)_ | If set, required at account creation |
| `ANTHROPIC_API_KEY` | _(unset)_ | Required for the AI assistant (`/chat`). If unset, the chat page shows a "not configured" notice. |

### Docker
```bash
docker compose up --build
```

### Migration (old single-user → multi-user)
```bash
node migrate.mjs <username> <password>
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router), React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 |
| Database | better-sqlite3 (SQLite, per-user file) |
| Charts | Recharts |
| Drag & drop | @dnd-kit |
| Icons | lucide-react |

---

## Architecture

### Data storage — per-user encrypted SQLite
```
data/
  _users.db               # unencrypted registry: username → UUID
  users/
    {userId}/
      finance.db          # per-user DB — all sensitive fields encrypted
```

- `lib/user-db.ts` — reads/writes `_users.db` (username ↔ UUID)
- `lib/db.ts` — opens per-user `finance.db`, runs schema migrations, exposes `getDb(userId)`
- `lib/crypto.ts` — `encrypt` / `decrypt` (AES-256-GCM), `deriveKey` (PBKDF2, 310 000 iterations), `makeVerifier` / `verifyKey`

### Session — stateless cookie
- No server-side session store. The `userId` and AES key are themselves AES-GCM-encrypted inside the cookie, then HMAC-signed.
- `lib/session.ts` — `createSession`, `verifyAndGetSession`, `destroySession`
- `lib/server-session.ts` — `getServerSession()` — reads the cookie and returns `{ userId, key, db }` or `null`

**Every API route must call `getServerSession()` first and return 401 if null.**

### Authentication flow
1. Password → `deriveKey(password, salt)` → 256-bit AES key
2. Key is stored **only** in the signed cookie (never on disk in plaintext)
3. The `auth` table holds `salt` + an encrypted verifier; the verifier lets the server confirm the key is correct on login without storing the raw key

### Schema migrations
`lib/db.ts` uses `PRAGMA user_version` for versioning. Each migration function (`migrateToV1` … `migrateToVN`) checks the version, runs DDL, then bumps the version. Currently at **v15**.

---

## Project Structure

```
app/
  layout.tsx              # Root layout: AuthProvider + AppShell
  page.tsx                # Dashboard (charts, month selector, quick-add)
  accounts/               # Account list + detail pages
  transactions/           # Transaction list + filters
  spending/               # Spending breakdown / budget tracking
  wealth/                 # Net-worth over time
  planning/               # Budget / savings plans
  credit/                 # Credit score + pay-in-full tracker
  goals/                  # Financial goals
  chat/                   # AI finance assistant (streaming chat UI)
  reports/                # Custom reports
  profile/                # Username / password change, data export
  api/
    auth/route.ts         # login, register, lock, status, changeUsername, changePassword
    accounts/route.ts     # CRUD accounts
    transactions/route.ts # CRUD transactions (with month/account filters)
    categories/route.ts   # CRUD categories
    plans/route.ts        # Budget plans
    recurring/route.ts    # Recurring transactions
    forecast/route.ts     # Cash-flow forecast
    net-worth/route.ts    # Net-worth history
    credit-score/route.ts # Credit score log
    pay-in-full/route.ts  # Pay-in-full targets
    chat/
      sessions/route.ts   # List / create / rename / delete chat sessions
      messages/route.ts   # Fetch a session's messages
      stream/route.ts     # SSE streaming: guard+classify → finance lookup → generator
components/
  AppShell.tsx            # Nav sidebar + login screen + dark mode toggle
  ConfirmDialog.tsx       # Reusable confirm modal
  CustomSelect.tsx        # Styled select input
lib/
  auth-context.tsx        # Client-side AuthContext (state: checking|needs-login|unlocked)
  crypto.ts               # AES-256-GCM encrypt/decrypt + PBKDF2 key derivation
  db.ts                   # getDb(userId) + schema init + all migrations
  session.ts              # Stateless signed cookie helpers
  server-session.ts       # getServerSession() — use in every API route
  user-db.ts              # Username ↔ UUID registry
  ai/
    client.ts             # Anthropic client + model constants (ANTHROPIC_API_KEY)
    pipeline.ts           # Streamlined pipeline: classifyAndGuard() + streamAnswer()
    finance-context.ts    # Decrypts DB → aggregate (+ opt-in detail) context for the model
    chat-store.ts         # Encrypted chat_sessions / chat_messages CRUD
```

### AI assistant (`/chat`)
- **Privacy:** the only place decrypted financial data leaves the device. By default only **aggregates** (balances, category totals, budget status, net worth) are sent to Anthropic; row-level transaction detail is sent only when the user enables the per-message "Include transaction detail" toggle.
- **Streamlined 2-call pipeline:** (1) `classifyAndGuard()` gates unsafe/off-topic requests and picks which finance lookups are needed; (2) `streamAnswer()` streams the response with the decrypted aggregates injected into the system prompt. The reference design's reviewer agents are intentionally omitted.
- Chat history is persisted encrypted (`title_enc`, `content_enc`) in the per-user `finance.db`.

---

## Coding Conventions

### API routes
- Import `getServerSession` from `@/lib/server-session`; return 401 on null immediately
- Import `encrypt`/`decrypt` from `@/lib/crypto`; never store plaintext financial values
- Use `uuidv4()` for new entity IDs (accounts, transactions, etc.)
- Wrap multi-step writes in `db.transaction(() => { ... })()`

### Sensitive fields
The following fields are **always** stored encrypted (suffix `_enc`):
- `amount_enc`, `description_enc`, `memo_enc` (transactions)
- `name_enc`, `opening_balance_enc`, `apr_enc`, `credit_limit_enc` (accounts)
- `balance_enc` (net-worth snapshots)
- `target_enc`, `current_enc` (goals)

Never add a plaintext column for a value that belongs to the list above.

### DB migrations
- Add a new `migrateToVN(db)` function at the bottom of `lib/db.ts`
- Check `PRAGMA user_version` at the top of the function and return early if already applied
- Bump `PRAGMA user_version = N` at the end
- Call `migrateToVN(db)` inside `initSchema`
- See `.claude/skills/add-migration.md` for a step-by-step template

### Client components
- Mark with `'use client'` only when needed (event handlers, hooks, browser APIs)
- Fetch data via the `app/api/` routes — never import `lib/db.ts` or `lib/crypto.ts` in client code
- Use `useAuth()` from `@/lib/auth-context` to check auth state; redirect or show login if `state !== 'unlocked'`

### Tailwind
- Dark mode is toggled via a `dark` class on `<html>` (managed in `AppShell.tsx`)
- Prefer Tailwind utility classes; avoid inline styles

---

## Security Notes

- `SESSION_SECRET` must be a random 32+ character string in production
- `REGISTRATION_CODE` should be set if the instance is public-facing
- Never log decrypted financial values
- Cookie flags: `httpOnly: true`, `sameSite: 'lax'`, `secure: true` in production
- Foreign keys are enforced (`PRAGMA foreign_keys = ON`)

---

## Useful Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `node migrate.mjs <user> <pass>` | One-time single→multi user migration |
| `node seed-demo.mjs` | Seed a demo account with sample data |
