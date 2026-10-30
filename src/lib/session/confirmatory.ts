/**
 * Confirmatory session service (docs/03 §A6, docs/05 M8) — the delayed-test
 * loop between the API routes and the pure engine:
 *
 *   startConfirmatorySession  ≤2 eligible nodes → 3 fresh contexts each
 *                             (cued recall, no hints, no warm-up, no LLM)
 *   runConfirmatoryTurn       learner answer → analyst grades → next context
 *                             (deterministic tutor replies, zero tutor LLM cost)
 *   gradeAndApplyProbes       turn-mapped evidence → gradeProbe →
 *                             applyDelayedTestOutcome (mastered / Again+7d / revoked)
 *
 * Ride-along probes (docs/00 C2) reuse the same machinery inside roleplay
 * sessions: planRideAlongProbes flips p≈0.3 at session start; chat.ts injects
 * the probe turns after a 2-turn warm-up.
 *
 * Failure policy unchanged: the analyst failing NEVER blocks the session —
 * a context without items grades as not-correct (gradeProbe).
 */
import { db } from '@/lib/db'
import { loadGraph } from '@/lib/graph/load'
import { ENGINE_CONFIG } from '@/lib/engine/config'
import { rngFromSeed } from '@/lib/engine/rng'
import {
  buildConfirmatoryContexts,
  gradeProbe,
  probeSlotFor,
  selectProbeNodes,
  type ProbeSpec,
  type StoredProbePlan,
} from '@/lib/engine/delayed-test'
import { applyDelayedTestOutcome, newState } from '@/lib/engine/state'
import type { NodeSkillState, Skill } from '@/lib/engine/types'
import { analyzeTurn, type AnalystInput, type AnalystResult } from '@/lib/llm/analyst'
import { writeTurnEvidence } from '@/lib/evidence/writer'
import { pickScenario } from './scenarios'
import { ChatError } from './errors'
import {
  collectDelayedTestStatus,
  loadStateMap,
  parseBriefColumn,
  persistState,
  stateKeyOf,
} from './db-map'
import type { BriefUserRow } from './brief-builder'

/** scenario id → fresh-context family (practice family to avoid in probes) */
const SCENARIO_FAMILY: Record<string, string> = {
  'hotel-checkin': 'travel',
  'lost-luggage': 'travel',
  'asking-directions': 'travel',
  'restaurant-reservation': 'daily',
  'weekend-plans': 'daily',
  'gift-shopping': 'shopping',
  pharmacy: 'health',
  'job-interview': 'work',
  'office-email': 'work',
  'weather-smalltalk': 'daily',
  'exam-study': 'study',
  'doctor-visit': 'health',
}

export function familyOfScenario(scenarioId: string | null): string {
  return (scenarioId && SCENARIO_FAMILY[scenarioId]) || 'daily'
}

// ─────────────────────────────────────────────────────────────────────────────
// candidate collection lives in db-map.ts (shared with brief-builder +
// status API). Ride-along probe PLANNING lives with the planner (planSession,
// p≈0.3) — chat.ts converts the plan's picked states into ProbeSpecs via
// probeSpecsFromStates below.
// ─────────────────────────────────────────────────────────────────────────────

export const RIDEALONG_WARMUP_TURNS = 2

/** a transition line so a ride-along probe does not collide with the roleplay */
export const RIDEALONG_TRANSITION = 'Quick side question —'

/**
 * Convert planner-picked states (plan.delayedTestProbes) into concrete probe
 * specs with fresh contexts, avoiding the session's practice family.
 */
export function probeSpecsFromStates(
  userId: string,
  day: string,
  picked: { nodeId: string; skill: Skill }[],
  practiceScenarioId: string | null,
): ProbeSpec[] {
  const graph = loadGraph('en')
  const practiceFamily = familyOfScenario(practiceScenarioId)
  const specs: ProbeSpec[] = []
  for (const p of picked) {
    const node = graph.byId.get(p.nodeId)
    if (!node) continue
    specs.push({
      nodeId: node.id,
      skill: p.skill,
      postMastery: false, // refined at grading time from the real state
      contexts: buildConfirmatoryContexts({ node, practiceFamily, rng: rngFromSeed(`${userId}:${node.id}:${day}`) }),
    })
  }
  return specs
}

