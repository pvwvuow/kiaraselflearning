/**
 * xAI client — OpenAI-compatible chat completions over plain fetch
 * (docs/01 stack + docs/04 §5 routing defaults).
 *
 * Design:
 * - Keys/models come ONLY from env: XAI_API_KEY, XAI_BASE_URL (default
 *   https://api.x.ai/v1), XAI_TUTOR_MODEL, XAI_ANALYST_MODEL. Nothing is
 *   hardcoded, nothing is logged.
 * - Timeout 30 s via AbortController; ONE retry on network error / 429 / 5xx
 *   with a short backoff (docs/05 M3 scope).
 * - Fully injectable `fetchImpl` + `sleep` so tests run without network.
 * - Never throws: returns a discriminated result so the chat loop can degrade
 *   gracefully (fallback reply) instead of 500-ing the conversation.
 */

export const XAI_TIMEOUT_MS = 30_000
export const XAI_RETRY_BACKOFF_MS = 400

export type XaiRole = 'system' | 'user' | 'assistant'

export interface XaiMessage {
  role: XaiRole
  content: string
}

export interface XaiCallOptions {
  messages: XaiMessage[]
  /** 'tutor' | 'analyst' — picks the env-configured model */
  role: 'tutor' | 'analyst'
  temperature?: number
  maxTokens?: number
  /** override the default timeout (tests) */
  timeoutMs?: number
}

export interface XaiSuccess {
  ok: true
  content: string
  model: string
  latencyMs: number
  promptTokens: number | null
  completionTokens: number | null
}

export interface XaiFailure {
  ok: false
  error: string
  status: number | null
  latencyMs: number
}

export type XaiResult = XaiSuccess | XaiFailure

export interface XaiDeps {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** test hook: read a different env bag */
  env?: Record<string, string | undefined>
}

export function tutorModel(env: Record<string, string | undefined> = process.env): string {
  return env.XAI_TUTOR_MODEL || 'grok-4.7'
}

export function analystModel(env: Record<string, string | undefined> = process.env): string {
  return env.XAI_ANALYST_MODEL || 'grok-4.20-0309-non-reasoning'
}

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** One chat completion with timeout + single retry. Never throws. */
export async function xaiChat(opts: XaiCallOptions, deps: XaiDeps = {}): Promise<XaiResult> {
  const env = deps.env ?? process.env
  const doFetch = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? sleepDefault

  const apiKey = env.XAI_API_KEY
  if (!apiKey) {
    return { ok: false, error: 'missing XAI_API_KEY', status: null, latencyMs: 0 }
  }
  const baseUrl = (env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/+$/, '')
  const model = opts.role === 'tutor' ? tutorModel(env) : analystModel(env)
  const timeoutMs = opts.timeoutMs ?? XAI_TIMEOUT_MS

  const body = JSON.stringify({
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.8,
    max_tokens: opts.maxTokens ?? 300,
    stream: false,
  })

  const started = Date.now()
  let lastError: XaiFailure = { ok: false, error: 'unreached', status: null, latencyMs: 0 }

  // attempt = initial call + ONE retry (docs/05 M3)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(XAI_RETRY_BACKOFF_MS)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await doFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: controller.signal,
      })
      const latencyMs = Date.now() - started

      if (res.ok) {
        const json = (await res.json()) as {
          choices?: { message?: { content?: string } }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number }
          model?: string
        }
        const content = json.choices?.[0]?.message?.content
        if (typeof content !== 'string') {
          lastError = { ok: false, error: 'malformed response (no choices[0].message.content)', status: res.status, latencyMs }
          continue // malformed body → try once more
        }
        return {
          ok: true,
          content,
          model: json.model ?? model,
          latencyMs,
          promptTokens: json.usage?.prompt_tokens ?? null,
          completionTokens: json.usage?.completion_tokens ?? null,
        }
      }

      const retriable = res.status === 429 || res.status >= 500
      let detail = ''
      try {
        detail = (await res.text()).slice(0, 300)
      } catch {
        detail = ''
      }
      lastError = {
        ok: false,
        error: `HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
        status: res.status,
        latencyMs,
      }
      if (!retriable) return lastError // 4xx: don't retry, fail fast
    } catch (err) {
      const isAbort = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
      lastError = {
        ok: false,
        error: isAbort ? `timeout after ${timeoutMs}ms` : err instanceof Error ? err.message : String(err),
        status: null,
        latencyMs: Date.now() - started,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  return lastError
}
