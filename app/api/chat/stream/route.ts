import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/server-session'
import { isAiConfigured } from '@/lib/ai/client'
import { classifyAndGuard, streamAnswer, suggestFollowups, type ChatTurn } from '@/lib/ai/pipeline'
import { buildFinanceContext } from '@/lib/ai/finance-context'
import {
  createSession,
  sessionExists,
  addMessage,
  getTurns,
} from '@/lib/ai/chat-store'

export const dynamic = 'force-dynamic'

/**
 * POST /api/chat/stream
 * Body: { sessionId?: string, message: string, allowDetail?: boolean }
 *
 * Streams Server-Sent Events:
 *   { type: 'session',     session: { id, title } }   (only when a new session was created)
 *   { type: 'delta',       text: string }
 *   { type: 'suggestions', items: string[] }          (best-effort follow-up chips)
 *   { type: 'done' }
 *   { type: 'error',       message: string }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'LOCKED' }, { status: 401 })

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: 'AI is not configured. Set ANTHROPIC_API_KEY in the environment.' },
      { status: 503 },
    )
  }

  const { key, db } = session
  const body = await req.json().catch(() => ({}))
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const allowDetail = body.allowDetail === true
  let sessionId: string | undefined = typeof body.sessionId === 'string' ? body.sessionId : undefined

  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })
  if (sessionId && !sessionExists(db, sessionId)) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 })
  }

  // Create a session on first message, titled from the message text.
  let createdSession: { id: string; title: string } | undefined
  if (!sessionId) {
    const title = message.split('\n')[0].slice(0, 60) || 'New chat'
    const meta = createSession(db, key, title)
    sessionId = meta.id
    createdSession = { id: meta.id, title: meta.title }
  }

  // Persist the user's message before we start generating.
  addMessage(db, key, sessionId, 'user', message)

  const encoder = new TextEncoder()
  const send = (controller: ReadableStreamDefaultController, obj: unknown) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))

  const sid = sessionId
  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (createdSession) send(controller, { type: 'session', session: createdSession })

        const history: ChatTurn[] = getTurns(db, key, sid)
        const route = await classifyAndGuard(history)

        if (!route.allowed) {
          const refusal =
            route.refusal ||
            "I can only help with questions about your own finances in this app."
          send(controller, { type: 'delta', text: refusal })
          addMessage(db, key, sid, 'assistant', refusal)
          send(controller, { type: 'done' })
          controller.close()
          return
        }

        const context = buildFinanceContext(db, key, {
          intents: route.intents,
          month: route.month,
          allowDetail,
        })

        let full = ''
        for await (const delta of streamAnswer({ history, context })) {
          full += delta
          send(controller, { type: 'delta', text: delta })
        }

        addMessage(db, key, sid, 'assistant', full || '(no response)')

        // Best-effort follow-up chips on the cheap model. Runs after the answer
        // has streamed, so it never delays the reply; failures are swallowed.
        try {
          const withAnswer: ChatTurn[] = [...history, { role: 'assistant', content: full }]
          const suggestions = await suggestFollowups(withAnswer)
          if (suggestions.length) send(controller, { type: 'suggestions', items: suggestions })
        } catch {
          /* suggestions are optional — ignore */
        }

        send(controller, { type: 'done' })
        controller.close()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        // Don't leak internals beyond the message; never log decrypted values.
        send(controller, { type: 'error', message: msg })
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
