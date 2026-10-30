/**
 * Session-end pipeline (docs/03 §A7) — the deterministic bridge from Evidence
 * to state. Runs EXACTLY once per session (status guard makes it idempotent):
 *
 *   evs = Evidence(session, disputed=false)  → group by (nodeId, skill)
 *   pass A: propagation emits (A4 down) from pre-update states, merged into groups
 *   pass B: per group → aggregate (A1) → rating (A2) → FSRS (A3) → persist → display (A5)
 *   pass C: root-cause re-attribution (A4 up) for confirmed gaps → apply to the weak prereq
 *   pass D: growth scan (B2/B3) → Seed proposals
 *   summary (docs/02 §3.3) + metrics + session closed
 *
 * This module is DB wiring only — every decision comes from the pure engine.
 */
import { db } from '@/lib/db'
import { loadGraph } from '@/lib/graph/load'
import { ENGINE_CONFIG } from '@/lib/engine/config'
import { aggregateSession } from '@/lib/engine/grading'
import { applySessionReview, computeDisplayState, propagateFromSuccess, rootCauseAttribution } from '@/lib/engine/state'
import { scanRepeatedErrors, buildSeedDraft } from '@/lib/engine/growth'
import { prerequisitesOf } from '@/lib/engine/graph'
import { rowToState } from './brief-builder'
import { writeEngineEvidence } from '@/lib/evidence/writer'
import { ChatError } from './chat'
import type { EngineEdge, EvidenceItem, FsrsRating, NodeSkillState, Skill } from '@/lib/engine/types'

export interface AppliedGroup {
  nodeId: string
  skill: Skill
  rating: FsrsRating | null
  agg: number
  weight: number
}

export interface SeedProposal {
  seedId: string
  nodeId: string | null
  score: number
  reasonFa: string | null
}

export interface SessionEndResult {
  sessionId: string
  applied: AppliedGroup[]
  propagationEmitted: number
  rootCaused: string[]
  seeds: SeedProposal[]
  summary: {
    reinforced: { nodeId: string; skill: Skill; grade: FsrsRating }[]
    fading: { nodeId: string; skill: Skill }[]
    delayTestResults: { nodeId: string; passed: boolean }[]
    seeds: SeedProposal[]
    tomorrow: { reviewsDue: number; newCandidates: string[]; remedial: string[] }
  }
}

const CONFIDENT = 0.6 // = ENGINE_CONFIG.CONFIDENT_EVIDENCE (import would be fine too)

function rowToItem(row: {
  id: string
  nodeId: string
  skill: string
  outcome: string
  errorType: string | null
  produced: string | null
  expected: string | null
  l1Interference: boolean
  hintUsed: boolean
  responseLatencyMs: number | null
  confidence: number
  propagated: boolean
  disputed: boolean
}): EvidenceItem {
  return {
    id: row.id,
    nodeId: row.nodeId,
    skill: row.skill as Skill,
    outcome: row.outcome as EvidenceItem['outcome'],
    errorType: row.errorType,
    produced: row.produced,
    expected: row.expected,
    l1Interference: row.l1Interference,
    hintUsed: row.hintUsed,
    responseLatencyMs: row.responseLatencyMs,
    confidence: row.confidence,
    propagated: row.propagated,
    disputed: row.disputed,
  }
}

function groupKey(nodeId: string, skill: Skill): string {
  return `${nodeId}::${skill}`
}

/** distinct PAST sessions with a confident error for (nodeId, skill) */
async function priorErrorSessions(userId: string, nodeId: string, skill: Skill, currentSessionId: string): Promise<number> {
  const rows = await db.evidence.findMany({
    where: {
      userId,
      nodeId,
      skill,
      outcome: 'error',
      confidence: { gte: CONFIDENT },
      disputed: false,
      sessionId: { not: currentSessionId },
    },
    select: { sessionId: true },
    distinct: ['sessionId'],
  })
  return rows.length
}

