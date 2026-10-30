/**
 * M4 acceptance — aggregation E2E through the REAL database (docs/05 M4):
 * "fake evidence set → expected S/D/reps/display transitions (fixture = the
 * S1–S8 table from docs/03)". Also covers propagation (A4 down), root-cause
 * (A4 up), the growth trigger scan (B2/B3) and disputed-evidence exclusion.
 * The LLM is NOT involved here — evidence is written through the real writer.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { endSession } from '@/lib/session/pipeline'
import { writeTurnEvidence } from '@/lib/evidence/writer'
import { loadGraph } from '@/lib/graph/load'
import { ChatError } from '@/lib/session/chat'
import type { EvidenceItem, Outcome, Skill } from '@/lib/engine/types'

const prisma = new PrismaClient()
const DOMAIN = 'pipeline.test'
const NODE = 'en:chunk:could-you'
const T = (s: string) => new Date(s)

let userId = ''

function ev(nodeId: string, outcome: Outcome, confidence: number, when: Date, extra: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    nodeId,
    skill: 'writing' as Skill,
    outcome,
    confidence,
    errorType: outcome === 'error' ? 'form' : null,
    produced: outcome === 'error' ? 'produced-fragment' : null,
    expected: outcome === 'error' ? 'expected-fragment' : null,
    hintUsed: false,
    l1Interference: outcome === 'error',
    ...extra,
  }
}

/** one S-session: a ChatSession + evidence written through the real writer */
async function runSession(sessionId: string, date: Date, items: EvidenceItem[]) {
  const session = await prisma.chatSession.create({
    data: { userId, type: 'roleplay_targeted', status: 'active', startedAt: date },
  })
  expect(sessionId).toBeTruthy() // each S-step uses its own real session id
  void sessionId
  if (items.length > 0) {
    await writeTurnEvidence(userId, session.id, `turn-${session.id}`, { ok: true, items, newUnknownWords: [] })
  }
  return endSession(userId, session.id, date)
}

async function stateOf(nodeId = NODE): Promise<Record<string, unknown> | null> {
  const row = await prisma.userNodeState.findUnique({
    where: { userId_nodeId_skill: { userId, nodeId, skill: 'writing' } },
  })
  return row as unknown as Record<string, unknown> | null
}

beforeEach(async () => {
  if (!userId) {
    const u = await prisma.user.create({
      data: {
        email: `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`,
        passwordHash: 'x',
        goal: 'travel',
        consentLlmAt: new Date(),
      },
    })
    userId = u.id
  }
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } })
  await prisma.$disconnect()
})

describe('S1–S8 lifecycle through the DB pipeline (docs/03 §A3)', () => {
  it('runs the 8 sessions and reproduces every table row', async () => {
    // S1 d0 — 2× correct → Good, S≈2.31, D≈2.12, Learning
    let r = await runSession('s1', T('2026-11-01T10:00:00Z'), [
      ev(NODE, 'correct', 0.9, T('2026-11-01T10:00:00Z')),
      ev(NODE, 'correct', 0.85, T('2026-11-01T10:05:00Z')),
    ])
    expect(r.applied[0]?.rating).toBe('Good')
    let s = await stateOf()
    expect(s?.stability).toBeCloseTo(2.31, 1)
    expect(s?.difficulty).toBeCloseTo(2.12, 1)
    expect(s?.fsrsState).toBe('Learning')
    expect(s?.reps).toBe(1)
    expect(s?.displayState).toBe('learning')
    expect(s?.lastAppliedEvidenceId).toBeTruthy()

    // S2 d2 — 1× correct + a DISPUTED error that must be excluded entirely
    r = await runSession('s2', T('2026-11-03T10:00:00Z'), [
      ev(NODE, 'correct', 0.95, T('2026-11-03T10:00:00Z')),
      ev(NODE, 'error', 0.95, T('2026-11-03T10:01:00Z'), { disputed: true }),
    ])
    expect(r.applied[0]?.rating).toBe('Good')
    s = await stateOf()
    expect(s?.stability).toBeCloseTo(10.96, 1)
    expect(s?.fsrsState).toBe('Review')

    // S3 d6 — single error → observation only → Hard (NO demotion)
    r = await runSession('s3', T('2026-11-07T10:00:00Z'), [
      ev(NODE, 'error', 0.95, T('2026-11-07T10:00:00Z')),
    ])
    expect(r.applied[0]?.rating).toBe('Hard')
    s = await stateOf()
    expect(s?.stability).toBeCloseTo(20.51, 1)
    expect(s?.difficulty).toBeCloseTo(4.75, 1)
    expect(s?.lapses).toBe(0)

    // S4 d13 — second error session → GAP → Again, lapse, S collapses
    r = await runSession('s4', T('2026-11-14T10:00:00Z'), [
      ev(NODE, 'error', 0.9, T('2026-11-14T10:00:00Z')),
      ev(NODE, 'error', 0.85, T('2026-11-14T10:02:00Z')),
    ])
    expect(r.applied[0]?.rating).toBe('Again')
    s = await stateOf()
    expect(s?.fsrsState).toBe('Relearning')
    expect(s?.lapses).toBe(1)
    expect(s?.stability).toBeCloseTo(1.8, 1)
    expect(s?.difficulty).toBeCloseTo(8.26, 1)

    // S5–S8 — steady recovery → S≈36.77, mastery-eligible
    const steps: Array<[string, number]> = [
      ['2026-11-15T10:00:00Z', 3.34],
      ['2026-11-20T10:00:00Z', 8.67],
      ['2026-12-01T10:00:00Z', 19.31],
      ['2026-12-20T10:00:00Z', 36.77],
    ]
    for (const [when, expectedS] of steps) {
      r = await runSession('sn', T(when), [ev(NODE, 'correct', 0.9, T(when))])
      expect(r.applied[0]?.rating).toBe('Good')
      s = await stateOf()
      expect(s?.stability).toBeCloseTo(expectedS, 0)
    }
    expect(s?.reps).toBe(8)
    expect(s?.lapses).toBe(1)
    expect(s?.pendingDelayTest).toBe(true)
    expect(new Date(s?.delayTestEligibleAt as Date).toISOString().slice(0, 10)).toBe('2026-12-23')

    // metrics were emitted for every applied session
    const metrics = await prisma.metricEvent.count({
      where: { userId, name: 'evidence_applied', props: { contains: NODE } },
    })
    expect(metrics).toBe(8)
  })

  it('ending a session twice → 409 (ChatError ended)', async () => {
    const session = await prisma.chatSession.create({
      data: { userId, type: 'roleplay_targeted', status: 'active' },
    })
    await endSession(userId, session.id, T('2026-12-21T10:00:00Z'))
    await expect(endSession(userId, session.id, T('2026-12-21T10:01:00Z'))).rejects.toBeInstanceOf(ChatError)
  })
})

