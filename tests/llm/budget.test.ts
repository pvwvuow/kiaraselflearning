/**
 * M9 acceptance (docs/05 M9) — "budget: over-cap user gets a friendly
 * message; no further LLM calls that day".
 *
 * Units cover the budget math (env override, day window, malformed ledger
 * rows); the integration runs the REAL routes with a pre-seeded `llm_call`
 * ledger: start → friendly 429, turn → warm notice bubble, and the mocked
 * xaiChat is NEVER called again that day. The tree keeps working: the
 * deterministic end-pipeline still runs (no LLM needed).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  analysis: { ok: true, items: [] as unknown[], newUnknownWords: [] as string[], attempts: 1 },
}))

vi.mock('@/lib/llm/xai', () => ({
  xaiChat: vi.fn(async (opts: { role: string }) => {
    if (opts.role === 'analyst') {
      return { ok: true, content: 'summary', model: 'grok-test', latencyMs: 1, promptTokens: 1, completionTokens: 1 }
    }
    return { ok: true, content: 'Hello! What did you do today?', model: 'grok-4.7', latencyMs: 3, promptTokens: 10, completionTokens: 5 }
  }),
}))

vi.mock('@/lib/llm/analyst', () => ({
  analyzeTurn: vi.fn(async () => state.analysis),
}))

import { xaiChat } from '@/lib/llm/xai'
import { POST as start } from '@/app/api/session/start/route'
import { POST as turn } from '@/app/api/session/turn/route'
import { POST as end } from '@/app/api/session/end/route'
import { POST as register } from '@/app/api/auth/register/route'
import { PATCH as onboardingPATCH } from '@/app/api/onboarding/route'
import {
  DEFAULT_DAILY_TOKEN_BUDGET,
  BUDGET_MESSAGE_FA,
  BUDGET_TURN_NOTICE_EN,
  dailyBudgetFromEnv,
  utcDayStart,
  tokensUsedSince,
  budgetState,
  recordLlmCall,
} from '@/lib/llm/budget'
import { db } from '@/lib/db'

const DOMAIN = 'budget.test'

function jsonReq(url: string, body: unknown, cookie?: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

const ONBOARD = {
  cefrSelf: 'A2',
  goal: 'travel',
  interests: [],
  dailyMinutes: 15,
  correctionStyle: 'immediate',
  consentLlm: true,
}

let seq = 0

async function freshUser(): Promise<{ cookie: string; userId: string }> {
  const email = `vitest-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`
  const res = await register(jsonReq('http://x/api/auth/register', { email, password: 's3cret-pass' }))
  const cookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('kiara_session='))!.split(';')[0]
  await onboardingPATCH(
    new Request('http://x/api/onboarding', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(ONBOARD),
    }),
  )
  const userId = (await db.user.findUnique({ where: { email }, select: { id: true } }))!.id
  return { cookie, userId }
}

beforeEach(() => {
  seq = 0
  vi.mocked(xaiChat).mockClear()
  state.analysis = { ok: true, items: [], newUnknownWords: [], attempts: 1 }
})

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } })
  await db.$disconnect()
})

describe('budget units (pure math)', () => {
  it('dailyBudgetFromEnv: default, valid override, invalid values fall back', () => {
    expect(dailyBudgetFromEnv({})).toBe(DEFAULT_DAILY_TOKEN_BUDGET)
    expect(dailyBudgetFromEnv({ KIARA_DAILY_TOKEN_BUDGET: '1000' })).toBe(1000)
    expect(dailyBudgetFromEnv({ KIARA_DAILY_TOKEN_BUDGET: '12.9' })).toBe(12)
    expect(dailyBudgetFromEnv({ KIARA_DAILY_TOKEN_BUDGET: 'abc' })).toBe(DEFAULT_DAILY_TOKEN_BUDGET)
    expect(dailyBudgetFromEnv({ KIARA_DAILY_TOKEN_BUDGET: '-5' })).toBe(DEFAULT_DAILY_TOKEN_BUDGET)
    expect(dailyBudgetFromEnv({ KIARA_DAILY_TOKEN_BUDGET: '0' })).toBe(DEFAULT_DAILY_TOKEN_BUDGET)
  })

  it('utcDayStart truncates to the UTC day boundary', () => {
    const d = utcDayStart(new Date('2026-10-30T15:42:19.123Z'))
    expect(d.toISOString()).toBe('2026-10-30T00:00:00.000Z')
  })

  it('tokensUsedSince sums today’s llm_call rows and tolerates malformed props', async () => {
    const { userId } = await freshUser()
    const since = utcDayStart(new Date())
    await recordLlmCall(userId, 'tutor', 100, 50)
    await recordLlmCall(userId, 'analyst', 200, 25)
    await db.metricEvent.create({
      data: { userId, name: 'llm_call', props: '{not json' }, // corrupt row — skipped
    })
    await db.metricEvent.create({
      data: { userId, name: 'llm_call', props: JSON.stringify({ tokens: 'NaN' }) }, // non-numeric — skipped
    })
    await db.metricEvent.create({
      data: { userId, name: 'session_start', props: JSON.stringify({ tokens: 999999 }) }, // wrong name — excluded
    })
    const used = await tokensUsedSince(userId, since)
    expect(used).toBe(100 + 50 + 200 + 25)
  })

  it('budgetState reports over/remaining correctly', async () => {
    const { userId } = await freshUser()
    await recordLlmCall(userId, 'tutor', 60, 40)
    const s = await budgetState(userId, new Date())
    expect(s.used).toBe(100)
    expect(s.over).toBe(false)
    expect(s.remaining).toBe(DEFAULT_DAILY_TOKEN_BUDGET - 100)
  })
})

describe('budget integration — over-cap user through the real routes', () => {
  it('start → friendly 429 with the Persian cap message; NO LLM call', async () => {
    const { cookie, userId } = await freshUser()
    await recordLlmCall(userId, 'tutor', DEFAULT_DAILY_TOKEN_BUDGET, 0) // the day’s budget, spent

    const res = await start(jsonReq('http://x/api/session/start', {}, cookie))
    expect(res.status).toBe(429)
    const body = (await res.json()) as { ok: boolean; error: string; errorFa: string }
    expect(body.error).toBe('budget')
    expect(body.errorFa).toBe(BUDGET_MESSAGE_FA)
    expect(vi.mocked(xaiChat)).not.toHaveBeenCalled()

    // no session was created
    const sessions = await db.chatSession.count({ where: { userId } })
    expect(sessions).toBe(0)
  })

  it('turn over cap → warm notice bubble (EN+FA), turn persisted, zero LLM calls; end still works', async () => {
    const { cookie, userId } = await freshUser()

    // one normal session BEFORE the cap (opener = 1 tutor call)
    const started = await start(jsonReq('http://x/api/session/start', {}, cookie))
    expect(started.status).toBe(200)
    const { sessionId } = (await started.json()) as { sessionId: string }
    const callsAfterStart = vi.mocked(xaiChat).mock.calls.length
    expect(callsAfterStart).toBeGreaterThanOrEqual(1)

    // spend the rest of the day's budget
    const st = await budgetState(userId, new Date())
    await recordLlmCall(userId, 'tutor', st.remaining + 1, 0)

    const res = await turn(jsonReq('http://x/api/session/turn', { sessionId, content: 'I went to the park.' }, cookie))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tutor: string; meta: { budgetCapped?: boolean; fallback?: boolean } }
    expect(body.tutor).toContain(BUDGET_TURN_NOTICE_EN)
    expect(body.tutor).toContain('سهمیه‌ی تمرین امروز پر شد')
    expect(body.meta.budgetCapped).toBe(true)
    expect(body.meta.fallback).toBe(true)

    // no NEW LLM call happened (opener calls only) — no tutor, no analyst
    expect(vi.mocked(xaiChat).mock.calls.length).toBe(callsAfterStart)
    const llmCalls = await db.metricEvent.count({ where: { userId, name: 'llm_call' } })
    const tutorCallsBefore = 1 + callsAfterStart // opener (+ possible rewrite) pre-cap
    expect(llmCalls).toBeLessThan(tutorCallsBefore + 2)

    // the learner turn + notice bubble both persisted
    const turns = await db.turn.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } })
    expect(turns.some((t) => t.role === 'user' && t.content === 'I went to the park.')).toBe(true)
    expect(turns.some((t) => t.role === 'tutor' && t.content.includes(BUDGET_TURN_NOTICE_EN))).toBe(true)

    // deterministic flows keep working — the end pipeline needs no LLM
    state.analysis = { ok: true, items: [], newUnknownWords: [], attempts: 1 }
    const ended = await end(jsonReq('http://x/api/session/end', { sessionId }, cookie))
    expect(ended.status).toBe(200)
  })

  it('under-cap user still reaches the tutor normally (control)', async () => {
    const { cookie } = await freshUser()
    const res = await start(jsonReq('http://x/api/session/start', {}, cookie))
    expect(res.status).toBe(200)
    expect(vi.mocked(xaiChat)).toHaveBeenCalled()
  })
})
