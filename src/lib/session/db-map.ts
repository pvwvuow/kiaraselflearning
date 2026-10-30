/**
 * Shared DB↔engine mapping helpers for the session services (pipeline,
 * confirmatory). Kept free of business decisions — every rule lives in the
 * pure engine; this module only moves rows and persists engine results.
 */
import { db } from '@/lib/db'
import { loadGraph } from '@/lib/graph/load'
import { computeDisplayState } from '@/lib/engine/state'
import { prerequisitesOf } from '@/lib/engine/graph'
import { ENGINE_CONFIG } from '@/lib/engine/config'
import { PROBEABLE_NODE_TYPES, probeEligible } from '@/lib/engine/delayed-test'
import type {
  DisplayState,
  EngineNode,
  EvidenceItem,
  NodeSkillState,
  SessionBrief,
  Skill,
} from '@/lib/engine/types'
import type { ProbeCandidate, StoredProbePlan } from '@/lib/engine/delayed-test'

export const CONFIDENT = ENGINE_CONFIG.CONFIDENT_EVIDENCE

export function rowToItem(row: {
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

export function groupKey(nodeId: string, skill: Skill): string {
  return `${nodeId}::${skill}`
}

export function stateKeyOf(s: NodeSkillState): string {
  return groupKey(s.nodeId, s.skill)
}

/** distinct PAST sessions with a confident error for (nodeId, skill) */
export async function priorErrorSessions(
  userId: string,
  nodeId: string,
  skill: Skill,
  currentSessionId: string,
): Promise<number> {
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

export async function persistState(userId: string, s: NodeSkillState): Promise<void> {
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

/** load all of a user's states as the engine shape, keyed "nodeId::skill" */
export async function loadStateMap(userId: string): Promise<Map<string, NodeSkillState>> {
  const rows = await db.userNodeState.findMany({ where: { userId } })
  const map = new Map<string, NodeSkillState>()
  for (const r of rows) {
    const s = rowToState(r)
    map.set(stateKeyOf(s), s)
  }
  return map
}

// ── Prisma row → engine NodeSkillState (enums are strings in SQLite) ──

export function rowToState(row: {
  userId: string
  nodeId: string
  skill: string
  stability: number
  difficulty: number
  due: Date | null
  lastReviewAt: Date | null
  reps: number
  lapses: number
  learningSteps: number
  fsrsState: string
  displayState: string
  strength: number
  pendingDelayTest: boolean
  delayTestEligibleAt: Date | null
  masteredAt: Date | null
  lastAppliedEvidenceId: string | null
}): NodeSkillState {
  return {
    userId: row.userId,
    nodeId: row.nodeId,
    skill: row.skill as Skill,
    stability: row.stability,
    difficulty: row.difficulty,
    due: row.due,
    lastReviewAt: row.lastReviewAt,
    reps: row.reps,
    lapses: row.lapses,
    learningSteps: row.learningSteps,
    fsrsState: row.fsrsState as NodeSkillState['fsrsState'],
    displayState: row.displayState as DisplayState,
    strength: row.strength,
    pendingDelayTest: row.pendingDelayTest,
    delayTestEligibleAt: row.delayTestEligibleAt,
    masteredAt: row.masteredAt,
    lastAppliedEvidenceId: row.lastAppliedEvidenceId,
  }
}

// ── delayed-test candidate collection (shared by brief-builder, the
//    confirmatory service and the status API) ──

const SKILL_ORDER: readonly Skill[] = ['writing', 'reading']

export interface DelayedTestStatus {
  eligible: ProbeCandidate[]
  /** pendingDelayTest but not yet due (the "در آستانه‌ی تسلط" counter) */
  pendingCount: number
}

export async function collectDelayedTestStatus(userId: string, now: Date): Promise<DelayedTestStatus> {
  const graph = loadGraph('en')
  const stateMap = await loadStateMap(userId)

  // one candidate per NODE (best skill first: writing then reading) so two
  // skills of the same word never consume both probe slots
  const byNode = new Map<string, NodeSkillState[]>()
  for (const s of stateMap.values()) {
    const list = byNode.get(s.nodeId) ?? []
    list.push(s)
    byNode.set(s.nodeId, list)
  }

  const eligible: ProbeCandidate[] = []
  const pendingNodes = new Set<string>()
  for (const [nodeId, states] of byNode) {
    const node: EngineNode | undefined = graph.byId.get(nodeId)
    if (!node || !PROBEABLE_NODE_TYPES.includes(node.type)) continue
    const ordered = [...states].sort(
      (a, b) => SKILL_ORDER.indexOf(a.skill) - SKILL_ORDER.indexOf(b.skill),
    )
    for (const s of ordered) {
      const flags = await probeFlagsFor(userId, s.nodeId, s.skill)
      if (!probeEligible(s, now, flags)) {
        if (!s.masteredAt && s.pendingDelayTest) pendingNodes.add(s.nodeId)
        continue
      }
      eligible.push({ state: s, node, postMastery: Boolean(s.masteredAt) })
      break
    }
  }
  return { eligible, pendingCount: pendingNodes.size }
}

/** the "why" node meta shape shared by brief weak/frontier refs */
export interface NodeMeta {
  title: string
  glossFa: string | null
}

export function nodeMetas(nodes: EngineNode[]): Map<string, NodeMeta> {
  return new Map(nodes.map((n) => [n.id, { title: n.title, glossFa: n.glossFa }]))
}

/**
 * §A6 context flags from real rows: openGap = card still Relearning;
 * hint-assisted = any hintUsed evidence in the last 2 sessions that touched
 * this (node × skill).
 */
export async function probeFlagsFor(
  userId: string,
  nodeId: string,
  skill: Skill,
): Promise<{ openGap: boolean; hintAssistedRecent: boolean }> {
  const state = await db.userNodeState.findUnique({
    where: { userId_nodeId_skill: { userId, nodeId, skill } },
  })
  const openGap = state?.fsrsState === 'Relearning'

  const sessions = await db.evidence.findMany({
    where: { userId, nodeId, skill, disputed: false },
    select: { sessionId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 40,
  })
  const recent = [...new Set(sessions.map((s) => s.sessionId))].slice(0, 2)
  let hintAssistedRecent = false
  for (const sessionId of recent) {
    const hintRow = await db.evidence.findFirst({
      where: { userId, nodeId, skill, sessionId, hintUsed: true },
    })
    if (hintRow) {
      hintAssistedRecent = true
      break
    }
  }
  return { openGap, hintAssistedRecent }
}

// ── ChatSession.brief column: wrapper format + legacy plain-brief compat ──
//
//   legacy (M3–M7 rows):  SessionBrief
//   M8+ roleplay:         { brief: SessionBrief, probePlan: StoredProbePlan | null }
//   M8+ confirmatory:     { probePlan: StoredProbePlan }

export interface StoredBriefColumn {
  brief: SessionBrief | null
  probePlan: StoredProbePlan | null
}

export function parseBriefColumn(raw: string | null): StoredBriefColumn {
  if (!raw) return { brief: null, probePlan: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      'probePlan' in (parsed as Record<string, unknown>)
    ) {
      const wrap = parsed as { brief?: SessionBrief | null; probePlan?: StoredProbePlan | null }
      return { brief: wrap.brief ?? null, probePlan: wrap.probePlan ?? null }
    }
    return { brief: parsed as SessionBrief, probePlan: null }
  } catch {
    return { brief: null, probePlan: null }
  }
}

// ── summary tail helpers (shared by pipeline & confirmatory endings) ──

export interface SummaryNodeRef {
  nodeId: string
  skill: Skill
  title: string | null
  glossFa: string | null
}

/** fading display states recomputed at read time (docs/03 §A5) */
export async function computeFading(userId: string, now: Date): Promise<SummaryNodeRef[]> {
  const graph = loadGraph('en')
  const rows = await db.userNodeState.findMany({ where: { userId } })
  const out: SummaryNodeRef[] = []
  for (const r of rows) {
    if (computeDisplayState(rowToState(r), now) === 'fading') {
      const n = graph.byId.get(r.nodeId)
      out.push({ nodeId: r.nodeId, skill: r.skill as Skill, title: n?.title ?? null, glossFa: n?.glossFa ?? null })
    }
  }
  return out.sort((a, b) => a.nodeId.localeCompare(b.nodeId))
}

/** the "tomorrow" plan block: due reviews + frontier candidates */
export async function computeTomorrow(
  userId: string,
  now: Date,
): Promise<{ reviewsDue: number; newCandidates: string[] }> {
  const graph = loadGraph('en')
  const rows = await db.userNodeState.findMany({ where: { userId } })
  const reviewsDue = rows.filter((r) => r.due && r.due.getTime() <= now.getTime()).length
  const knownIds = new Set(rows.map((r) => r.nodeId))
  const newCandidates = graph.nodes
    .filter(
      (n) =>
        n.lang === 'en' &&
        !knownIds.has(n.id) &&
        prerequisitesOf(n.id, graph.edges).every((p) => knownIds.has(p) || !graph.byId.has(p)),
    )
    .slice(0, 3)
    .map((n) => n.id)
  return { reviewsDue, newCandidates }
}