describe('propagation & root-cause through the DB (docs/03 §A4)', () => {
  it('a strong success on a child boosts its LEARNING prerequisite', async () => {
    const child = 'en:grammar:countable-uncountable'
    const prereq = 'en:chunk:how-many'
    // prereq is mid-learning → eligible for rescue
    await prisma.userNodeState.create({
      data: { userId, nodeId: prereq, skill: 'writing', displayState: 'learning', strength: 0.5, reps: 1 },
    })
    const session = await prisma.chatSession.create({
      data: { userId, type: 'roleplay_targeted', status: 'active', startedAt: T('2026-12-22T10:00:00Z') },
    })
    await writeTurnEvidence(userId, session.id, 't-prop', {
      ok: true,
      items: [
        ev(child, 'correct', 0.9, T('2026-12-22T10:00:00Z')),
        ev(child, 'correct', 0.9, T('2026-12-22T10:01:00Z')),
      ],
      newUnknownWords: [],
    })
    const r = await endSession(userId, session.id, T('2026-12-22T10:05:00Z'))
    expect(r.propagationEmitted).toBe(1)

    const propRow = await prisma.evidence.findFirst({
      where: { sessionId: session.id, nodeId: prereq, propagated: true },
    })
    expect(propRow).toBeTruthy()
    expect(propRow?.outcome).toBe('correct')
    expect(propRow?.confidence).toBeCloseTo(0.315, 3) // 0.35 × 0.9

    // the propagated item alone weighs 0.315 < 0.5 → NO FSRS update for the prereq
    const prereqState = await prisma.userNodeState.findUnique({
      where: { userId_nodeId_skill: { userId, nodeId: prereq, skill: 'writing' } },
    })
    expect(prereqState?.reps).toBe(1)
    // …but its strength moved toward positive
    expect(prereqState?.strength).toBeGreaterThan(0.5)
  })

  it('a confirmed gap with a weak prerequisite routes the error to the rot (root-cause)', async () => {
    // fresh pair untouched by the other tests: superlatives ← comparatives
    const child = 'en:grammar:superlatives'
    const prereq = 'en:grammar:comparatives'
    // the (sole) prerequisite is rotting: strength < 0.35
    await prisma.userNodeState.create({
      data: { userId, nodeId: prereq, skill: 'writing', displayState: 'available', strength: 0.1 },
    })

    // session 1: one confident error on the child (observation #1)
    const s1 = await prisma.chatSession.create({
      data: { userId, type: 'roleplay_targeted', status: 'active', startedAt: T('2026-12-23T10:00:00Z') },
    })
    await writeTurnEvidence(userId, s1.id, 't-rc1', {
      ok: true,
      items: [ev(child, 'error', 0.9, T('2026-12-23T10:00:00Z'))],
      newUnknownWords: [],
    })
    const r1 = await endSession(userId, s1.id, T('2026-12-23T10:05:00Z'))
    expect(r1.rootCaused).toEqual([]) // observation only, no gap yet
    const childAfterS1 = await prisma.userNodeState.findUnique({
      where: { userId_nodeId_skill: { userId, nodeId: child, skill: 'writing' } },
    })
    expect(childAfterS1?.reps).toBe(1)

    // session 2: another confident error → GAP confirmed → re-attribution
    const s2 = await prisma.chatSession.create({
      data: { userId, type: 'roleplay_targeted', status: 'active', startedAt: T('2026-12-24T10:00:00Z') },
    })
    await writeTurnEvidence(userId, s2.id, 't-rc2', {
      ok: true,
      items: [ev(child, 'error', 0.95, T('2026-12-24T10:00:00Z'))],
      newUnknownWords: [],
    })
    const r2 = await endSession(userId, s2.id, T('2026-12-24T10:05:00Z'))
    expect(r2.rootCaused).toContain(prereq)

    // the routed error exists as real (append-only, engine-generated) evidence
    const routed = await prisma.evidence.findFirst({
      where: { sessionId: s2.id, nodeId: prereq, propagated: true },
    })
    expect(routed).toBeTruthy()
    expect(routed?.outcome).toBe('error')
    expect(routed?.confidence).toBeCloseTo(0.95 * 0.7, 3)

    // …and was applied to the rot right away (first exposure, agg −1 → Again;
    // the docs/03 §A3 first-exposure anchor for Again is S=0.21)
    const prereqState = await prisma.userNodeState.findUnique({
      where: { userId_nodeId_skill: { userId, nodeId: prereq, skill: 'writing' } },
    })
    expect(prereqState?.reps).toBe(1)
    expect(prereqState?.stability).toBeCloseTo(0.21, 1)
  })
})

