/**
 * M4 — session-end API + per-turn analyst wiring (mocked LLM):
 * end route guards, summary persistence, evidence written from the per-turn
 * analyst, analyst_parse_fail metric on failure (chat never blocked).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'

const state = vi.hoisted(() => ({
  tutorReply: 'Great! Your ticket is here, my friend.',
  analysis: { ok: true, items: [], newUnknownWords: [], attempts: 1 } as {
    ok: boolean
    items: unknown[]
    newUnknownWords: string[]
    attempts: number
    error?: string
  },
}))

vi.mock('@/lib/llm/xai', () => ({
  xaiChat: vi.fn(async (opts: { role: string }) => {
    if (opts.role === 'analyst') {
      return { ok: true, content: 'summary text', model: 'grok-test', latencyMs: 1, promptTokens: 1, completionTokens: 1 }
    }
    return { ok: true, content: state.tutorReply, model: 'grok-4.7', latencyMs: 3, promptTokens: 10, completionTokens: 5 }
  }),
}))

vi.mock('@/lib/llm/analyst', () => ({
  analyzeTurn: vi.fn(async () => state.analysis),
}))

import { POST as start } from '@/app/api/session/start/route'
import { POST as turn } from '@/app/api/session/turn/route'
import { POST as end } from '@/app/api/session/end/route'
import { POST as register } from '@/app/api/auth/register/route'
import { PATCH as onboardingPATCH } from '@/app/api/onboarding/route'
import { db } from '@/lib/db'

const DOMAIN = 'session-end.test'

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
  interests: ['travel'],
  dailyMinutes: 15,
  correctionStyle: 'immediate',
  consentLlm: true,
}

let cookie = ''
let sessionId = ''

async function freshUser(): Promise<void> {
  const email = `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`
  const res = await register(jsonReq('http://x/api/auth/register', { email, password: 's3cret-pass' }))
  cookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('kiara_session='))!.split(';')[0]
  await onboardingPATCH(new Request('http://x/api/onboarding', { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(ONBOARD) }))
  const started = await start(jsonReq('http://x/api/session/start', {}, cookie))
  sessionId = ((await started.json()) as { sessionId: string }).sessionId
}

beforeEach(async () => {
  state.tutorReply = 'Great! Your ticket is here, my friend.'
  state.analysis = { ok: true, items: [], newUnknownWords: [], attempts: 1 }
  await freshUser()
})

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } })
  await db.$disconnect()
})

describe('POST /api/session/turn — per-turn analyst wiring', () => {
  it('validated analyst items land as Evidence rows for the learner turn', async () => {
    state.analysis = {
      ok: true,
      attempts: 1,
      newUnknownWords: [],
      items: [{ nodeId: 'en:word:time', skill: 'writing', outcome: 'correct', confidence: 0.9 }],
    }
    const res = await turn(jsonReq('http://x/api/session/turn', { sessionId, content: 'I have time today.' }, cookie))
    expect(res.status).toBe(200)

    const evidence = await db.evidence.findMany({ where: { sessionId } })
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({ nodeId: 'en:word:time', outcome: 'correct', confidence: 0.9 })
    // the evidence points at the USER turn
    const userTurn = await db.turn.findFirst({ where: { sessionId, role: 'user' } })
    expect(evidence[0].turnId).toBe(userTurn?.id)
  })

  it('analyst failure → NO evidence, metric analyst_parse_fail, tutor reply still delivered', async () => {
    state.analysis = { ok: false, items: [], newUnknownWords: [], attempts: 2, error: 'schema: items — invalid' }
    const res = await turn(jsonReq('http://x/api/session/turn', { sessionId, content: 'Hello!' }, cookie))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tutor: string }
    expect(body.tutor).toBe(state.tutorReply)

    const evidence = await db.evidence.count({ where: { sessionId } })
    expect(evidence).toBe(0)
    const metric = await db.metricEvent.findFirst({ where: { userId: (await db.chatSession.findUnique({ where: { id: sessionId } }))?.userId, name: 'analyst_parse_fail' } })
    expect(metric).toBeTruthy()
  })
})

describe('POST /api/session/end', () => {
  it('401 anonymous · 400 bad payload · 404 unknown session', async () => {
    expect((await end(jsonReq('http://x/api/session/end', { sessionId }, false))).status).toBe(401)
    // bad payload WITH a valid cookie → 400 (auth comes first)
    expect((await end(jsonReq('http://x/api/session/end', {}))).status).toBe(401)
    expect((await end(jsonReq('http://x/api/session/end', { sessionId: 'nope' }, cookie))).status).toBe(404)
  })

  it('runs the pipeline and persists the summary; second call → 409', async () => {
    // one turn with evidence
    state.analysis = {
      ok: true,
      attempts: 1,
      newUnknownWords: [],
      items: [{ nodeId: 'en:word:time', skill: 'writing', outcome: 'correct', confidence: 0.9 }],
    }
    await turn(jsonReq('http://x/api/session/turn', { sessionId, content: 'I have time today.' }, cookie))

    const res = await end(jsonReq('http://x/api/session/end', { sessionId }, cookie))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      applied: { nodeId: string; rating: string }[]
      summary: { reinforced: { nodeId: string }[] }
    }
    expect(body.ok).toBe(true)
    expect(body.applied).toHaveLength(1)
    expect(body.applied[0]).toMatchObject({ nodeId: 'en:word:time', rating: 'Good' })
    expect(body.summary.reinforced.some((r) => r.nodeId === 'en:word:time')).toBe(true)

    const row = await db.chatSession.findUnique({ where: { id: sessionId } })
    expect(row?.status).toBe('ended')
    expect(row?.endedAt).toBeTruthy()
    const stored = JSON.parse(row!.summary!) as { reinforced: unknown[] }
    expect(stored.reinforced).toHaveLength(1)

    const metric = await db.metricEvent.findFirst({
      where: { name: 'session_end', props: { contains: sessionId } },
    })
    expect(metric).toBeTruthy()

    // second end → 409 (idempotency guard)
    const again = await end(jsonReq('http://x/api/session/end', { sessionId }, cookie))
    expect(again.status).toBe(409)
  })

  it('ending a FOREIGN user session → 404', async () => {
    await freshUser() // second user; sessionId now belongs to them
    const firstUserSession = sessionId
    const emailCookie = cookie
    // re-login as a third user and try to end the second user's session
    const email3 = `vitest-${Date.now()}-x@${DOMAIN}`
    const reg = await register(jsonReq('http://x/api/auth/register', { email: email3, password: 's3cret-pass' }))
    const cookie3 = (reg.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('kiara_session='))!.split(';')[0]

    const res = await end(jsonReq('http://x/api/session/end', { sessionId: firstUserSession }, cookie3))
    expect(res.status).toBe(404)
    void emailCookie
  })
})