// ─────────────────────────────────────────────────────────────────────────────
// start (explicit confirmatory session)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfirmatoryStartResult {
  started: boolean
  sessionId?: string
  opener?: { content: string; meta: Record<string, unknown> }
  /** probe-count summary for the UI (never the node ids — docs/00 C2) */
  plan?: { probeCount: number; contextsPerProbe: number }
  messageFa?: string
  eligible?: number
  pendingCount?: number
}

export async function startConfirmatorySession(
  user: BriefUserRow,
  now: Date = new Date(),
): Promise<ConfirmatoryStartResult> {
  const { eligible, pendingCount } = await collectDelayedTestStatus(user.id, now)

  if (eligible.length === 0) {
    return {
      started: false,
      eligible: 0,
      pendingCount,
      messageFa:
        pendingCount > 0
          ? `هنوز گره‌ای برای آزمون تأییدی آماده نیست — ${pendingCount} گره در آستانه‌ی تسلط‌اند و باید چند روز از آخرین مرورشان بگذرد.`
          : 'الان گره‌ای برای آزمون تأییدی آماده نیست. با تمرین بیشتر، گره‌ها به آستانه‌ی تسلط می‌رسند.',
    }
  }

  // practice family = today's deterministic roleplay scenario (docs/03 §A6:
  // probe contexts come from a DIFFERENT family than practice)
  const day = now.toISOString().slice(0, 10)
  const graph = loadGraph('en')
  const resolve = (nodeId: string) => {
    const n = graph.byId.get(nodeId)
    return n ? { id: n.id, title: n.title, glossFa: n.glossFa } : null
  }
  const practice = pickScenario(user.goal, `${user.id}:${day}`, resolve)
  const practiceFamily = familyOfScenario(practice.id)

  const picked = selectProbeNodes(eligible, ENGINE_CONFIG.DELAY_TEST_MAX_PER_SESSION, rngFromSeed(`${user.id}:${day}:confirmatory`))
  const probes: ProbeSpec[] = picked.map((c) => ({
    nodeId: c.node.id,
    skill: c.state.skill,
    postMastery: c.postMastery,
    contexts: buildConfirmatoryContexts({ node: c.node, practiceFamily, rng: rngFromSeed(`${user.id}:${c.node.id}:${day}:conf`) }),
  }))
  const plan: StoredProbePlan = { warmupTurns: 0, probes }

  const session = await db.chatSession.create({
    data: {
      userId: user.id,
      type: 'confirmatory',
      status: 'active',
      startedAt: now,
      brief: JSON.stringify({ probePlan: plan }),
    },
  })

  const first = probeSlotFor(plan, 1)!
  const opener = {
    content: probeContextText(plan, first.probeIndex, first.contextIndex),
    meta: { probe: { probeIndex: first.probeIndex, contextIndex: first.contextIndex }, confirmatory: true, opener: true },
  }
  await db.turn.create({
    data: { sessionId: session.id, role: 'tutor', content: opener.content, meta: JSON.stringify(opener.meta), createdAt: now },
  })
  await db.metricEvent
    .create({
      data: {
        userId: user.id,
        name: 'session_start',
        props: JSON.stringify({ sessionId: session.id, type: 'confirmatory', probes: probes.length }),
      },
    })
    .catch(() => {})

  return {
    started: true,
    sessionId: session.id,
    opener,
    plan: { probeCount: probes.length, contextsPerProbe: ENGINE_CONFIG.DELAY_TEST_CONTEXTS },
  }
}

export function probeContextText(plan: StoredProbePlan, probeIndex: number, contextIndex: number): string {
  return plan.probes[probeIndex].contexts[contextIndex].text
}

// ─────────────────────────────────────────────────────────────────────────────
// turn (explicit confirmatory mode — deterministic replies, analyst grades)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfirmatoryDeps {
  analyze?: (input: AnalystInput) => Promise<AnalystResult>
}

export const CONFIRMATORY_DONE_TEXT =
  'That was the last item — nicely done. End the session to see your results.'

