/**
 * M8 acceptance (docs/05 M8) — confirmatory delayed tests through the REAL
 * database and the REAL pipeline: start → 3 turns per probe (mocked analyst,
 * real evidence writer) → endSession → mastery / revocation transitions.
 * The tutor path is deterministic (no LLM anywhere in the confirmatory loop).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { startConfirmatorySession, runConfirmatoryTurn } from '@/lib/session/confirmatory'
import { endSession } from '@/lib/session/pipeline'
import type { AnalystResult } from '@/lib/llm/analyst'
import type { EvidenceItem } from '@/lib/engine/types'

const prisma = new PrismaClient()
const DOMAIN = 'confirmatory.test'
const NODE = 'en:word:recommend'
const T = (s: string) => new Date(s)
const minute = 60_000

let userId = ''

function analystScript(script: EvidenceItem[][]): (input: { turnId: string }) => Promise<AnalystResult> {
  let call = 0
  return async () => {
    const items = script[call++] ?? []
    return { ok: true, items, newUnknownWords: [] }
  }
}

/** a mastery-eligible state for NODE (reps≥4, S≥21d, ≥3d old, pending, Review) */
async function seedEligibleState(over: Record<string, unknown> = {}): Promise<void> {
  await prisma.userNodeState.create({
    data: {
      userId,
      nodeId: NODE,
      skill: 'writing',
      reps: 5,
      stability: 30,
      difficulty: 4.5,
      fsrsState: 'Review',
      lastReviewAt: T('2027-01-04T10:00:00Z'),
      due: T('2027-02-03T10:00:00Z'),
      pendingDelayTest: true,
      delayTestEligibleAt: T('2027-01-07T10:00:00Z'),
      strength: 0.7,
      displayState: 'learning',
      ...over,
    },
  })
}

const correct = (confidence = 0.9): EvidenceItem => ({
  nodeId: NODE,
  skill: 'writing',
  outcome: 'correct',
  confidence,
})

beforeEach(async () => {
  if (!userId) {
    const u = await prisma.user.create({
      data: {
        email: `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`,
        passwordHash: 'x',
        goal: 'travel',
        dailyMinutes: 15,
        consentLlmAt: new Date(),
      },
    })
    userId = u.id
  }
  // fresh slate per test: sessions (cascades evidence), the probed state, metrics
  await prisma.chatSession.deleteMany({ where: { userId } })
  await prisma.userNodeState.deleteMany({ where: { userId, nodeId: NODE } })
  await prisma.metricEvent.deleteMany({ where: { userId, name: 'delay_test_result' } })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } })
  await prisma.$disconnect()
})

