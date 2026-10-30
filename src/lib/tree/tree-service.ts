/**
 * Tree view service (M6) — assembles the user's personal skill tree:
 * world graph (data files) ∪ user-generated nodes (DB) + per-user positions
 * (persistent, semi-fixed layout — nodes never jump between visits) +
 * per-skill states (fading RECOMPUTED on read, docs/03 §A5) + a Persian
 * "why" reason per node derived from the evidence summary (docs/05 M6).
 *
 * This is a wiring layer (DB + engine); all layout math lives in the pure
 * `src/lib/engine/tree-layout.ts`.
 */
import { db } from '@/lib/db'
import { loadGraph } from '@/lib/graph/load'
import { computeAvailability } from '@/lib/engine/graph'
import { computeTreeLayout } from '@/lib/engine/tree-layout'
import { computeDisplayState } from '@/lib/engine/state'
import { ENGINE_CONFIG } from '@/lib/engine/config'
import { rowToState } from '@/lib/session/brief-builder'
import type { DisplayState, EngineEdge, EngineNode, NodeSkillState } from '@/lib/engine/types'

// ── payload contracts (mirrored in src/lib/client/api.ts) ──

export interface TreeSkillView {
  state: DisplayState
  strength: number
  reps: number
  due: string | null
}

export interface TreeNodeView {
  id: string
  type: string
  cefr: string | null
  rank: number | null
  title: string
  glossFa: string | null
  x: number
  y: number
  tier: number
  state: DisplayState
  /** MVP: listening/speaking are always null (UI renders "—") */
  skills: {
    listening: TreeSkillView | null
    speaking: TreeSkillView | null
    reading: TreeSkillView | null
    writing: TreeSkillView | null
  }
  pinned: boolean
  hidden: boolean
  /** Persian reason — «چرا این گره این‌طور دیده می‌شود؟» */
  why: string
  userGenerated: boolean
}

export interface TreeViewPayload {
  ok: true
  lang: string
  nodes: TreeNodeView[]
  /** prerequisite edges only — the tree skeleton */
  edges: { from: string; to: string }[]
  stats: { total: number; hidden: number; byState: Record<string, number> }
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

/** node-level state: attention first (fading), then progress (docs/05 M6 card) */
const NODE_STATE_PRIORITY: readonly DisplayState[] = [
  'fading',
  'learning',
  'mastered',
  'assumed_known',
  'available',
  'locked',
]

function faDigits(n: number): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹'
  return String(n)
    .split('')
    .map((d) => (/\d/.test(d) ? fa[Number(d)] : d))
    .join('')
}

const OUTCOME_FA: Record<string, string> = {
  correct: 'درست',
  error: 'خطا',
  slip_self_corrected: 'خوداصلاحی',
  avoided: 'پرهیز هوشمندانه',
  used_with_hint: 'با راهنما',
  unknown: 'نامعلوم',
}

interface EvidenceAgg {
  lastOutcome: string | null
  lastAt: Date | null
  confidentErrors30d: number
  total: number
}

/** Persian "why" per node — from evidence summary + display state (docs/05 M6) */
export function buildWhy(args: {
  state: DisplayState
  agg: EvidenceAgg | undefined
  blockingTitles: string[]
  hasStates: boolean
}): string {
  const { state, agg, blockingTitles, hasStates } = args
  const evidencePart = agg?.lastOutcome
    ? `آخرین تمرین: ${OUTCOME_FA[agg.lastOutcome] ?? agg.lastOutcome}`
    : null
  const errorPart =
    agg && agg.confidentErrors30d > 0
      ? `${faDigits(agg.confidentErrors30d)} خطای مطمئن در ۳۰ روز اخیر`
      : null

  switch (state) {
    case 'locked': {
      if (blockingTitles.length === 0) return 'قفل است — پیش‌نیازها هنوز آماده نیستند'
      const pre = blockingTitles.slice(0, 2).join('، ')
      return `قفل است — اول این پیش‌نیازها را باز کن: ${pre}${blockingTitles.length > 2 ? ' و …' : ''}`
    }
    case 'available':
      return 'در مرز رشد توست — آماده‌ی شروع'
    case 'assumed_known':
      return 'از تعیین سطح روشن شده؛ هنوز با تست تأخیری تأیید نشده'
    case 'learning': {
      const parts = ['در حال یادگیری']
      if (errorPart) parts.push(errorPart)
      else if (evidencePart) parts.push(evidencePart)
      else if (!hasStates) parts.push('هنوز تمرینی ثبت نشده')
      return parts.join(' — ')
    }
    case 'fading': {
      const parts = ['در حال فراموشی — مرور عقب افتاده']
      if (errorPart) parts.push(errorPart)
      return parts.join(' — ')
    }
    case 'mastered':
      return 'تسلط با تست تأخیری تأیید شد'
    default:
      return ''
  }
}

