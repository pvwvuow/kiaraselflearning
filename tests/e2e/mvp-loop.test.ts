/**
 * M8 acceptance — THE MVP SUCCESS CRITERION (docs/05 M8):
 * "E2E (mocked LLM): full loop — chat → evidence → state change → next
 * session brief reflects it → delayed test → mastery."
 *
 * Everything real except the LLMs: sessions, turns, evidence writer, §A7
 * pipeline, growth scan, brief builder, tree service, confirmatory service
 * and the pure FSRS core all run against the dev SQLite. The tutor chat and
 * the per-turn analyst are injected fakes (ChatDeps) — the network boundary
 * is covered by tests/llm/* and the route layer by tests/api/*.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { startSession, runTutorTurn, type ChatDeps } from '@/lib/session/chat'
import { endSession } from '@/lib/session/pipeline'
import { startConfirmatorySession, runConfirmatoryTurn } from '@/lib/session/confirmatory'
import { buildBriefBundle } from '@/lib/session/brief-builder'
import { getTreeView } from '@/lib/tree/tree-service'
import { writeTurnEvidence } from '@/lib/evidence/writer'
import type { AnalystResult, AnalystInput } from '@/lib/llm/analyst'
import type { EvidenceItem } from '@/lib/engine/types'

const prisma = new PrismaClient()
const DOMAIN = 'e2e-mvp.test'
const NODE = 'en:word:flight' // A2 · rank 1600 · travel — goal-relevant practice target
const T = (s: string) => new Date(s)
const minute = 60_000

// ── fakes ──

/** tutor LLM: short i+1-friendly lines; the opener asks a question like a real tutor */
const tutorDeps: ChatDeps = {
  chat: async (opts) => ({
    ok: true,
    content:
      opts.messages.at(-1)?.role === 'user'
        ? 'Great — tell me more about your plans!'
        : 'Hello! I am your travel helper. Where do you want to go?',
    model: 'grok-fake',
    latencyMs: 3,
    promptTokens: 50,
    completionTokens: 12,
  }),
}

/** analyst fake: per-call script (one EvidenceItem[] per turn, in order) */
function analystScript(script: EvidenceItem[][]): (input: AnalystInput) => Promise<AnalystResult> {
  let call = 0
  return async () => ({ ok: true, items: script[call++] ?? [], newUnknownWords: [] })
}

const correctFlight = (confidence = 0.9): EvidenceItem => ({
  nodeId: NODE,
  skill: 'writing',
  outcome: 'correct',
  confidence,
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } })
  await prisma.$disconnect()
})

