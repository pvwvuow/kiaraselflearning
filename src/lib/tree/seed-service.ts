/**
 * Seed inbox service (M7) — the user-facing side of the growth engine
 * (docs/03 §B1 pipeline: trigger → seed → score → cap → USER APPROVAL →
 * plant). Wiring layer only: every threshold comes from the pure engine /
 * config, this module does the DB work.
 *
 *   getSeedInbox  — proposals (ranked) + recently decided + weekly-cap meter;
 *                   lazily expires stale proposals (§B4: 14 days)
 *   approveSeed   — weekly cap check (3 planted / trailing 7 days; the 4th
 *                   approval is HELD in queue, never planted) then planting:
 *                   UserNodeState(reading+writing, available) + NodePosition
 *                   at tier = 1 + max(prereq tiers) with the next free slot
 *                   (§B5) — user-generated error-pattern nodes are created as
 *                   real GraphNodes (isUserGenerated) linked to their source.
 *   rejectSeed    — flag-only decision; the 14-day node cooldown is enforced
 *                   by the pipeline on the next scan (docs/05 M7).
 */
import { db } from '@/lib/db'
import { loadGraph } from '@/lib/graph/load'
import { ENGINE_CONFIG } from '@/lib/engine/config'
import { prerequisitesOf } from '@/lib/engine/graph'
import { buildLayoutTiers, plantTierFor, slotOfX } from '@/lib/engine/tree-layout'
import type { EngineEdge, EngineNode } from '@/lib/engine/types'

// ── payload contracts (mirrored in src/lib/client/api.ts) ──

export type SeedStatus = 'proposed' | 'planted' | 'rejected' | 'expired'
export type SeedKind = 'plant_existing' | 'track_pattern'

export interface SeedEntry {
  id: string
  status: SeedStatus
  kind: SeedKind
  /** world node title, or the proposed pattern title */
  title: string
  glossFa: string | null
  score: number
  breakdown: { goalRelevance: number; frequency: number; readiness: number; novelty: number }
  reasonFa: string | null
  sample: { produced: string | null; expected: string | null } | null
  errorCount: number
  createdAt: string
  expiresAt: string | null
  decidedAt: string | null
  /** set when planted (either the candidateNodeId or the new user node id) */
  plantedNodeId: string | null
}

export interface SeedInboxPayload {
  ok: true
  proposals: SeedEntry[]
  recent: SeedEntry[]
  cap: { planted: number; limit: number }
}

export interface ApproveSeedResult {
  ok: boolean
  /** 404 semantics */
  notFound?: boolean
  /** already decided (409) */
  alreadyDecided?: boolean
  /** was expired meanwhile (409) */
  expired?: boolean
  /** cap reached — approval recorded as HELD, seed stays in queue (200) */
  held?: boolean
  cap?: { planted: number; limit: number }
  plantedNodeId?: string | null
  entry?: SeedEntry
}

interface TriggerRef {
  errorCount?: number
  sessionIds?: string[]
  sampleProduced?: string | null
  sampleExpected?: string | null
  nodeId?: string
  dedupeKey?: string
}

interface CandidatePayload {
  type: string
  title: string
  cefr: string | null
}

const DAY = 86_400_000
const CAP_WINDOW_DAYS = 7

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function entryFromRow(row: {
  id: string
  triggerType: string
  triggerRef: string | null
  candidateNodeId: string | null
  candidatePayload: string | null
  score: number
  scoreBreakdown: string
  status: string
  reasonFa: string | null
  createdAt: Date
  expiresAt: Date | null
  decidedAt: Date | null
}, graphById: Map<string, EngineNode>): SeedEntry {
  const ref = parseJson<TriggerRef>(row.triggerRef, {})
  const payload = parseJson<CandidatePayload | null>(row.candidatePayload, null)
  const kind: SeedKind = payload ? 'track_pattern' : 'plant_existing'
  const worldNode = row.candidateNodeId ? graphById.get(row.candidateNodeId) : undefined
  const title = worldNode?.title ?? payload?.title ?? row.candidateNodeId ?? ref.nodeId ?? '—'
  return {
    id: row.id,
    status: (['proposed', 'planted', 'rejected', 'expired'].includes(row.status)
      ? row.status
      : 'proposed') as SeedStatus,
    kind,
    title,
    glossFa: worldNode?.glossFa ?? null,
    score: row.score,
    breakdown: parseJson(row.scoreBreakdown, { goalRelevance: 0, frequency: 0, readiness: 0, novelty: 0 }),
    reasonFa: row.reasonFa,
    sample:
      ref.sampleProduced || ref.sampleExpected
        ? { produced: ref.sampleProduced ?? null, expected: ref.sampleExpected ?? null }
        : null,
    errorCount: ref.errorCount ?? 0,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    plantedNodeId: row.status === 'planted' ? (row.candidateNodeId ?? ref.nodeId ?? null) : null,
  }
}

