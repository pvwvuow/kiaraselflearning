/**
 * M9 acceptance (docs/05 M9) — "metrics test: one fake session emits
 * session_start/end, evidence_created, evidence_applied, seed_proposed/approved
 * with correct props".
 *
 * Everything runs through the REAL routes with a mocked LLM (the metrics are
 * deterministic side effects of the same flows). MetricEvent is write-only
 * analytics (docs/02) — these rows are the evaluation plan of docs/00 §4.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  tutorReply: 'Great! Your ticket is here, my friend.',
  analysis: {
    ok: true,
    items: [] as unknown[],
    newUnknownWords: [] as string[],
    attempts: 1,
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
import { POST as dispute } from '@/app/api/evidence/[id]/dispute/route'
import { POST as approve } from '@/app/api/seeds/[id]/approve/route'
import { writeTurnEvidence } from '@/lib/evidence/writer'
import { db } from '@/lib/db'

const DOMAIN = 'metrics.test'
const SEED_WORD = 'en:word:recommend' // goal-relevant for 'work' (M7 pattern)

let seq = 0

function jsonReq(url: string, body: unknown, cookie?: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

const ONBOARD = {
  cefrSelf: 'A2',
  goal: 'work',
  interests: ['travel'],
  dailyMinutes: 15,
  correctionStyle: 'immediate',
  consentLlm: true,
}

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

function errorItem(nodeId: string) {
  return {
    nodeId,
    skill: 'writing' as const,
    outcome: 'error' as const,
    confidence: 0.9,
    errorType: 'form',
    produced: 'he recommend it',
    expected: 'he recommends it',
    l1Interference: true,
    hintUsed: false,
  }
}

function propsOf(row: { props: string | null }): Record<string, unknown> {
  return JSON.parse(row.props ?? '{}') as Record<string, unknown>
}

beforeEach(() => {
  seq = 0
  state.tutorReply = 'Great! Your ticket is here, my friend.'
  state.analysis = { ok: true, items: [], newUnknownWords: [], attempts: 1 }
})

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } })
  await db.$disconnect()
})

describe('M9 metrics — one fake session through the real routes', () => {
  it('emits session_start → evidence_created → evidence_applied → session_end with correct props', async () => {
    const { cookie, userId } = await freshUser()

    // ── session_start ──────────────────────────────────────────────────────
    const started = await start(jsonReq('http://x/api/session/start', {}, cookie))
    expect(started.status).toBe(200)
    const { sessionId } = (await started.json()) as { sessionId: string }

    const startMetric = await db.metricEvent.findFirst({
      where: { userId, name: 'session_start' },
      orderBy: { createdAt: 'desc' },
    })
    expect(startMetric).toBeTruthy()
    const startProps = propsOf(startMetric!)
    expect(startProps.sessionId).toBe(sessionId)
    expect(typeof startProps.scenarioId).toBe('string')
    expect(typeof startProps.briefTokens).toBe('number')
    expect(startProps.probes).toBe(0) // fresh user — no ride-along probes

    // ── evidence_created (per-turn analyst → writer) ───────────────────────
    state.analysis = {
      ok: true,
      attempts: 1,
      newUnknownWords: [],
      items: [{ nodeId: 'en:word:time', skill: 'writing', outcome: 'correct', confidence: 0.9 }],
    }
    const turned = await turn(jsonReq('http://x/api/session/turn', { sessionId, content: 'I have time today.' }, cookie))
    expect(turned.status).toBe(200)

    const createdMetric = await db.metricEvent.findFirst({
      where: { userId, name: 'evidence_created' },
      orderBy: { createdAt: 'desc' },
    })
    expect(createdMetric).toBeTruthy()
    const createdProps = propsOf(createdMetric!)
    expect(createdProps).toMatchObject({ sessionId, count: 1, source: 'turn' })
    const userTurn = await db.turn.findFirst({ where: { sessionId, role: 'user' } })
    expect(createdProps.turnId).toBe(userTurn?.id)

    // ── evidence_applied + session_end (the §A7 pipeline) ──────────────────
    const ended = await end(jsonReq('http://x/api/session/end', { sessionId }, cookie))
    expect(ended.status).toBe(200)
    const endBody = (await ended.json()) as { applied: { nodeId: string; skill: string; rating: string }[] }

    const appliedMetrics = await db.metricEvent.findMany({
      where: { userId, name: 'evidence_applied' },
      orderBy: { createdAt: 'asc' },
    })
    expect(appliedMetrics).toHaveLength(endBody.applied.length)
    const appliedProps = propsOf(appliedMetrics[0])
    expect(appliedProps).toMatchObject({
      sessionId,
      nodeId: endBody.applied[0].nodeId,
      skill: endBody.applied[0].skill,
      rating: endBody.applied[0].rating,
    })

    const endMetric = await db.metricEvent.findFirst({
      where: { userId, name: 'session_end' },
      orderBy: { createdAt: 'desc' },
    })
    expect(endMetric).toBeTruthy()
    const endProps = propsOf(endMetric!)
    expect(endProps.sessionId).toBe(sessionId)
    expect(endProps.applied).toBe(endBody.applied.length)
    expect(endProps.seeds).toBe(0)
    expect(endProps.probes).toBe(0)
  })

  it('emits evidence_disputed with the evidence id when the user disputes', async () => {
    const { cookie, userId } = await freshUser()
    const started = await start(jsonReq('http://x/api/session/start', {}, cookie))
    const { sessionId } = (await started.json()) as { sessionId: string }
    state.analysis = {
      ok: true,
      attempts: 1,
      newUnknownWords: [],
      items: [{ nodeId: 'en:word:time', skill: 'writing', outcome: 'correct', confidence: 0.9 }],
    }
    await turn(jsonReq('http://x/api/session/turn', { sessionId, content: 'I have time today.' }, cookie))
    const ev = await db.evidence.findFirst({ where: { sessionId }, select: { id: true } })
    expect(ev).toBeTruthy()

    const res = await dispute(
      jsonReq(`http://x/api/evidence/${ev!.id}/dispute`, { reason: 'تایپ اشتباه بود' }, cookie),
      { params: Promise.resolve({ id: ev!.id }) },
    )
    expect(res.status).toBe(200)

    const metric = await db.metricEvent.findFirst({ where: { userId, name: 'evidence_disputed' } })
    expect(metric).toBeTruthy()
    expect(propsOf(metric!)).toEqual({ evidenceId: ev!.id, withReason: true })
  })

  it('emits seed_proposed then seed_approved with correct props through the growth loop', async () => {
    const { cookie, userId } = await freshUser()

    // two sessions × one confident error each → the repeated_error trigger
    for (let i = 0; i < 2; i++) {
      const s = await db.chatSession.create({
        data: { userId, type: 'roleplay_targeted', status: 'active', startedAt: new Date() },
      })
      // write through the REAL writer (append-only, per-turn idempotent)
      await writeTurnEvidence(userId, s.id, `turn-${s.id}`, {
        ok: true,
        items: [errorItem(SEED_WORD)],
        newUnknownWords: [],
      })
      const ended = await end(jsonReq('http://x/api/session/end', { sessionId: s.id }, cookie))
      expect(ended.status).toBe(200)
      if (i === 0) {
        // session 1: the error alone does NOT propose (needs 2 independent sessions)
        const proposed = await db.metricEvent.findMany({ where: { userId, name: 'seed_proposed' } })
        expect(proposed).toHaveLength(0)
      }
    }

    const proposedMetrics = await db.metricEvent.findMany({
      where: { userId, name: 'seed_proposed' },
      orderBy: { createdAt: 'asc' },
    })
    expect(proposedMetrics.length).toBeGreaterThanOrEqual(1)
    const prop1 = propsOf(proposedMetrics[0])
    expect(typeof prop1.seedId).toBe('string')
    expect(Number(prop1.score)).toBeGreaterThanOrEqual(0.45)

    // approve through the API → seed_approved with the planted node
    const seedId = prop1.seedId as string
    const approved = await approve(
      jsonReq(`http://x/api/seeds/${seedId}/approve`, {}, cookie),
      { params: Promise.resolve({ id: seedId }) },
    )
    expect(approved.status).toBe(200)
    const approvedBody = (await approved.json()) as { held: boolean; plantedNodeId: string | null }
    expect(approvedBody.held).toBe(false)

    const approvedMetric = await db.metricEvent.findFirst({ where: { userId, name: 'seed_approved' } })
    expect(approvedMetric).toBeTruthy()
    expect(propsOf(approvedMetric!)).toEqual({
      seedId,
      nodeId: approvedBody.plantedNodeId,
      score: prop1.score,
    })

    // the session that planted also emitted session_end with seeds counted —
    // sanity: the metric row for the 2nd session_end carries seeds ≥ 1
    const endMetrics = await db.metricEvent.findMany({
      where: { userId, name: 'session_end' },
      orderBy: { createdAt: 'asc' },
    })
    const lastEnd = propsOf(endMetrics[endMetrics.length - 1])
    expect(Number(lastEnd.seeds)).toBeGreaterThanOrEqual(1)
  })

  it('records llm_call usage rows (the budget ledger) for tutor + analyst roles', async () => {
    const { cookie, userId } = await freshUser()
    const started = await start(jsonReq('http://x/api/session/start', {}, cookie))
    const { sessionId } = (await started.json()) as { sessionId: string }
    state.analysis = {
      ok: true,
      attempts: 1,
      newUnknownWords: [],
      items: [{ nodeId: 'en:word:time', skill: 'writing', outcome: 'correct', confidence: 0.9 }],
    }
    await turn(jsonReq('http://x/api/session/turn', { sessionId, content: 'I have time today.' }, cookie))

    const calls = await db.metricEvent.findMany({ where: { userId, name: 'llm_call' } })
    expect(calls.length).toBeGreaterThanOrEqual(1) // at least the opener
    for (const c of calls) {
      const p = propsOf(c)
      expect(['tutor', 'analyst']).toContain(p.role)
      expect(p.tokens).toBe(Number(p.promptTokens) + Number(p.completionTokens))
    }
  })
})
