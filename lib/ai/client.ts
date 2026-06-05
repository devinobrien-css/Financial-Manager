/**
 * Anthropic client wrapper.
 *
 * The API key is read from the ANTHROPIC_API_KEY env var (set it in
 * .env.local). It is NEVER stored in the DB or sent to the client.
 *
 * Privacy note: this is the one place in the app where (decrypted) financial
 * data leaves the device. We only ever send aggregates by default; raw
 * transaction detail is sent only when the user opts in per-message. See
 * lib/ai/finance-context.ts.
 */
import Anthropic from '@anthropic-ai/sdk'

/** Default chat model — Sonnet 4.6 (good reasoning / cost / latency balance). */
export const CHAT_MODEL = 'claude-sonnet-4-6'

/**
 * Cheaper/faster model for the combined guard + intent classifier and for
 * follow-up suggestions — Haiku 4.5. Both are constrained, forced-tool-call
 * tasks where Haiku is plenty, and it cuts cost/latency vs. Sonnet.
 */
export const CLASSIFY_MODEL = 'claude-haiku-4-5'

let _client: Anthropic | null = null

/** Returns true when an API key is configured. */
export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/** Get (or lazily create) the shared Anthropic client. Throws if no key. */
export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set')
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _client
}
