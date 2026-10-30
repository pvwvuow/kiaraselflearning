/**
 * M3 — xAI client unit tests with an injected fetch: success, single retry on
 * 5xx then success, timeout abort, fail-fast 4xx, missing key. No network.
 */
import { describe, expect, it } from 'vitest'
import { XAI_RETRY_BACKOFF_MS, xaiChat, type XaiMessage } from '@/lib/llm/xai'

const MSGS: XaiMessage[] = [{ role: 'user', content: 'hello' }]
const ENV = { XAI_API_KEY: 'test-key', XAI_TUTOR_MODEL: 'grok-4.7', XAI_ANALYST_MODEL: 'grok-test' }

function okResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: 'grok-4.7',
    }),
    { status: 200 },
  )
}

describe('xaiChat', () => {
  it('returns content + usage on success', async () => {
    let called = 0
    const res = await xaiChat(
      { messages: MSGS, role: 'tutor' },
      { env: ENV, sleep: async () => {}, fetchImpl: async () => { called++; return okResponse('Hi there!') } },
    )
    expect(called).toBe(1)
    expect(res).toMatchObject({ ok: true, content: 'Hi there!', model: 'grok-4.7', completionTokens: 5 })
  })

  it('retries ONCE on 500 then succeeds', async () => {
    const codes: number[] = []
    const res = await xaiChat(
      { messages: MSGS, role: 'tutor' },
      {
        env: ENV,
        sleep: async (ms) => { expect(ms).toBe(XAI_RETRY_BACKOFF_MS) },
        fetchImpl: async (_u, init) => {
          // the aborted signal of attempt 1 must not leak into attempt 2
          expect(init?.signal).toBeInstanceOf(AbortSignal)
          codes.push(500)
          if (codes.length === 1) return new Response('boom', { status: 500 })
          return okResponse('recovered')
        },
      },
    )
    expect(codes).toEqual([500, 500])
    expect(res).toMatchObject({ ok: true, content: 'recovered' })
  })

  it('retries on 429; fails fast on 400 without retry', async () => {
    let calls429 = 0
    await xaiChat(
      { messages: MSGS, role: 'analyst' },
      { env: ENV, sleep: async () => {}, fetchImpl: async () => { calls429++; if (calls429 < 2) return new Response('slow', { status: 429 }); return okResponse('ok') } },
    )
    expect(calls429).toBe(2)

    let calls400 = 0
    const bad = await xaiChat(
      { messages: MSGS, role: 'tutor' },
      { env: ENV, sleep: async () => {}, fetchImpl: async () => { calls400++; return new Response('bad request', { status: 400 }) } },
    )
    expect(calls400).toBe(1)
    expect(bad).toMatchObject({ ok: false, status: 400 })
  })

  it('both attempts exhausted → failure with last error', async () => {
    let calls = 0
    const res = await xaiChat(
      { messages: MSGS, role: 'tutor' },
      { env: ENV, sleep: async () => {}, fetchImpl: async () => { calls++; return new Response('down', { status: 503 }) } },
    )
    expect(calls).toBe(2)
    expect(res).toMatchObject({ ok: false, status: 503 })
  })

  it('aborts on timeout and reports a timeout error (then gives up after retry)', async () => {
    let calls = 0
    const res = await xaiChat(
      { messages: MSGS, role: 'tutor', timeoutMs: 20 },
      {
        env: ENV,
        sleep: async () => {},
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            calls++
            init?.signal?.addEventListener('abort', () => {
              const e = new Error('aborted')
              e.name = 'AbortError'
              reject(e)
            })
          }),
      },
    )
    expect(calls).toBe(2)
    expect(res).toMatchObject({ ok: false })
    if (!res.ok) expect(res.error).toContain('timeout after 20ms')
  })

  it('missing API key → immediate failure, zero fetches', async () => {
    let called = false
    const res = await xaiChat(
      { messages: MSGS, role: 'tutor' },
      { env: {}, sleep: async () => {}, fetchImpl: async () => { called = true; return okResponse('x') } },
    )
    expect(called).toBe(false)
    expect(res).toMatchObject({ ok: false, error: 'missing XAI_API_KEY' })
  })

  it('model routing reads env (tutor vs analyst)', async () => {
    const seen: string[] = []
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string }
      seen.push(body.model)
      return okResponse('x')
    }
    await xaiChat({ messages: MSGS, role: 'tutor' }, { env: ENV, sleep: async () => {}, fetchImpl })
    await xaiChat({ messages: MSGS, role: 'analyst' }, { env: ENV, sleep: async () => {}, fetchImpl })
    expect(seen).toEqual(['grok-4.7', 'grok-test'])
  })
})