/** Load & assemble everything the tree view needs (one call per visit). */
export async function getTreeView(userId: string, now: Date): Promise<TreeViewPayload> {
  const graph = loadGraph('en')

  // user-generated nodes (planted by the growth engine, M7) join the world
  const userGen = await db.graphNode.findMany({
    where: { isUserGenerated: true, ownerId: userId, status: 'active' },
  })
  const userGenIds = userGen.map((n) => n.id)
  const userGenEdges =
    userGenIds.length > 0
      ? await db.graphEdge.findMany({
          where: { OR: [{ fromId: { in: userGenIds } }, { toId: { in: userGenIds } }] },
        })
      : []

  const allNodes: EngineNode[] = [
    ...graph.nodes,
    ...userGen.map((n) => ({
      id: n.id,
      type: n.type as EngineNode['type'],
      lang: n.lang,
      cefr: n.cefr,
      frequencyRank: n.frequencyRank,
      title: n.title,
      glossFa: n.glossFa,
      tags: [] as string[],
    })),
  ]
  const allEdges: EngineEdge[] = [
    ...graph.edges,
    ...userGenEdges.map((e) => ({
      fromId: e.fromId,
      toId: e.toId,
      type: e.type as EngineEdge['type'],
      weight: e.weight,
    })),
  ]

  // states (recomputed display state on read) + saved positions + evidence
  const [stateRows, posRows, evidenceRows] = await Promise.all([
    db.userNodeState.findMany({ where: { userId } }),
    db.nodePosition.findMany({ where: { userId } }),
    db.evidence.findMany({
      where: { userId, disputed: false },
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: { nodeId: true, outcome: true, confidence: true, createdAt: true },
    }),
  ])

  const byNode = new Map<string, NodeSkillState[]>()
  for (const row of stateRows) {
    const st = rowToState(row)
    const list = byNode.get(st.nodeId) ?? []
    list.push(st)
    byNode.set(st.nodeId, list)
  }

  const saved = new Map(posRows.map((p) => [p.nodeId, { x: p.x, y: p.y, tier: p.tier }] as const))

  const layout = computeTreeLayout({ nodes: allNodes, edges: allEdges, saved })
  if (layout.newIds.length > 0) {
    await db.nodePosition
      .createMany({
        data: layout.newIds.map((id) => ({
          userId,
          nodeId: id,
          x: layout.positions.get(id)!.x,
          y: layout.positions.get(id)!.y,
          tier: layout.positions.get(id)!.tier,
        })),
      })
      .catch(() => {
        // concurrent first render — same deterministic values; safe to ignore
      })
  }

  // locked/available gating for stateless nodes (docs/03 §A5)
  const availability = computeAvailability({
    nodes: allNodes,
    edges: allEdges,
    states: byNode,
    lang: 'en',
  })
  const availById = new Map(availability.map((a) => [a.node.id, a] as const))

  // evidence aggregates per node (MVP: single scan over the latest rows)
  const aggByNode = new Map<string, EvidenceAgg>()
  const window30d = now.getTime() - 30 * 86_400_000
  for (const row of evidenceRows) {
    const agg =
      aggByNode.get(row.nodeId) ?? { lastOutcome: null, lastAt: null, confidentErrors30d: 0, total: 0 }
    if (!agg.lastAt || row.createdAt > agg.lastAt) {
      agg.lastAt = row.createdAt
      agg.lastOutcome = row.outcome
    }
    if (
      row.outcome === 'error' &&
      row.confidence >= ENGINE_CONFIG.CONFIDENT_EVIDENCE &&
      row.createdAt.getTime() >= window30d
    ) {
      agg.confidentErrors30d += 1
    }
    agg.total += 1
    aggByNode.set(row.nodeId, agg)
  }

  // flags from the position rows (pin/hide)
  const flagsById = new Map(posRows.map((p) => [p.nodeId, p]))

  const toSkillView = (st: NodeSkillState): TreeSkillView => ({
    state: computeDisplayState(st, now),
    strength: st.strength,
    reps: st.reps,
    due: st.due ? st.due.toISOString() : null,
  })

  const titleOf = new Map(allNodes.map((n) => [n.id, n.title]))
  const nodes: TreeNodeView[] = allNodes.map((n) => {
    const sts = byNode.get(n.id) ?? []
    const fallback: DisplayState = availById.get(n.id)?.displayState ?? 'locked'
    // node state = strongest across skills (attention first), else availability
    let state = fallback
    let bestIdx = NODE_STATE_PRIORITY.indexOf(fallback)
    for (const st of sts) {
      const s = computeDisplayState(st, now)
      const idx = NODE_STATE_PRIORITY.indexOf(s)
      if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) {
        state = s
        bestIdx = idx
      }
    }
    const blocking = (availById.get(n.id)?.blocking ?? []).map((id) => titleOf.get(id) ?? id)
    const flags = flagsById.get(n.id)
    const reading = sts.find((s) => s.skill === 'reading')
    const writing = sts.find((s) => s.skill === 'writing')
    const pos = layout.positions.get(n.id)!
    return {
      id: n.id,
      type: n.type,
      cefr: n.cefr,
      rank: n.frequencyRank,
      title: n.title,
      glossFa: n.glossFa,
      x: pos.x,
      y: pos.y,
      tier: pos.tier,
      state,
      skills: {
        listening: null,
        speaking: null,
        reading: reading ? toSkillView(reading) : null,
        writing: writing ? toSkillView(writing) : null,
      },
      pinned: flags?.pinned ?? false,
      hidden: flags?.hidden ?? false,
      why: buildWhy({
        state,
        agg: aggByNode.get(n.id),
        blockingTitles: blocking,
        hasStates: sts.length > 0,
      }),
      userGenerated: userGenIds.includes(n.id),
    }
  })

  const byState: Record<string, number> = {}
  let hiddenCount = 0
  for (const n of nodes) {
    byState[n.state] = (byState[n.state] ?? 0) + 1
    if (n.hidden) hiddenCount += 1
  }

  const bounds = nodes.reduce(
    (b, n) => ({
      minX: Math.min(b.minX, n.x),
      maxX: Math.max(b.maxX, n.x),
      minY: Math.min(b.minY, n.y),
      maxY: Math.max(b.maxY, n.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  )

  const nodeIds = new Set(allNodes.map((n) => n.id))
  return {
    ok: true,
    lang: 'en',
    nodes,
    edges: allEdges
      .filter((e) => e.type === 'prerequisite' && nodeIds.has(e.fromId) && nodeIds.has(e.toId))
      .map((e) => ({ from: e.fromId, to: e.toId })),
    stats: { total: nodes.length, hidden: hiddenCount, byState },
    bounds: Number.isFinite(bounds.minX) ? bounds : { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  }
}

/** PATCH target: the node must exist in the world (or be the user's own). */
async function nodeExists(userId: string, nodeId: string): Promise<boolean> {
  if (loadGraph('en').byId.has(nodeId)) return true
  const own = await db.graphNode.findFirst({
    where: { id: nodeId, ownerId: userId, isUserGenerated: true },
    select: { id: true },
  })
  return own !== null
}

/**
 * Pin / hide toggles (docs/05 M6 node card actions). Persisted on the
 * NodePosition row (created on demand with a deterministic position).
 * Returns null when the node id is unknown → the route answers 404.
 */
export async function setTreeNodeFlags(
  userId: string,
  nodeId: string,
  flags: { pinned?: boolean; hidden?: boolean },
): Promise<{ nodeId: string; pinned: boolean; hidden: boolean } | null> {
  if (!(await nodeExists(userId, nodeId))) return null

  const existing = await db.nodePosition.findUnique({
    where: { userId_nodeId: { userId, nodeId } },
  })
  if (existing) {
    const updated = await db.nodePosition.update({
      where: { userId_nodeId: { userId, nodeId } },
      data: {
        ...(flags.pinned !== undefined ? { pinned: flags.pinned } : {}),
        ...(flags.hidden !== undefined ? { hidden: flags.hidden } : {}),
      },
    })
    return { nodeId, pinned: updated.pinned, hidden: updated.hidden }
  }

  // no position yet (PATCH before any GET) — lay the graph out first
  const graph = loadGraph('en')
  const posRows = await db.nodePosition.findMany({ where: { userId } })
  const saved = new Map(posRows.map((p) => [p.nodeId, { x: p.x, y: p.y, tier: p.tier }] as const))
  const layout = computeTreeLayout({ nodes: graph.nodes, edges: graph.edges, saved })
  const p = layout.positions.get(nodeId)
  if (!p) return null // cannot happen (nodeExists passed) — defensive
  await db.nodePosition
    .createMany({
      data: layout.newIds.map((id) => ({
        userId,
        nodeId: id,
        x: layout.positions.get(id)!.x,
        y: layout.positions.get(id)!.y,
        tier: layout.positions.get(id)!.tier,
      })),
    })
    .catch(() => {})
  const created = await db.nodePosition.upsert({
    where: { userId_nodeId: { userId, nodeId } },
    create: { userId, nodeId, x: p.x, y: p.y, tier: p.tier, ...flags },
    update: flags,
  })
  return { nodeId, pinned: created.pinned, hidden: created.hidden }
}