/** weekly-cap meter (§B4): planted seeds in the trailing 7-day window */
export async function plantedInWindow(userId: string, now: Date): Promise<number> {
  return db.seed.count({
    where: {
      userId,
      status: { in: ['approved', 'planted'] },
      decidedAt: { gte: new Date(now.getTime() - CAP_WINDOW_DAYS * DAY) },
    },
  })
}

/** Load & assemble everything the seed inbox needs (one call per visit). */
export async function getSeedInbox(userId: string, now: Date): Promise<SeedInboxPayload> {
  // lazy expiry — over-cap proposals stay proposed for 14 days, then age out
  await db.seed
    .updateMany({
      where: { userId, status: 'proposed', expiresAt: { lt: now } },
      data: { status: 'expired' },
    })
    .catch(() => {})

  const [rows, planted, graph] = await Promise.all([
    db.seed.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }],
      take: 60,
    }),
    plantedInWindow(userId, now),
    Promise.resolve(loadGraph('en')),
  ])

  const entries = rows.map((r) => entryFromRow(r, graph.byId))
  const proposals = entries
    .filter((e) => e.status === 'proposed')
    .sort((a, b) => b.score - a.score || (a.createdAt < b.createdAt ? 1 : -1))
  const recent = entries.filter((e) => e.status !== 'proposed').slice(0, 12)

  return {
    ok: true,
    proposals,
    recent,
    cap: { planted, limit: ENGINE_CONFIG.WEEKLY_SEED_CAP },
  }
}

/** NodePosition for a newly planted node (docs/03 §B5) — created only when
 *  the node has no position yet (world nodes usually already have one from
 *  the M6 full layout; that position is kept untouched). */
async function ensurePlantPosition(userId: string, nodeId: string, graph: {
  nodes: EngineNode[]
  edges: EngineEdge[]
  byId: Map<string, EngineNode>
}): Promise<void> {
  const existing = await db.nodePosition.findUnique({
    where: { userId_nodeId: { userId, nodeId } },
  })
  if (existing) return

  const tiers = buildLayoutTiers(graph.nodes, graph.edges)
  // prereqs: world edges + DB edges (user-generated node → its source word)
  const dbPrereqs = await db.graphEdge.findMany({
    where: { toId: nodeId, type: 'prerequisite' },
    select: { fromId: true },
  })
  const prereqIds = [...new Set([...prerequisitesOf(nodeId, graph.edges), ...dbPrereqs.map((e) => e.fromId)])]
  const anchorEdge = graph.edges.find((e) => e.type === 'part_of' && e.fromId === nodeId)
  const anchorTier = anchorEdge ? (tiers.get(anchorEdge.toId) ?? null) : null

  const tier = plantTierFor(nodeId, prereqIds, tiers, anchorTier)
  // next free slot in that tier, recovered exactly from saved rows (M6 math)
  const posRows = await db.nodePosition.findMany({ where: { userId }, select: { x: true, tier: true } })
  let next = 0
  for (const p of posRows) if (p.tier === tier) next = Math.max(next, slotOfX(p.x) + 1)

  await db.nodePosition
    .create({
      data: {
        userId,
        nodeId,
        x: next * ENGINE_CONFIG.TREE_GAP_X,
        y: tier * ENGINE_CONFIG.TREE_TIER_GAP_Y,
        tier,
      },
    })
    .catch(() => {
      // concurrent plant — same deterministic values; safe to ignore
    })
}

const PLANTED_STATE = {
  stability: 0,
  difficulty: 0,
  due: null,
  lastReviewAt: null,
  reps: 0,
  lapses: 0,
  learningSteps: 0,
  fsrsState: 'New',
  displayState: 'available',
  strength: 0,
  pendingDelayTest: false,
  delayTestEligibleAt: null,
  masteredAt: null,
  lastAppliedEvidenceId: null,
} as const

/**
 * Approve a proposal (§B5). Enforces the weekly cap: when 3 seeds were
 * planted in the trailing 7 days, the 4th approval is HELD — the seed stays
 * `proposed` (in queue) and nothing is planted. Returns `held: true` so the
 * UI can explain instead of failing.
 */