export async function runConfirmatoryTurn(
  userId: string,
  sessionId: string,
  content: string,
  deps: ConfirmatoryDeps = {},
  now: Date = new Date(),
): Promise<{ tutor: string; meta: Record<string, unknown>; userTurnCount: number }> {
  const session = await db.chatSession.findUnique({ where: { id: sessionId } })
  if (!session || session.userId !== userId) throw new ChatError('not_found', 'session not found')
  if (session.status !== 'active') throw new ChatError('ended', 'session already ended')
  if (session.type !== 'confirmatory') throw new ChatError('wrong_type', 'not a confirmatory session')

  const { probePlan } = parseBriefColumn(session.brief)
  if (!probePlan) throw new ChatError('not_found', 'session has no probe plan')

  const userTurn = await db.turn.create({
    data: { sessionId, role: 'user', content, createdAt: now },
  })
  const allTurns = await db.turn.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } })
  const userTurnCount = allTurns.filter((t) => t.role === 'user').length

  // grade THIS answer against the context the previous tutor turn asked
  const answerSlot = probeSlotFor(probePlan, userTurnCount)
  if (answerSlot) {
    const analyze = deps.analyze ?? ((input: AnalystInput) => analyzeTurn(input))
    const node = loadGraph('en').byId.get(answerSlot.probe.nodeId)
    let analysis: AnalystResult | null = null
    try {
      analysis = await analyze({
        turnId: userTurn.id,
        tutorContext: probeContextText(probePlan, answerSlot.probeIndex, answerSlot.contextIndex),
        learnerText: content,
        knownNodes: node ? [{ id: node.id, title: node.title, type: node.type, glossFa: node.glossFa }] : [],
        targetNodeIds: [answerSlot.probe.nodeId],
        responseLatencyMs: 0,
      })
    } catch {
      analysis = null // grading failure must never block the session
    }
    if (analysis) {
      await writeTurnEvidence(userId, sessionId, userTurn.id, analysis)
    }
  }

  // the reply asks the NEXT context (or closes the session's item set)
  const nextSlot = probeSlotFor(probePlan, userTurnCount + 1)
  const reply = nextSlot
    ? probeContextText(probePlan, nextSlot.probeIndex, nextSlot.contextIndex)
    : CONFIRMATORY_DONE_TEXT
  const meta = nextSlot
    ? { probe: { probeIndex: nextSlot.probeIndex, contextIndex: nextSlot.contextIndex }, confirmatory: true }
    : { confirmatory: true, done: true }
  await db.turn.create({
    data: { sessionId, role: 'tutor', content: reply, meta: JSON.stringify(meta), createdAt: now },
  })

  return { tutor: reply, meta, userTurnCount }
}

// ─────────────────────────────────────────────────────────────────────────────
// end: grade all probes → mastery transitions → summary (docs/03 §A6)
// ─────────────────────────────────────────────────────────────────────────────

export interface DelayTestResultRow {
  nodeId: string
  skill: Skill
  passed: boolean
  mastered: boolean
  revoked: boolean
  title: string | null
  glossFa: string | null
  /** engine-applied outcome details for tests & observability */
  correct: number
  total: number
  skipped?: 'incomplete'
}

/**
 * Grade every probe of a session from its turn-mapped evidence and apply the
 * delayed-test outcomes to real state. Shared by the confirmatory pipeline
 * AND the roleplay pipeline (ride-along probes).
 *
 * Grading mapping: each tutor turn whose meta carries `probe` asked exactly
 * one context; the learner's NEXT message is that context's answer.
 */