describe('confirmatory sessions through the DB (docs/03 §A6)', () => {
  it('start → 3 contexts → 2/3 correct @0.9 → mastered; summary + metrics land', async () => {
    await seedEligibleState()

    const started = await startConfirmatorySession(
      { id: userId, cefrComputed: null, cefrSelf: 'A2', goal: 'travel', interests: '[]', correctionStyle: 'immediate', dailyMinutes: 15 },
      T('2027-01-10T10:00:00Z'),
    )
    expect(started.started).toBe(true)
    expect(started.sessionId).toBeTruthy()
    expect(started.plan).toEqual({ probeCount: 1, contextsPerProbe: 3 })

    const sessionId = started.sessionId!
    const analyze = analystScript([[correct()], [correct(0.95)], [{ ...correct(), outcome: 'error' }]])

    // 3 answers, one minute apart (deterministic turn ordering)
    let r = await runConfirmatoryTurn(userId, sessionId, 'I recommend the airport hotel.', { analyze }, T('2027-01-10T10:01:00Z'))
    expect(r.userTurnCount).toBe(1)
    r = await runConfirmatoryTurn(userId, sessionId, 'I recommend the lounge.', { analyze }, T('2027-01-10T10:02:00Z'))
    r = await runConfirmatoryTurn(userId, sessionId, 'I recommend the bus.', { analyze }, T('2027-01-10T10:03:00Z'))
    // after the plan, the deterministic closing line asks to end the session
    expect(r.tutor).toContain('End the session')

    const ended = await endSession(userId, sessionId, T('2027-01-10T10:05:00Z'))
    expect(ended.applied).toEqual([]) // no §A7 aggregation for confirmatory sessions
    const result = ended.summary.delayTestResults.find((d) => d.nodeId === NODE)
    expect(result?.passed).toBe(true)
    expect(result?.mastered).toBe(true)
    expect(result?.revoked).toBe(false)
    expect(result?.correct).toBe(2)
    expect(result?.total).toBe(3)
    expect(result?.title).toBe('recommend')

    const state = await prisma.userNodeState.findUnique({
      where: { userId_nodeId_skill: { userId, nodeId: NODE, skill: 'writing' } },
    })
    expect(state?.masteredAt).toBeTruthy()
    expect(state?.displayState).toBe('mastered')
    expect(state?.pendingDelayTest).toBe(false)
    // the pass advanced the card (Good) → a future maintenance probe is scheduled
    expect(state?.reps).toBe(6)
    expect(state!.due!.getTime()).toBeGreaterThan(T('2027-01-10T10:00:00Z').getTime())

    const stored = JSON.parse((await prisma.chatSession.findUnique({ where: { id: sessionId } }))!.summary!)
    expect(stored.delayTestResults[0].passed).toBe(true)

    const metric = await prisma.metricEvent.findFirst({
      where: { userId, name: 'delay_test_result', props: { contains: NODE } },
    })
    expect(metric).toBeTruthy()
  })

  it('ending early (incomplete probe) skips the node — no punishment', async () => {
    await seedEligibleState()
    const started = await startConfirmatorySession(
      { id: userId, cefrComputed: null, cefrSelf: 'A2', goal: 'travel', interests: '[]', correctionStyle: 'immediate', dailyMinutes: 15 },
      T('2027-01-11T10:00:00Z'),
    )
    const sessionId = started.sessionId!
    await runConfirmatoryTurn(userId, sessionId, 'I recommend the hotel.', {}, T('2027-01-11T10:01:00Z'))

    const ended = await endSession(userId, sessionId, T('2027-01-11T10:05:00Z'))
    const result = ended.summary.delayTestResults.find((d) => d.nodeId === NODE)
    expect(result?.skipped).toBe('incomplete')

    const state = await prisma.userNodeState.findUnique({
      where: { userId_nodeId_skill: { userId, nodeId: NODE, skill: 'writing' } },
    })
    expect(state?.masteredAt).toBeNull()
    expect(state?.pendingDelayTest).toBe(true) // untouched — fair retry later
  })

  it('low confidence (3/3 @0.6) does NOT master; fail path sets the 7d retry', async () => {
    await seedEligibleState()
    const started = await startConfirmatorySession(
      { id: userId, cefrComputed: null, cefrSelf: 'A2', goal: 'travel', interests: '[]', correctionStyle: 'immediate', dailyMinutes: 15 },
      T('2027-01-12T10:00:00Z'),
    )
    const sessionId = started.sessionId!
    const analyze = analystScript([[correct(0.6)], [correct(0.6)], [correct(0.6)]])
    for (const m of ['a', 'b', 'c']) {
      await runConfirmatoryTurn(userId, sessionId, `I recommend the ${m}.`, { analyze }, new Date(T('2027-01-12T10:00:00Z').getTime() + minute))
    }
    const ended = await endSession(userId, sessionId, T('2027-01-12T10:05:00Z'))
    const result = ended.summary.delayTestResults.find((d) => d.nodeId === NODE)
    expect(result?.passed).toBe(false)
    expect(result?.correct).toBe(0) // below the 0.8 floor items are not "correct"

    const state = await prisma.userNodeState.findUnique({
      where: { userId_nodeId_skill: { userId, nodeId: NODE, skill: 'writing' } },
    })
    expect(state?.masteredAt).toBeNull()
    expect(state?.pendingDelayTest).toBe(false)
    expect(state!.delayTestEligibleAt!.getTime()).toBe(T('2027-01-19T10:05:00Z').getTime()) // +7d
    expect(state?.fsrsState).toBe('Relearning') // Again applied
  })

  it('double-fail post-mastery → revoked to learning (docs/03 §A6 revocation)', async () => {
    await seedEligibleState()
    const userRow = { id: userId, cefrComputed: null, cefrSelf: 'A2', goal: 'travel', interests: '[]', correctionStyle: 'immediate', dailyMinutes: 15 }

    // pass → mastered
    const passRun = await startConfirmatorySession(userRow, T('2027-01-13T10:00:00Z'))
    const passAnalyze = analystScript([[correct()], [correct()], [{ ...correct(), outcome: 'error' }]])
    for (let i = 1; i <= 3; i++) {
      await runConfirmatoryTurn(userId, passRun.sessionId!, 'I recommend it.', { analyze: passAnalyze }, new Date(T('2027-01-13T10:00:00Z').getTime() + i * minute))
    }
    const masteryDate = T('2027-01-13T10:10:00Z')
    await endSession(userId, passRun.sessionId!, masteryDate)
    let state = await prisma.userNodeState.findUnique({ where: { userId_nodeId_skill: { userId, nodeId: NODE, skill: 'writing' } } })
    expect(state?.masteredAt).toBeTruthy()

    // maintenance probe #1 when the card comes due (read the real schedule)
    const due1 = state!.due!
    const fail1Date = new Date(due1.getTime() + 24 * 3600_000)
    const run1 = await startConfirmatorySession(userRow, fail1Date)
    expect(run1.started).toBe(true)
    const fail1Analyze = analystScript([[{ ...correct(), outcome: 'error' }], [{ ...correct(), outcome: 'error' }], [{ ...correct(), outcome: 'error' }]])
    for (let i = 1; i <= 3; i++) {
      await runConfirmatoryTurn(userId, run1.sessionId!, 'wrong answer', { analyze: fail1Analyze }, new Date(fail1Date.getTime() + i * minute))
    }
    const end1 = await endSession(userId, run1.sessionId!, new Date(fail1Date.getTime() + 5 * minute))
    const r1 = end1.summary.delayTestResults.find((d) => d.nodeId === NODE)
    expect(r1?.passed).toBe(false)
    expect(r1?.revoked).toBe(false) // first fail: mastery kept, under scrutiny

    state = await prisma.userNodeState.findUnique({ where: { userId_nodeId_skill: { userId, nodeId: NODE, skill: 'writing' } } })
    expect(state?.masteredAt).toBeTruthy() // still mastered
    const retryAt = state!.delayTestEligibleAt! // +7d

    // maintenance probe #2 after the 7d retry window → second fail → revoked
    const fail2Date = new Date(retryAt.getTime() + 24 * 3600_000)
    const run2 = await startConfirmatorySession(userRow, fail2Date)
    expect(run2.started).toBe(true)
    const fail2Analyze = analystScript([[{ ...correct(), outcome: 'error' }], [{ ...correct(), outcome: 'error' }], [correct(0.9)]])
    for (let i = 1; i <= 3; i++) {
      await runConfirmatoryTurn(userId, run2.sessionId!, 'still wrong', { analyze: fail2Analyze }, new Date(fail2Date.getTime() + i * minute))
    }
    const end2 = await endSession(userId, run2.sessionId!, new Date(fail2Date.getTime() + 5 * minute))
    const r2 = end2.summary.delayTestResults.find((d) => d.nodeId === NODE)
    expect(r2?.revoked).toBe(true)
    expect(r2?.mastered).toBe(false)

    state = await prisma.userNodeState.findUnique({ where: { userId_nodeId_skill: { userId, nodeId: NODE, skill: 'writing' } } })
    expect(state?.masteredAt).toBeNull()
    expect(state?.displayState).toBe('learning')
  })

  it('no eligible nodes → started:false with a Persian message and pending count', async () => {
    const fresh = await prisma.user.create({
      data: {
        email: `vitest-fresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`,
        passwordHash: 'x',
        goal: 'travel',
        consentLlmAt: new Date(),
      },
    })
    const r = await startConfirmatorySession(
      { id: fresh.id, cefrComputed: null, cefrSelf: null, goal: 'travel', interests: '[]', correctionStyle: 'immediate', dailyMinutes: 15 },
      T('2027-01-14T10:00:00Z'),
    )
    expect(r.started).toBe(false)
    expect(r.messageFa).toBeTruthy()
    expect(r.eligible).toBe(0)
  })
})