describe('growth trigger scan through the DB (docs/03 §B2–B3)', () => {
  it('2 error sessions on an unplanted frequent travel word → Seed proposed', async () => {
    const graph = loadGraph('en')
    const candidate = graph.byId.get('en:word:flight')!
    expect(candidate.frequencyRank).toBeLessThanOrEqual(5000)

    for (const day of ['2026-12-25T10:00:00Z', '2026-12-26T10:00:00Z']) {
      const session = await prisma.chatSession.create({
        data: { userId, type: 'roleplay_targeted', status: 'active', startedAt: T(day) },
      })
      await writeTurnEvidence(userId, session.id, `t-seed-${day}`, {
        ok: true,
        items: [ev(candidate.id, 'error', 0.9, T(day))],
        newUnknownWords: [],
      })
      await endSession(userId, session.id, T(day))
    }

    const seed = await prisma.seed.findFirst({
      where: { userId, candidateNodeId: candidate.id, status: 'proposed' },
    })
    expect(seed).toBeTruthy()
    expect(seed!.score).toBeGreaterThanOrEqual(0.45)
    expect(seed!.reasonFa).toBeTruthy()
    expect(seed!.triggerType).toBe('repeated_error')
    const breakdown = JSON.parse(seed!.scoreBreakdown) as { goalRelevance: number; frequency: number; novelty: number }
    expect(breakdown.goalRelevance).toBe(1.0) // travel tags ∩ travel goal
    expect(breakdown.novelty).toBe(1.0) // not planted before the scan

    // dedupe: a third error session must NOT propose the same seed again
    const s3 = await prisma.chatSession.create({
      data: { userId, type: 'roleplay_targeted', status: 'active', startedAt: T('2026-12-27T10:00:00Z') },
    })
    await writeTurnEvidence(userId, s3.id, 't-seed-3', {
      ok: true,
      items: [ev(candidate.id, 'error', 0.9, T('2026-12-27T10:00:00Z'))],
      newUnknownWords: [],
    })
    await endSession(userId, s3.id, T('2026-12-27T10:05:00Z'))
    const seeds = await prisma.seed.count({ where: { userId, candidateNodeId: candidate.id, status: 'proposed' } })
    expect(seeds).toBe(1)
  })

  it('summary lands on the ChatSession with the documented shape', async () => {
    const session = await prisma.chatSession.create({
      data: { userId, type: 'roleplay_targeted', status: 'active', startedAt: T('2026-12-28T10:00:00Z') },
    })
    await writeTurnEvidence(userId, session.id, 't-sum', {
      ok: true,
      items: [ev(NODE, 'correct', 0.9, T('2026-12-28T10:00:00Z'))],
      newUnknownWords: [],
    })
    const r = await endSession(userId, session.id, T('2026-12-28T10:05:00Z'))
    const row = await prisma.chatSession.findUnique({ where: { id: session.id } })
    expect(row?.status).toBe('ended')
    expect(row?.endedAt).toBeTruthy()
    const stored = JSON.parse(row!.summary!) as typeof r.summary
    expect(Array.isArray(stored.reinforced)).toBe(true)
    expect(stored.reinforced.some((x) => x.nodeId === NODE)).toBe(true)
    expect(Array.isArray(stored.fading)).toBe(true)
    expect(Array.isArray(stored.delayTestResults)).toBe(true)
    expect(Array.isArray(stored.seeds)).toBe(true)
    expect(typeof stored.tomorrow.reviewsDue).toBe('number')
  })
})