describe('E2E: chat → evidence → tree → brief → delayed test → mastery', () => {
  it('runs the complete MVP loop', async () => {
    // ── 0. a fresh learner (onboarding done elsewhere) ──
    const u = await prisma.user.create({
      data: {
        email: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`,
        passwordHash: 'x',
        goal: 'travel',
        cefrSelf: 'A2',
        dailyMinutes: 15,
        consentLlmAt: new Date(),
      },
    })
    const userId = u.id
    const userRow = {
      id: userId,
      cefrComputed: null,
      cefrSelf: 'A2',
      goal: 'travel',
      interests: '["food","travel"]',
      correctionStyle: 'immediate',
      dailyMinutes: 15,
    }
    const D0 = T('2027-03-01T09:00:00Z')

    // ── 1. CHAT: roleplay session with a real brief, opener and turn ──
    const start = await startSession(userRow, tutorDeps, D0)
    expect(start.sessionId).toBeTruthy()
    expect(start.brief.knownLexicon.A2).toBe(0) // knows nothing yet

    await runTutorTurn(
      userId,
      start.sessionId,
      'My flight leaves at six in the morning.',
      { ...tutorDeps, analyze: analystScript([[correctFlight(0.9), correctFlight(0.85)]]) },
      new Date(D0.getTime() + minute),
    )

    // ── 2. EVIDENCE → state change (§A7 pipeline) ──
    const ended = await endSession(userId, start.sessionId, new Date(D0.getTime() + 10 * minute))
    expect(ended.applied).toHaveLength(1)
    expect(ended.applied[0].rating).toBe('Good')

    const s1 = await prisma.userNodeState.findUnique({
      where: { userId_nodeId_skill: { userId, nodeId: NODE, skill: 'writing' } },
    })
    expect(s1?.reps).toBe(1)
    expect(s1?.displayState).toBe('learning')
    expect(s1?.lastAppliedEvidenceId).toBeTruthy()

    // ── 3. TREE reflects it ──
    const tree1 = await getTreeView(userId, new Date(D0.getTime() + 11 * minute))
    const node1 = tree1.nodes.find((n) => n.id === NODE)
    expect(node1?.state).toBe('learning')
    expect(node1?.skills.writing?.reps).toBe(1)

    // ── 4. NEXT BRIEF reflects the change ──
    const brief2 = await buildBriefBundle(userRow, new Date(D0.getTime() + 12 * minute))
    expect(brief2.brief.knownLexicon.A2).toBe(1) // flight now counts as known
    expect(brief2.brief.knownLexicon.sampleLemmas).toContain('flight')
    expect(brief2.knownLemmas).toContain('flight')

    // ── 5. practice ladder → mastery-eligible (reps≥4, S≥21d, pending flag) ──
    // clean Good sessions at the documented gaps
    const days = ['2027-03-03', '2027-03-07', '2027-03-14', '2027-03-21']
    for (const [i, day] of days.entries()) {
      const when = T(`${day}T09:00:00Z`)
      const sess = await prisma.chatSession.create({
        data: { userId, type: 'roleplay_targeted', status: 'active', startedAt: when },
      })
      await writeTurnEvidence(userId, sess.id, `turn-${i}`, {
        ok: true,
        items: [correctFlight(0.9), correctFlight(0.85)],
        newUnknownWords: [],
      })
      await endSession(userId, sess.id, new Date(when.getTime() + 5 * minute))
    }
    const s5 = await prisma.userNodeState.findUnique({
      where: { userId_nodeId_skill: { userId, nodeId: NODE, skill: 'writing' } },
    })
    expect(s5?.reps).toBe(5)
    expect(s5?.pendingDelayTest).toBe(true)
    expect(s5?.delayTestEligibleAt).toBeTruthy()
    expect(s5?.masteredAt).toBeNull() // NEVER mastered without the delayed test

    // the tree now shows the candidate… still honestly "learning"
    const tree2 = await getTreeView(userId, T('2027-03-21T10:00:00Z'))
    expect(tree2.nodes.find((n) => n.id === NODE)?.state).toBe('learning')

    // ── 6. DELAYED TEST (confirmatory session, deterministic, no tutor LLM) ──
    const probeDate = T('2027-03-25T09:00:00Z') // ≥ delayTestEligibleAt (lastReview 03-21T09:05 +3d)
    const conf = await startConfirmatorySession(userRow, probeDate)
    expect(conf.started).toBe(true)
    expect(conf.plan).toEqual({ probeCount: 1, contextsPerProbe: 3 })
    const confId = conf.sessionId!

    // 3 fresh contexts, all asked by deterministic tutor turns
    const confTurns = await prisma.turn.findMany({ where: { sessionId: confId } })
    expect(confTurns).toHaveLength(1)
    expect(confTurns[0].meta).toContain('"probe"')
    expect(confTurns[0].content).toContain('ONE correct English sentence')

    // 2/3 correct @0.9 → pass
    const probeAnalyst = analystScript([
      [correctFlight(0.95)],
      [correctFlight(0.9)],
      [{ ...correctFlight(), outcome: 'error', produced: 'I flight to Tehran.', expected: 'I fly to Tehran.' }],
    ])
    for (let i = 1; i <= 3; i++) {
      const r = await runConfirmatoryTurn(
        userId,
        confId,
        `I booked my flight for Monday. (${i})`,
        { analyze: probeAnalyst },
        new Date(probeDate.getTime() + i * minute),
      )
      expect(r.userTurnCount).toBe(i)
    }

    // ── 7. MASTERY — the delayed test is the only door to mastered ──
    const confEnd = await endSession(userId, confId, new Date(probeDate.getTime() + 6 * minute))
    expect(confEnd.applied).toHaveLength(0) // no §A7 double-application
    const d = confEnd.summary.delayTestResults[0]
    expect(d.nodeId).toBe(NODE)
    expect(d.mastered).toBe(true)
    expect(d.revoked).toBe(false)
    expect(d.correct).toBe(2)
    expect(d.total).toBe(3)

    const sFinal = await prisma.userNodeState.findUnique({
      where: { userId_nodeId_skill: { userId, nodeId: NODE, skill: 'writing' } },
    })
    expect(sFinal?.masteredAt).toBeTruthy()
    expect(sFinal?.pendingDelayTest).toBe(false)
    expect(sFinal?.reps).toBe(6) // pass advanced the card (maintenance schedule)

    // the tree finally shows the mastered crown
    const tree3 = await getTreeView(userId, new Date(probeDate.getTime() + 7 * minute))
    expect(tree3.nodes.find((n) => n.id === NODE)?.state).toBe('mastered')

    // …and the next brief counts it as known, ready for the next frontier
    const brief3 = await buildBriefBundle(userRow, new Date(probeDate.getTime() + 8 * minute))
    expect(brief3.brief.knownLexicon.A2).toBe(1)
  })
})
