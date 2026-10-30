/**
 * M3 acceptance — session flow through the API routes with a MOCKED LLM
 * (docs/05 M3): "turn API with mocked LLM returns tutor message +
 * meta.unknownRate recorded"; "violation triggers rewrite path (mocked)".
 *
 * vi.mock intercepts '@/lib/llm/xai' at the network boundary; everything else
 * (routes, chat orchestration, i+1 checker, DB) runs for real.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'

const state = vi.hoisted(() => ({
  tutorReplies: [] as string[],
  analystReply: 'The learner is checking in at the airport hotel; practiced ticket/bus words.',
  calls: [] as { role: string; messages: { role: string; content: string }[] }[],
}))

vi.mock('@/lib/llm/xai', () => ({
  xaiChat: vi.fn(async (opts: { role: string; messages: { role: string; content: string }[] }) => {
    state.calls.push(opts)
    if (opts.role === 'analyst') {
      return { ok: true, content: state.analystReply, model: 'grok-test', latencyMs: 2, promptTokens: 10, completionTokens: 4 }
    }
    const content = state.tutorReplies.shift() ?? 'Great! Your ticket is here, my friend.'
    return { ok: true, content, model: 'grok-4.7', latencyMs: 7, promptTokens: 100, completionTokens: 20 }
  }),
}))

import { POST as start } from '@/app/api/session/start/route'
import { POST as turn } from '@/app/api/session/turn/route'
import { POST as register } from '@/app/api/auth/register/route'
import { PATCH as onboardingPATCH } from '@/app/api/onboarding/route'
import { db } from '@/lib/db'

const DOMAIN = 'session-flow.test'
const created: string[] = []

function jsonReq(url: string, body: unknown, cookie?: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

function cookieOf(res: Response): string {
  const setCookie = res.headers.getSetCookie?.() ?? []
  const session = setCookie.find((c) => c.startsWith('kiara_session='))
  expect(session, 'expected session cookie').toBeTruthy()
  return (session as string).split(';')[0]
}

const ONBOARD = {
  cefrSelf: 'A2',
  goal: 'travel',
  interests: ['travel'],
  dailyMinutes: 15,
  correctionStyle: 'immediate',
  consentLlm: true,
}

async function newUser(consented: boolean): Promise<string> {
  const email = `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`
  created.push(email)
  const res = await register(jsonReq('http://x/api/auth/register', { email, password: 's3cret-pass' }))
  const cookie = cookieOf(res)
  if (consented) await onboardingPATCH(new Request('http://x/api/onboarding', { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(ONBOARD) }))
  return cookie
}

/** seed a known lexicon for the i+1 checker (real word nodes from the graph) */
const KNOWN_WORDS = [
  'en:word:time', 'en:word:day', 'en:word:ticket', 'en:word:city', 'en:word:house',
  'en:word:friend', 'en:word:car', 'en:word:bus', 'en:word:train', 'en:word:travel',
  'en:word:stay', 'en:word:visit',
]
async function seedKnownLexicon(userId: string) {
  for (const nodeId of KNOWN_WORDS) {
    await db.userNodeState.create({
      data: { userId, nodeId, skill: 'writing', strength: 0.6, displayState: 'learning' },
    })
  }
}

const OK_REPLY = 'Great! Your ticket is here, my friend.'
// 4 content words, ALL unknown → rate 1.0 → i+1 violation (known set: ticket/bus/…)
const HARD_REPLY = 'The recommendation was superb and the journey incredible.'
const HARD_REPLY_2 = 'The recommendation was superb, the journey incredible, the hotel sublime.'

beforeEach(() => {
  state.tutorReplies = []
  state.analystReply = 'The learner is checking in at the airport hotel; practiced ticket/bus words.'
  state.calls = []
})

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } })
  await db.$disconnect()
})

