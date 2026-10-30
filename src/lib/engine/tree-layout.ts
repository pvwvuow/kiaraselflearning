/**
 * Tree layout (docs/05 M6) — deterministic layered layout from prerequisites.
 * PURE: data in → positions out. No DB, no clock, no randomness (the purity
 * test enforces this) because stability of the tree between visits is a
 * CONTRACT, not a rendering nicety:
 *
 *  - a node with a saved position keeps it EXACTLY (x, y, tier),
 *  - a node without one is placed in its layout tier (longest prerequisite
 *    depth, raised to cluster depth + 1 when it belongs to a topic cluster)
 *    at the NEXT FREE SLOT of that tier (docs/03 §B5 "x = next free slot"),
 *  - two runs over unchanged inputs produce identical output.
 *
 * All x coordinates are integer slot indices × TREE_GAP_X; y is
 * tier × TREE_TIER_GAP_Y. Both are exactly recoverable from a saved row, so
 * "next free slot" never collides and never moves an existing node.
 */
import { ENGINE_CONFIG } from './config'
import type { EngineEdge, EngineNode } from './types'

export interface SavedPosition {
  x: number
  y: number
  tier: number
}

export interface TreeLayoutInput {
  nodes: EngineNode[]
  /** full edge set — prerequisite edges drive tiering, part_of drives cluster grouping */
  edges: EngineEdge[]
  /** persisted positions for this user (missing = place fresh) */
  saved: Map<string, SavedPosition>
}

export interface TreeLayoutResult {
  /** final position for EVERY node (saved verbatim where present, fresh otherwise) */
  positions: Map<string, SavedPosition>
  /** ids placed fresh in this run — the caller persists exactly these */
  newIds: string[]
}

const MAX_RANK = Number.MAX_SAFE_INTEGER

/** slot index of a placed node — exact inverse of x = slot × TREE_GAP_X */
export function slotOfX(x: number): number {
  return Math.round(x / ENGINE_CONFIG.TREE_GAP_X)
}

/**
 * Layout tier of one node: the longest prerequisite chain depth, raised to
 * `cluster tier + 1` when the node is `part_of` a topic cluster — so cluster
 * members render one level under their anchor instead of flooding tier 0.
 * Pure & memoized; cycles are guarded (nodeTier) and the integrity test
 * guarantees the prerequisite graph is a DAG anyway.
 */
export function buildLayoutTiers(
  nodes: EngineNode[],
  edges: EngineEdge[],
): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id))
  const prereqEdges = edges.filter(
    (e) => e.type === 'prerequisite' && ids.has(e.fromId) && ids.has(e.toId),
  )
  // member → cluster anchor (part_of edges point FROM member TO cluster)
  const clusterOf = new Map<string, string>()
  for (const e of edges) {
    if (e.type !== 'part_of' || !ids.has(e.fromId) || !ids.has(e.toId)) continue
    const anchorNode = nodes.find((n) => n.id === e.toId)
    if (anchorNode?.type === 'topic_cluster') clusterOf.set(e.fromId, e.toId)
  }

  const tiers = new Map<string, number>()
  const visiting = new Set<string>()
  const tierOf = (id: string): number => {
    const memoed = tiers.get(id)
    if (memoed !== undefined) return memoed
    if (visiting.has(id)) return 0 // cycle guard (integrity test guarantees a DAG anyway)
    visiting.add(id)
    let t = 0
    for (const e of prereqEdges) {
      if (e.toId !== id) continue // edge points FROM prereq TO dependent
      t = Math.max(t, tierOf(e.fromId) + 1)
    }
    const anchor = clusterOf.get(id)
    if (anchor) t = Math.max(t, tierOf(anchor) + 1)
    visiting.delete(id)
    tiers.set(id, t)
    return t
  }
  for (const n of nodes) tierOf(n.id)
  return tiers
}

/**
 * Deterministic layered layout (the M6 acceptance: "two renders with
 * unchanged state → identical positions").
 */
export function computeTreeLayout(input: TreeLayoutInput): TreeLayoutResult {
  const { nodes, edges, saved } = input
  const ids = new Set(nodes.map((n) => n.id))
  const tiers = buildLayoutTiers(nodes, edges)

  // deterministic within-tier order: cluster members hug their anchor,
  // then frequency rank, then id — same input, same order, always
  const clusterOf = new Map<string, string>()
  for (const e of edges) {
    if (e.type !== 'part_of' || !ids.has(e.fromId) || !ids.has(e.toId)) continue
    if (nodes.find((n) => n.id === e.toId)?.type === 'topic_cluster') clusterOf.set(e.fromId, e.toId)
  }
  const orderKey = (n: EngineNode): string => {
    const cluster = clusterOf.get(n.id) ?? '~'
    const typeGroup = n.type === 'topic_cluster' ? '0' : '1'
    const rank = String(n.frequencyRank ?? MAX_RANK).padStart(12, '0')
    return `${cluster}#${typeGroup}#${rank}#${n.id}`
  }

  // occupied slots per tier, recovered exactly from saved positions
  const occupied = new Map<number, Set<number>>()
  for (const p of saved.values()) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isInteger(p.tier)) continue
    const set = occupied.get(p.tier) ?? new Set<number>()
    set.add(slotOfX(p.x))
    occupied.set(p.tier, set)
  }

  // nodes needing fresh placement, grouped by tier
  const freshByTier = new Map<number, EngineNode[]>()
  for (const n of nodes) {
    if (saved.has(n.id)) continue
    const t = tiers.get(n.id) ?? 0
    const list = freshByTier.get(t) ?? []
    list.push(n)
    freshByTier.set(t, list)
  }
  for (const list of freshByTier.values()) list.sort((a, b) => orderKey(a) < orderKey(b) ? -1 : orderKey(a) > orderKey(b) ? 1 : 0)

  const positions = new Map<string, SavedPosition>()
  const newIds: string[] = []

  // 1) saved positions pass through UNTOUCHED (never move a planted node)
  for (const [id, p] of saved) {
    if (!ids.has(id)) continue // stale row for a node no longer in the world
    positions.set(id, { x: p.x, y: p.y, tier: p.tier })
  }

  // 2) fresh placement, ascending tier (anchors before members, parents before children)
  const tierNumbers = [...freshByTier.keys()].sort((a, b) => a - b)
  for (const t of tierNumbers) {
    const slots = occupied.get(t) ?? new Set<number>()
    let next = slots.size > 0 ? Math.max(...slots) + 1 : 0
    for (const n of freshByTier.get(t)!) {
      positions.set(n.id, {
        x: next * ENGINE_CONFIG.TREE_GAP_X,
        y: t * ENGINE_CONFIG.TREE_TIER_GAP_Y,
        tier: t,
      })
      slots.add(next)
      newIds.push(n.id)
      next += 1
    }
    occupied.set(t, slots)
  }

  return { positions, newIds }
}

/**
 * Tier for a single newly planted node (docs/03 §B5): 1 + max(prereq tiers),
 * still respecting cluster grouping. Used by the growth engine when it
 * plants a seed so the node lands in a sensible layer before the next layout
 * run assigns its slot.
 */
export function plantTierFor(
  nodeId: string,
  prereqIds: string[],
  tiers: Map<string, number>,
  clusterAnchorTier: number | null,
): number {
  let t = 0
  for (const p of prereqIds) t = Math.max(t, (tiers.get(p) ?? 0) + 1)
  if (clusterAnchorTier !== null) t = Math.max(t, clusterAnchorTier + 1)
  void nodeId
  return t
}
