/**
 * Graph-level availability: which nodes are locked vs frontier (docs/03 §A5).
 * Pure helpers over the in-memory graph (loaded & cached by src/lib/graph/load.ts).
 */
import type { DisplayState, EngineEdge, EngineNode, NodeSkillState } from './types'

const READY_STATES: readonly DisplayState[] = ['available', 'learning', 'mastered', 'fading', 'assumed_known']

export interface AvailabilityInput {
  nodes: EngineNode[]
  edges: EngineEdge[]
  /** user states keyed by nodeId (any skill) */
  states: Map<string, NodeSkillState[]>
  lang: string
}

export interface NodeAvailability {
  node: EngineNode
  displayState: DisplayState
  /** prerequisite ids not yet ready */
  blocking: string[]
}

/** prerequisites of a node (edges of type prerequisite point FROM prereq TO node) */
export function prerequisitesOf(nodeId: string, edges: EngineEdge[]): string[] {
  return edges.filter((e) => e.type === 'prerequisite' && e.toId === nodeId).map((e) => e.fromId)
}

export function computeAvailability(input: AvailabilityInput): NodeAvailability[] {
  const byId = new Map(input.nodes.map((n) => [n.id, n]))
  const langNodes = input.nodes.filter((n) => n.lang === input.lang)

  const stateOf = (nodeId: string): DisplayState => {
    const sts = input.states.get(nodeId)
    if (!sts || sts.length === 0) return 'locked'
    // strongest signal across skills: any learning/mastered wins over locked
    const order: DisplayState[] = ['mastered', 'learning', 'fading', 'assumed_known', 'available']
    for (const s of order) if (sts.some((x) => x.displayState === s)) return s
    return 'locked'
  }

  return langNodes.map((node) => {
    const own = stateOf(node.id)
    if (own !== 'locked') return { node, displayState: own, blocking: [] }

    // no user state: frontier iff every prerequisite is ready
    const prereqs = prerequisitesOf(node.id, input.edges)
    const blocking = prereqs.filter((p) => {
      if (!byId.has(p)) return false // dangling edge — ignore (integrity test guards elsewhere)
      return !READY_STATES.includes(stateOf(p))
    })
    return {
      node,
      displayState: blocking.length === 0 ? 'available' : 'locked',
      blocking,
    }
  })
}

/** frontier = available nodes with no state yet (next "new" candidates) */
export function frontierNodes(avail: NodeAvailability[]): NodeAvailability[] {
  return avail.filter((a) => a.displayState === 'available')
}

/** tier = longest prerequisite chain depth (for the layered tree layout) */
export function nodeTier(nodeId: string, edges: EngineEdge[], memo = new Map<string, number>()): number {
  if (memo.has(nodeId)) return memo.get(nodeId)!
  memo.set(nodeId, 0) // cycle guard
  const prereqs = prerequisitesOf(nodeId, edges)
  let tier = 0
  for (const p of prereqs) {
    if (memo.has(p) && memo.get(p) === 0 && p !== nodeId) continue // cycle
    tier = Math.max(tier, nodeTier(p, edges, memo) + 1)
  }
  memo.set(nodeId, tier)
  return tier
}