export async function gradeAndApplyProbes(
  userId: string,
  sessionId: string,
  plan: StoredProbePlan,
  now: Date,
): Promise<DelayTestResultRow[]> {
  const graph = loadGraph('en')
  const turns = await db.turn.findMany({ where: { sessionId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })

  // context → answer turn id (the user turn right after the asking tutor turn)
  const asked = new Map<string, string>() // `${probeIndex}:${contextIndex}` → answer turnId
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i]
    if (t.role !== 'tutor') continue
    let meta: { probe?: { probeIndex?: number; contextIndex?: number } } = {}
    try {
      meta = JSON.parse(t.meta ?? '{}') as typeof meta
    } catch {
      continue
    }
    if (!meta.probe || typeof meta.probe.probeIndex !== 'number' || typeof meta.probe.contextIndex !== 'number') continue
    const answer = turns
      .slice(i + 1)
      .find((x) => x.role === 'user')
    if (answer) asked.set(`${meta.probe.probeIndex}:${meta.probe.contextIndex}`, answer.id)
  }

  const evidence = await db.evidence.findMany({ where: { sessionId, disputed: false } })
  const itemsFor = (turnId: string, nodeId: string, skill: Skill) =>
    evidence
      .filter((e) => e.turnId === turnId && e.nodeId === nodeId && e.skill === skill)
      .map((e) => ({
        id: e.id,
        nodeId: e.nodeId,
        skill: e.skill as Skill,
        outcome: e.outcome as never,
        confidence: e.confidence,
      }))

  const stateMap = await loadStateMap(userId)
  const results: DelayTestResultRow[] = []

  for (let probeIndex = 0; probeIndex < plan.probes.length; probeIndex++) {
    const probe = plan.probes[probeIndex]
    const perContext: ReturnType<typeof itemsFor>[] = []
    let complete = true
    for (let c = 0; c < ENGINE_CONFIG.DELAY_TEST_CONTEXTS; c++) {
      const turnId = asked.get(`${probeIndex}:${c}`)
      if (!turnId) {
        complete = false
        break
      }
      perContext.push(itemsFor(turnId, probe.nodeId, probe.skill))
    }

    const node = graph.byId.get(probe.nodeId)
    const key = stateKeyOf({ nodeId: probe.nodeId, skill: probe.skill } as NodeSkillState)
    const state = stateMap.get(key) ?? null

    // a probe whose 3 contexts were not all asked is SKIPPED — an early exit
    // must never punish the node (fair retry, docs/00 R-user-control)
    if (!complete || !node) {
      results.push({
        nodeId: probe.nodeId,
        skill: probe.skill,
        passed: false,
        mastered: false,
        revoked: false,
        title: node?.title ?? null,
        glossFa: node?.glossFa ?? null,
        correct: 0,
        total: perContext.length,
        skipped: 'incomplete',
      })
      continue
    }

    const grade = gradeProbe(perContext)
    // failed post-mastery probes are derived from prior session summaries —
    // only possible while mastery is actually set on the state
    const failedProbes = state?.masteredAt
      ? await countFailedProbesSinceMastery(userId, probe.nodeId, probe.skill, state.masteredAt, now)
      : 0

    const base = state ?? newState(userId, probe.nodeId, probe.skill)
    const outcome = applyDelayedTestOutcome(
      base,
      { correct: grade.correct, total: grade.total, minConfidence: grade.minConfidence, failedProbesSinceMastery: failedProbes },
      now,
    )
    await persistState(userId, outcome.updated)
    stateMap.set(key, outcome.updated)

    await db.metricEvent
      .create({
        data: {
          userId,
          name: 'delay_test_result',
          props: JSON.stringify({
            sessionId,
            nodeId: probe.nodeId,
            skill: probe.skill,
            passed: outcome.mastered,
            mastered: outcome.mastered,
            revoked: outcome.revoked,
            mode: probe.postMastery ? 'maintenance' : 'confirmation',
          }),
        },
      })
      .catch(() => {})

    results.push({
      nodeId: probe.nodeId,
      skill: probe.skill,
      passed: outcome.mastered,
      mastered: outcome.mastered,
      revoked: outcome.revoked,
      title: node.title,
      glossFa: node.glossFa,
      correct: grade.correct,
      total: grade.total,
    })
  }
  return results
}

/**
 * Failed probes since mastery was granted — derived from prior sessions'
 * stored summaries (append-only audit trail; no extra column needed).
 * Only sessions ENDED after `masteredAt` count.
 */
export async function countFailedProbesSinceMastery(
  userId: string,
  nodeId: string,
  skill: Skill,
  masteredAt: Date,
  now: Date,
): Promise<number> {
  void now
  const sessions = await db.chatSession.findMany({
    where: {
      userId,
      status: 'ended',
      endedAt: { gt: masteredAt },
      summary: { not: null },
    },
    select: { summary: true },
    orderBy: { endedAt: 'asc' },
    take: 50,
  })
  let failed = 0
  for (const s of sessions) {
    try {
      const parsed = JSON.parse(s.summary ?? '{}') as {
        delayTestResults?: { nodeId?: string; skill?: string; passed?: boolean }[]
      }
      for (const r of parsed.delayTestResults ?? []) {
        if (r.nodeId === nodeId && (r.skill ?? 'writing') === skill && r.passed === false) failed++
      }
    } catch {
      // corrupt summary — skip
    }
  }
  return failed
}