describe('POST /api/session/start (mocked LLM)', () => {
  it('401 unauthenticated · 403 without LLM consent', async () => {
    const anon = await start(jsonReq('http://x/api/session/start', {}))
    expect(anon.status).toBe(401)

    const noConsentCookie = await newUser(false)
    const noConsent = await start(jsonReq('http://x/api/session/start', {}, noConsentCookie))
    expect(noConsent.status).toBe(403)
    const body = (await noConsent.json()) as { error: string }
    expect(body.error).toBe('llm_consent_required')
  })

  it('creates a session with brief + scenario + opener; MetricEvent written', async () => {
    const cookie = await newUser(true)
    const email = created[created.length - 1]
    const user = await db.user.findUnique({ where: { email } })
    await seedKnownLexicon(user!.id)

    const res = await start(jsonReq('http://x/api/session/start', {}, cookie))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      sessionId: string
      brief: { scenario: { title: string }; frontierNodes: unknown[] }
      scenario: { id: string; mustElicit: { id: string }[] }
      opener: { content: string; meta: { opener?: boolean; unknownRate?: number } }
    }
    expect(body.ok).toBe(true)
    expect(body.brief.scenario.title).toBeTruthy() // Persian scenario title
    expect(body.scenario.mustElicit.length).toBeGreaterThan(0)
    expect(body.opener.content).toBe(OK_REPLY) // default mock reply
    expect(body.opener.meta.opener).toBe(true)
    expect(body.opener.meta.unknownRate).toBe(0) // reply uses only known words

    const turns = await db.turn.findMany({ where: { sessionId: body.sessionId } })
    expect(turns).toHaveLength(1)
    expect(turns[0].role).toBe('tutor')

    const metrics = await db.metricEvent.findMany({ where: { userId: user!.id, name: 'session_start' } })
    expect(metrics.length).toBe(1)
  })
})

