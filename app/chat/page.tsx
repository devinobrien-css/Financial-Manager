'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Sparkles, Plus, Trash2, Send, MessageSquare, Loader2, AlertTriangle } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAuth } from '@/lib/auth-context'

// Markdown rendering for assistant messages — styled for the chat bubble + dark mode.
const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 last:mb-0 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 last:mb-0 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="text-base font-semibold mb-1.5 mt-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold mb-1.5 mt-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-1">{children}</h3>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-emerald-600 dark:text-emerald-400">
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-700 font-mono text-[0.85em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 last:mb-0 overflow-x-auto rounded-lg bg-slate-100 dark:bg-slate-900 p-3 text-xs [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-slate-300 dark:border-slate-600 pl-3 italic text-slate-600 dark:text-slate-300 mb-2 last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-slate-200 dark:border-slate-700" />,
  table: ({ children }) => (
    <div className="overflow-x-auto mb-2 last:mb-0">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-slate-300 dark:border-slate-600 px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-slate-200 dark:border-slate-700 px-2 py-1">{children}</td>
  ),
}

interface SessionMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}
interface Msg {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'How much did I spend this month?',
  "What's my current net worth?",
  'Am I over budget in any category?',
  'Break down my income sources this month.',
]

export default function ChatPage() {
  const { state } = useAuth()
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [allowDetail, setAllowDetail] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiUnavailable, setAiUnavailable] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadSessions = useCallback(async () => {
    const r = await fetch('/api/chat/sessions')
    if (r.ok) setSessions(await r.json())
  }, [])

  useEffect(() => {
    if (state === 'unlocked') loadSessions()
  }, [state, loadSessions])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const selectSession = async (id: string) => {
    if (streaming) return
    setActiveId(id)
    setError(null)
    setSuggestions([])
    const r = await fetch(`/api/chat/messages?session=${encodeURIComponent(id)}`)
    if (r.ok) {
      const rows = (await r.json()) as { role: 'user' | 'assistant'; content: string }[]
      setMessages(rows.map((m) => ({ role: m.role, content: m.content })))
    }
  }

  const newChat = () => {
    if (streaming) return
    setActiveId(null)
    setMessages([])
    setError(null)
    setSuggestions([])
  }

  const deleteSession = async (id: string) => {
    await fetch(`/api/chat/sessions?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (activeId === id) newChat()
    loadSessions()
  }

  const appendToLast = (text: string) =>
    setMessages((m) => {
      const copy = [...m]
      const last = copy[copy.length - 1]
      if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + text }
      return copy
    })

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || streaming) return
    setError(null)
    setSuggestions([])
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: message }, { role: 'assistant', content: '' }])
    setStreaming(true)

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeId ?? undefined, message, allowDetail }),
      })

      if (res.status === 503) {
        setAiUnavailable(true)
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'AI is not configured.')
      }
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `Request failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const line = block.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          const evt = JSON.parse(line.slice(6))
          if (evt.type === 'session') {
            setActiveId(evt.session.id)
            loadSessions()
          } else if (evt.type === 'delta') {
            appendToLast(evt.text)
          } else if (evt.type === 'suggestions') {
            setSuggestions(Array.isArray(evt.items) ? evt.items : [])
          } else if (evt.type === 'error') {
            throw new Error(evt.message)
          }
        }
      }
      loadSessions()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong'
      setError(msg)
      // Drop the empty assistant placeholder if nothing streamed.
      setMessages((m) => {
        const last = m[m.length - 1]
        if (last && last.role === 'assistant' && last.content === '') return m.slice(0, -1)
        return m
      })
    } finally {
      setStreaming(false)
    }
  }

  if (state !== 'unlocked') return null

  return (
    <div className="flex h-[calc(100vh-3.5rem)] md:h-screen">
      {/* Sessions sidebar */}
      <div className="hidden sm:flex w-60 shrink-0 flex-col border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="p-3">
          <button
            onClick={newChat}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-slate-800 dark:bg-slate-700 text-white text-sm py-2 hover:bg-slate-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {sessions.length === 0 && (
            <p className="text-xs text-slate-400 px-2 py-3">No conversations yet.</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer transition-colors ${
                activeId === s.id
                  ? 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
              }`}
              onClick={() => selectSession(s.id)}
            >
              <MessageSquare className="w-4 h-4 shrink-0 text-slate-400" />
              <span className="flex-1 truncate">{s.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  deleteSession(s.id)
                }}
                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition"
                aria-label="Delete chat"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-900">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <Sparkles className="w-5 h-5 text-slate-700 dark:text-slate-300" />
          <h1 className="font-semibold text-slate-800 dark:text-slate-100">Finance Assistant</h1>
        </div>

        {aiUnavailable && (
          <div className="m-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              The assistant isn&apos;t configured. Set <code>ANTHROPIC_API_KEY</code> in your
              environment (e.g. <code>.env.local</code>) and restart the server.
            </span>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
          <div className="max-w-2xl mx-auto space-y-4">
            {messages.length === 0 && (
              <div className="text-center pt-10">
                <div className="inline-flex p-3 rounded-full bg-slate-100 dark:bg-slate-800 mb-3">
                  <Sparkles className="w-6 h-6 text-slate-500" />
                </div>
                <p className="text-slate-500 dark:text-slate-400 text-sm mb-5">
                  Ask about your accounts, spending, budgets, or net worth. Your data stays
                  encrypted; only the figures needed to answer are sent to the model.
                </p>
                <div className="grid sm:grid-cols-2 gap-2 max-w-lg mx-auto">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-left text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-600 dark:text-slate-300 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm break-words max-w-[85%] ${
                    m.role === 'user'
                      ? 'bg-slate-800 dark:bg-slate-700 text-white whitespace-pre-wrap'
                      : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {m.role === 'user' ? (
                    m.content
                  ) : m.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {m.content}
                    </ReactMarkdown>
                  ) : streaming && i === messages.length - 1 ? (
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                  ) : (
                    ''
                  )}
                </div>
              </div>
            ))}

            {!streaming && suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-sm rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-slate-600 dark:text-slate-300 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <div className="text-center text-sm text-red-500">{error}</div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 md:px-6 py-3">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send(input)
                  }
                }}
                rows={1}
                placeholder="Ask about your finances…"
                className="flex-1 resize-none rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400 max-h-36"
              />
              <button
                onClick={() => send(input)}
                disabled={streaming || !input.trim()}
                className="rounded-xl bg-slate-800 dark:bg-slate-700 text-white p-2.5 hover:bg-slate-700 disabled:opacity-40 transition-colors"
                aria-label="Send"
              >
                {streaming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            </div>
            <label className="flex items-center gap-2 mt-2 text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allowDetail}
                onChange={(e) => setAllowDetail(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-600"
              />
              Include transaction detail (sends individual transactions for this message, not just
              totals)
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