export async function approveSeed(userId: string, seedId: string, now: Date): Promise<ApproveSeedResult> {
  const seed = await db.seed.findUnique({ where: { id: seedId } })
  if (!seed || seed.userId !== userId) return { ok: false, notFound: true }
  if (seed.status !== 'proposed') return { ok: false, alreadyDecided: true }
  if (seed.expiresAt && seed.expiresAt.getTime() < now.getTime()) {
    await db.seed.update({ where: { id: seedId }, data: { status: 'expired' } }).catch(() => {})
    return { ok: false, expired: true }
  }

  const cap = { planted: await plantedInWindow(userId, now), limit: ENGINE_CONFIG.WEEKLY_SEED_CAP }
  if (cap.planted >= cap.limit) {
    // held in queue — NOT planted, NOT rejected (cap counts only plants)
    return { ok: true, held: true, cap }
  }

  const graph = loadGraph('en')
  let plantedNodeId: string

  if (seed.candidatePayload) {
    // (b) track-the-pattern: create the user-generated error_pattern node…
    const payload = parseJson<CandidatePayload>(seed.candidatePayload, { type: 'error_pattern', title: 'error', cefr: null })
    plantedNodeId = `en:err:u-${crypto.randomUUID().slice(0, 8)}`
    await db.graphNode.create({
      data: {
        id: plantedNodeId,
        type: payload.type,
        lang: 'en',
        cefr: payload.cefr,
        title: payload.title,
        isUserGenerated: true,
        ownerId: userId,
        status: 'active',
      },
    })
    // …and link it to its source word (prerequisite: source → pattern) so it
    // lands in the tree right under the node that keeps producing the error
    const ref = parseJson<TriggerRef>(seed.triggerRef, {})
    const sourceId = ref.nodeId
    const sourceExists =
      sourceId && (graph.byId.has(sourceId) ||
        (await db.graphNode.findFirst({ where: { id: sourceId, ownerId: userId }, select: { id: true } })) !== null)
    if (sourceId && sourceExists) {
      await db.graphEdge
        .create({ data: { fromId: sourceId, toId: plantedNodeId, type: 'prerequisite', weight: 1 } })
        .catch(() => {})
    }
  } else {
    // (a) plant-an-existing-node
    if (!seed.candidateNodeId || !graph.byId.has(seed.candidateNodeId)) {
      return { ok: false, notFound: true } // node vanished from the world graph
    }
    plantedNodeId = seed.candidateNodeId
  }

  // states: reading + writing, planted-but-unpracticed (§B5)
  for (const skill of ['reading', 'writing']) {
    await db.userNodeState.upsert({
      where: { userId_nodeId_skill: { userId, nodeId: plantedNodeId, skill } },
      create: { userId, nodeId: plantedNodeId, skill, ...PLANTED_STATE },
      update: {}, // never overwrite practiced state
    })
  }

  await ensurePlantPosition(userId, plantedNodeId, graph)

  await db.seed.update({
    where: { id: seedId },
    data: { status: 'planted', decidedAt: now },
  })
  await db.metricEvent
    .create({
      data: {
        userId,
        name: 'seed_approved',
        props: JSON.stringify({ seedId, nodeId: plantedNodeId, score: seed.score }),
      },
    })
    .catch(() => {})

  const ref = parseJson<TriggerRef>(seed.triggerRef, {})
  return {
    ok: true,
    held: false,
    cap: { planted: cap.planted + 1, limit: cap.limit },
    plantedNodeId,
    entry: {
      id: seed.id,
      status: 'planted',
      kind: seed.candidatePayload ? 'track_pattern' : 'plant_existing',
      title: graph.byId.get(plantedNodeId)?.title ?? parseJson<CandidatePayload | null>(seed.candidatePayload, null)?.title ?? plantedNodeId,
      glossFa: graph.byId.get(plantedNodeId)?.glossFa ?? null,
      score: seed.score,
      breakdown: parseJson(seed.scoreBreakdown, { goalRelevance: 0, frequency: 0, readiness: 0, novelty: 0 }),
      reasonFa: seed.reasonFa,
      sample:
        ref.sampleProduced || ref.sampleExpected
          ? { produced: ref.sampleProduced ?? null, expected: ref.sampleExpected ?? null }
          : null,
      errorCount: ref.errorCount ?? 0,
      createdAt: seed.createdAt.toISOString(),
      expiresAt: seed.expiresAt ? seed.expiresAt.toISOString() : null,
      decidedAt: now.toISOString(),
      plantedNodeId,
    },
  }
}

/** Reject a proposal (flag-only). The 14-day cooldown is enforced by the
 *  pipeline scan; this just records the decision. */
export async function rejectSeed(
  userId: string,
  seedId: string,
  now: Date,
): Promise<{ ok: boolean; notFound?: boolean; alreadyDecided?: boolean }> {
  const seed = await db.seed.findUnique({ where: { id: seedId } })
  if (!seed || seed.userId !== userId) return { ok: false, notFound: true }
  if (seed.status !== 'proposed') return { ok: false, alreadyDecided: true }

  await db.seed.update({
    where: { id: seedId },
    data: { status: 'rejected', decidedAt: now },
  })
  await db.metricEvent
    .create({ data: { userId, name: 'seed_rejected', props: JSON.stringify({ seedId, score: seed.score }) } })
    .catch(() => {})
  return { ok: true }
}