describe('POST /api/session/turn (mocked LLM — the M3 acceptance)', () => {
  async function startedSession(cookie: string): Promise<string> {
    const res = await start(jsonReq('http://x/api/session/start', {}, cookie))
    expect(res.status).toBe(200)
    return ((await res.json()) as { sessionId: string }).sessionId
  }

  it('returns tutor message with meta.unknownRate recorded; turns persisted', async () => {
    const cookie = await newUser(true)
    const email = created[created.length - 1]
    const user = await db.user.findUnique({ where: { email } })
    await seedKnownLexicon(user!.id)
    const sessionId = await startedSession(cookie)

    state.tutorReplies = [OK_REPLY]
    const res = await turn(jsonReq('http://x/api/session/turn', { sessionId, content: 'Hello! I am happy today.' }, cookie))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      tutor: string
      meta: { unknownRate: number; unknownWords: string[]; rewritten?: boolean; fallback?: boolean }
      userTurnCount: number
    }
    expect(body.tutor).toBe(OK_REPLY)
    expect(body.meta.unknownRate).toBe(0)
    expect(body.meta.unknownWords).toEqual([])
    expect(body.meta.rewritten).toBeFalsy()
    expect(body.userTurnCount).toBe(1)

    const turns = await db.turn.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } })
    expect(turns.map((t) => t.role)).toEqual(['tutor', 'user', 'tutor'])
  })

  it('i+1 violation triggers exactly one rewrite pass; rewritten reply is used', async () => {
    const cookie = await newUser(true)
    const email = created[created.length - 1]
    const user = await db.user.findUnique({ where: { email } })
    await seedKnownLexicon(user!.id)
    const sessionId = await startedSession(cookie)

    state.tutorReplies = [HARD_REPLY, OK_REPLY]
    const res = await turn(jsonReq('http://x/api/session/turn', { sessionId, content: 'Hi!' }, cookie))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tutor: string; meta: { rewritten?: boolean; unknownRate: number; unknownWords: string[] } }
    expect(body.tutor).toBe(OK_REPLY)
    expect(body.meta.rewritten).toBe(true)
    expect(body.meta.unknownRate).toBe(0)

    // tutor calls: opener + hard + rewrite; the rewrite carries the unknown list
    const tutorCalls = state.calls.filter((c) => c.role === 'tutor')
    expect(tutorCalls.length).toBe(3) // opener, hard reply, rewrite
    const rewriteMsg = tutorCalls.at(-1)!.messages.at(-1)!.content
    expect(rewriteMsg).toContain('Unknown words to remove or replace')
    expect(rewriteMsg).toContain('recommendation')
    expect(rewriteMsg).toContain('journey')
  })

  it('rewrite still violating → deterministic fallback, meta.fallback=true', async () => {
    const cookie = await newUser(true)
    const email = created[created.length - 1]
    const user = await db.user.findUnique({ where: { email } })
    await seedKnownLexicon(user!.id)
    const sessionId = await startedSession(cookie)

    state.tutorReplies = [HARD_REPLY, HARD_REPLY_2]
    const res = await turn(jsonReq('http://x/api/session/turn', { sessionId, content: 'Hi!' }, cookie))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tutor: string; meta: { fallback?: boolean } }
    expect(body.meta.fallback).toBe(true)
    expect(body.tutor).toMatch(/^Let's keep it simple: /)
  })

  it('tutor call failing → deterministic fallback, conversation never 500s', async () => {
    const cookie = await newUser(true)
    const email = created[created.length - 1]
    const user = await db.user.findUnique({ where: { email } })
    await seedKnownLexicon(user!.id)
    const sessionId = await startedSession(cookie)

    // force the mock to fail the tutor role but succeed for analyst
    const xai = await import('@/lib/llm/xai')
    const spy = vi.mocked(xai.xaiChat)
    spy.mockImplementationOnce(async (opts) => {
      if (opts.role === 'tutor') return { ok: false, error: 'HTTP 503', status: 503, latencyMs: 1 }
      return { ok: true, content: 'x', model: 'm', latencyMs: 1, promptTokens: 1, completionTokens: 1 }
    })

    const res = await turn(jsonReq('http://x/api/session/turn', { sessionId, content: 'Hello?' }, cookie))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tutor: string; meta: { fallback?: boolean } }
    expect(body.meta.fallback).toBe(true)
  })

  it('rolling summary refreshes every 10 learner turns (ChatSession.summary)', async () => {
    const cookie = await newUser(true)
    const email = created[created.length - 1]
    const user = await db.user.findUnique({ where: { email } })
    await seedKnownLexicon(user!.id)
    const sessionId = await startedSession(cookie)

    for (let i = 1; i <= 10; i++) {
      const res = await turn(jsonReq('http://x/api/session/turn', { sessionId, content: `Message number ${i}` }, cookie))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { summaryUpdated: boolean; userTurnCount: number }
      expect(body.userTurnCount).toBe(i)
      expect(body.summaryUpdated).toBe(i === 10)
    }

    const session = await db.chatSession.findUnique({ where: { id: sessionId } })
    const summary = JSON.parse(session!.summary!) as { text: string; upToUserTurn: number }
    expect(summary.text).toContain('airport hotel')
    expect(summary.upToUserTurn).toBe(10)

    // summary call happened once, on the analyst role
    const analystCalls = state.calls.filter((c) => c.role === 'analyst')
    expect(analystCalls.length).toBe(1)
  })

  it('guards: 400 empty content · 404 unknown session · 404 foreign session · 409 ended', async () => {
    const cookie = await newUser(true)
    const email = created[created.length - 1]
    const user = await db.user.findUnique({ where: { email } })
    await seedKnownLexicon(user!.id)
    const sessionId = await startedSession(cookie)

    const bad = await turn(jsonReq('http://x/api/session/turn', { sessionId, content: '' }, cookie))
    expect(bad.status).toBe(400)

    const unknown = await turn(jsonReq('http://x/api/session/turn', { sessionId: 'nope', content: 'hi' }, cookie))
    expect(unknown.status).toBe(404)

    const otherCookie = await newUser(true)
    const otherEmail = created[created.length - 1]
    const otherUser = await db.user.findUnique({ where: { email: otherEmail } })
    const foreignId = await startedSession(otherCookie)
    const foreign = await turn(jsonReq('http://x/api/session/turn', { sessionId: foreignId, content: 'hi' }, cookie))
    expect(foreign.status).toBe(404)
    void user

    await db.chatSession.update({ where: { id: sessionId }, data: { status: 'ended' } })
    const ended = await turn(jsonReq('http://x/api/session/turn', { sessionId, content: 'hi' }, cookie))
    expect(ended.status).toBe(409)
  })
})