async function persistState(userId: string, s: NodeSkillState): Promise<void> {
  const data = {
    stability: s.stability,
    difficulty: s.difficulty,
    due: s.due,
    lastReviewAt: s.lastReviewAt,
    reps: s.reps,
    lapses: s.lapses,
    learningSteps: s.learningSteps,
    fsrsState: s.fsrsState,
    displayState: s.displayState,
    strength: s.strength,
    pendingDelayTest: s.pendingDelayTest,
    delayTestEligibleAt: s.delayTestEligibleAt,
    masteredAt: s.masteredAt,
    lastAppliedEvidenceId: s.lastAppliedEvidenceId,
  }
  await db.userNodeState.upsert({
    where: { userId_nodeId_skill: { userId, nodeId: s.nodeId, skill: s.skill } },
    create: { userId, nodeId: s.nodeId, skill: s.skill, ...data },
    update: data,
  })
}

export async function endSession(userId: string, sessionId: string, now: Date = new Date()): Promise<SessionEndResult> {
  const session = await db.chatSession.findUnique({ where: { id: sessionId } })
  if (!session || session.userId !== userId) throw new ChatError('not_found', 'session not found')
  if (session.status === 'ended') throw new ChatError('ended', 'session already ended')

  const graph = loadGraph('en')
  const rows = await db.evidence.findMany({ where: { sessionId, disputed: false } })

  // ── group evidence by (nodeId, skill) ──
  const groups = new Map<string, EvidenceItem[]>()
  for (const row of rows) {
    const item = rowToItem(row)
    const key = groupKey(item.nodeId, item.skill)
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }

  // user states (pre-update snapshot for propagation/root-cause decisions)
  const stateRows = await db.userNodeState.findMany({ where: { userId } })
  const stateMap = new Map<string, NodeSkillState>()
  for (const r of stateRows) {
    const s = rowToState(r)
    stateMap.set(groupKey(s.nodeId, s.skill), s)
  }
  const prereqStateMap = (nodeId: string, skill: Skill): Map<string, NodeSkillState | null> => {
    const m = new Map<string, NodeSkillState | null>()
    for (const p of prerequisitesOf(nodeId, graph.edges)) {
      m.set(p, stateMap.get(groupKey(p, skill)) ?? null)
    }
    return m
  }

  // ── pass A: downward propagation (docs/03 §A4) — emits from pre-update states ──
  const emitted: EvidenceItem[] = []
  for (const [key, items] of groups) {
    const [nodeId, skill] = [key.split('::')[0], key.split('::')[1] as Skill]
    const node = graph.byId.get(nodeId)
    if (!node) continue
    const emits = propagateFromSuccess({
      node,
      skill,
      items,
      agg: aggregateSession(items).agg,
      edges: graph.edges,
      prereqStates: prereqStateMap(nodeId, skill),
      sessionId,
      turnId: items[items.length - 1].id ?? '',
      userId,
    })
    for (const e of emits) {
      emitted.push({ ...e, id: undefined })
    }
  }
  // persist the emitted rows FIRST (append-only audit trail), then merge the
  // now-id'd items into the target groups (A1: joins the same aggregate)
  if (emitted.length > 0) {
    const written = await writeEngineEvidence(userId, sessionId, emitted)
    written.ids.forEach((id, i) => {
      emitted[i].id = id
    })
  }
  // merge emitted evidence into the target groups (A1: joins the same aggregate)
  for (const e of emitted) {
    const key = groupKey(e.nodeId, e.skill)
    const list = groups.get(key) ?? []
    list.push(e)
    groups.set(key, list)
  }

  // ── pass B: aggregate → rating → FSRS → persist (deterministic order) ──
  const applied: AppliedGroup[] = []
  const gapGroups: { nodeId: string; skill: Skill; items: EvidenceItem[] }[] = []
  const sortedKeys = [...groups.keys()].sort()

  for (const key of sortedKeys) {
    const [nodeId, skill] = [key.split('::')[0], key.split('::')[1] as Skill]
    const items = groups.get(key)!
    const node = graph.byId.get(nodeId)
    if (!node) continue // whitelist guarantees existence; belt & braces

    const state = stateMap.get(key) ?? null
    const priorErr = await priorErrorSessions(userId, nodeId, skill, sessionId)

    const result = applySessionReview({
      state,
      items,
      priorErrorSessions: priorErr,
      now,
      nodeType: node.type,
      userId,
    })

    await persistState(userId, result.updated)
    stateMap.set(key, result.updated)

    // report the raw session aggregate next to the rating (docs/03 §A1–A2) —
    // the ENGINE's aggregateSession is the single source of truth
    const aggResult = aggregateSession(items)
    applied.push({ nodeId, skill, rating: result.rating, agg: aggResult.agg, weight: aggResult.totalWeight })
    if (result.gapConfirmed) gapGroups.push({ nodeId, skill, items })

    await db.metricEvent
      .create({
        data: {
          userId,
          name: 'evidence_applied',
          props: JSON.stringify({ sessionId, nodeId, skill, rating: result.rating }),
        },
      })
      .catch(() => {})
  }

  // ── pass C: root-cause re-attribution for confirmed gaps (docs/03 §A4 up) ──
  const rootCaused: string[] = []
  for (const g of gapGroups) {
    const node = graph.byId.get(g.nodeId)
    if (!node) continue
    const routed = rootCauseAttribution({
      node,
      gapConfirmed: true,
      items: g.items,
      edges: graph.edges,
      prereqStates: prereqStateMap(g.nodeId, g.skill),
    })
    if (!routed) continue

    // the routed error becomes real (append-only, engine-generated) evidence…
    const written = await writeEngineEvidence(userId, sessionId, [{ ...routed.evidence, id: undefined }])
    rootCaused.push(routed.routeToNodeId)

    // …and is applied to the weak prerequisite right away
    const pKey = groupKey(routed.routeToNodeId, g.skill)
    const pState = stateMap.get(pKey) ?? null
    const pNode = graph.byId.get(routed.routeToNodeId)
    if (pNode) {
      const routedItem = { ...routed.evidence, id: written.ids[0] }
      const pResult = applySessionReview({
        state: pState,
        items: [routedItem],
        priorErrorSessions: await priorErrorSessions(userId, routed.routeToNodeId, g.skill, sessionId),
        now,
        nodeType: pNode.type,
        userId,
      })
      await persistState(userId, pResult.updated)
      stateMap.set(pKey, pResult.updated)
    }
  }

  // ── pass D: growth scan (docs/03 §B2–B3) ──
  const seeds: SeedProposal[] = []

  // B4 hygiene: proposals older than their expiry leave the queue (over-cap
  // seeds stay proposed until then — punishing nobody, just aging out).
  await db.seed
    .updateMany({
      where: { userId, status: 'proposed', expiresAt: { lt: now } },
      data: { status: 'expired' },
    })
    .catch(() => {})

  // B4 (M7): a REJECTED proposal mutes its node for 14 days — no re-proposal
  // of the same node (plant_existing by candidateNodeId, track_pattern by the
  // triggerRef source node). Rejections must never come back to haunt the user.
  const mutedNodeIds = new Set<string>()
  try {
    const recentRejected = await db.seed.findMany({
      where: {
        userId,
        status: 'rejected',
        decidedAt: {
          gte: new Date(now.getTime() - ENGINE_CONFIG.SEED_REJECT_COOLDOWN_DAYS * 86_400_000),
        },
      },
      select: { candidateNodeId: true, triggerRef: true },
    })
    for (const r of recentRejected) {
      if (r.candidateNodeId) mutedNodeIds.add(r.candidateNodeId)
      try {
        const ref = JSON.parse(r.triggerRef ?? '{}') as { nodeId?: string }
        if (ref.nodeId) mutedNodeIds.add(ref.nodeId)
      } catch {
        // corrupt row — ignore
      }
    }
  } catch {
    // defensive: a cooldown lookup failure must never block the pipeline
  }

  const allErrorEvidence = await db.evidence.findMany({
    where: { userId, disputed: false, outcome: 'error', confidence: { gte: CONFIDENT } },
  })
  // "active UserNodeState" (docs/03 §B2) = a node that is part of the user's
  // tree: planted-but-unpracticed (available/assumed_known) or practiced with
  // any success (strength > 0). States created PURELY by error evidence
  // (reps ≥ 1, strength 0) are error-tracking, not adoption — otherwise the
  // plant_existing trigger could never fire (any analyzed error creates a state).
  const activeNodeIds = new Set(
    stateRows
      .filter((s) => s.displayState === 'available' || s.displayState === 'assumed_known' || s.strength > 0)
      .map((s) => s.nodeId),
  )
  const existingErrorPatternIds = new Set(graph.nodes.filter((n) => n.type === 'error_pattern').map((n) => n.id))
  const user = await db.user.findUnique({ where: { id: userId }, select: { goal: true } })
  const goal = user?.goal ?? 'general'

  const candidates = scanRepeatedErrors(
    allErrorEvidence.map((r) => ({ ...rowToItem(r), sessionId: r.sessionId })),
    { activeNodeIds, existingErrorPatternIds },
  )

  for (const c of candidates) {
    const node = graph.byId.get(c.nodeId)
    if (!node) continue
    if (mutedNodeIds.has(c.nodeId)) continue // rejected recently → 14-day cooldown (docs/05 M7)
    const prereqDisplays = prerequisitesOf(node.id, graph.edges).map(
      (p) => stateMap.get(groupKey(p, 'writing'))?.displayState ?? stateMap.get(groupKey(p, 'reading'))?.displayState ?? null,
    )
    const draft = buildSeedDraft(
      c,
      {
        node,
        goal,
        prereqStates: prereqDisplays.filter((d): d is NonNullable<typeof d> => d !== null),
        userHasActiveState: activeNodeIds.has(node.id),
      },
      now,
    )
    if (!draft) continue

    // dedupe: same candidate already proposed/approved/planted (by node id or
    // by the stable "nodeId::errorType" dedupe key for pattern proposals)
    const dup = await db.seed.findFirst({
      where: {
        userId,
        status: { in: ['proposed', 'approved', 'planted'] },
        OR: [
          ...(draft.candidateNodeId ? [{ candidateNodeId: draft.candidateNodeId }] : []),
          ...(draft.candidatePayload ? [{ candidatePayload: { contains: draft.candidatePayload.title } }] : []),
          ...(draft.triggerRef.dedupeKey ? [{ triggerRef: { contains: draft.triggerRef.dedupeKey } }] : []),
        ],
      },
    })
    if (dup) continue

    const row = await db.seed.create({
      data: {
        userId,
        triggerType: draft.triggerType,
        triggerRef: JSON.stringify(draft.triggerRef),
        candidateNodeId: draft.candidateNodeId,
        candidatePayload: draft.candidatePayload ? JSON.stringify(draft.candidatePayload) : null,
        score: draft.score,
        scoreBreakdown: JSON.stringify(draft.scoreBreakdown),
        status: 'proposed',
        reasonFa: draft.reasonFa,
        expiresAt: new Date(now.getTime() + 14 * 86_400_000),
      },
    })
    seeds.push({ seedId: row.id, nodeId: draft.candidateNodeId, score: draft.score, reasonFa: draft.reasonFa })
    await db.metricEvent
      .create({ data: { userId, name: 'seed_proposed', props: JSON.stringify({ seedId: row.id, score: draft.score }) } })
      .catch(() => {})
  }

  // ── summary (docs/02 §3.3) + close ──
  const reinforced = applied
    .filter((a) => a.rating === 'Good' || a.rating === 'Easy')
    .map((a) => ({ nodeId: a.nodeId, skill: a.skill, grade: a.rating as FsrsRating }))

  const freshStates = await db.userNodeState.findMany({ where: { userId } })
  const fading = freshStates
    .filter((r) => computeDisplayState(rowToState(r), now) === 'fading')
    .map((r) => ({ nodeId: r.nodeId, skill: r.skill as Skill }))

  const dueCount = freshStates.filter((r) => r.due && r.due.getTime() <= now.getTime()).length
  const knownIds = new Set(freshStates.map((r) => r.nodeId))
  const frontierIds = graph.nodes
    .filter((n) => n.lang === 'en' && !knownIds.has(n.id) && prerequisitesOf(n.id, graph.edges).every((p) => knownIds.has(p) || !graph.byId.has(p)))
    .slice(0, 3)
    .map((n) => n.id)
  const remedial = [...gapGroups.map((g) => g.nodeId)]

  const summary = { reinforced, fading, delayTestResults: [], seeds, tomorrow: { reviewsDue: dueCount, newCandidates: frontierIds, remedial } }

  await db.chatSession.update({
    where: { id: sessionId },
    data: { status: 'ended', endedAt: now, summary: JSON.stringify(summary) },
  })
  await db.metricEvent
    .create({ data: { userId, name: 'session_end', props: JSON.stringify({ sessionId, applied: applied.length, seeds: seeds.length }) } })
    .catch(() => {})

  return { sessionId, applied, propagationEmitted: emitted.length, rootCaused, seeds, summary }
}
