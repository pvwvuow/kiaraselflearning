/**
 * M6 acceptance (docs/05) — tree layout:
 *  1. layout stability: two renders with unchanged state → identical positions
 *  2. a newly planted node lands at a STABLE next-free-slot (docs/03 §B5)
 *     and never moves existing nodes
 *  3. tiers = longest prerequisite depth, raised for cluster membership
 *  4. determinism: ordering by (cluster, rank, id) — no Math.random anywhere
 */
import { describe, expect, it } from 'vitest'
import {
  computeTreeLayout,
  buildLayoutTiers,
  plantTierFor,
  slotOfX,
} from '@/lib/engine/tree-layout'
import { ENGINE_CONFIG } from '@/lib/engine/config'
import type { EngineEdge, EngineNode } from '@/lib/engine/types'

function node(id: string, opts: Partial<EngineNode> = {}): EngineNode {
  return {
    id,
    type: 'word',
    lang: 'en',
    cefr: 'A1',
    frequencyRank: null,
    title: id.split(':').pop() ?? id,
    glossFa: null,
    tags: [],
    ...opts,
  }
}

function edge(from: string, to: string, type: EngineEdge['type'] = 'prerequisite'): EngineEdge {
  return { fromId: from, toId: to, type, weight: 1 }
}

const GAP = ENGINE_CONFIG.TREE_GAP_X
const TIER_GAP = ENGINE_CONFIG.TREE_TIER_GAP_Y

describe('buildLayoutTiers', () => {
  it('tier = longest prerequisite chain depth', () => {
    // a ← b ← c  (edge points FROM prereq TO dependent)
    const nodes = [node('a'), node('b'), node('c')]
    const edges = [edge('a', 'b'), edge('b', 'c')]
    const tiers = buildLayoutTiers(nodes, edges)
    expect(tiers.get('a')).toBe(0)
    expect(tiers.get('b')).toBe(1)
    expect(tiers.get('c')).toBe(2)
  })

  it('cluster members sit one level under their cluster anchor (part_of bonus)', () => {
    const cluster = node('en:cluster:travel', { type: 'topic_cluster' })
    const word = node('en:word:flight')
    const grammar = node('en:grammar:x')
    // word: no prereqs but part_of the cluster → tier 1, not 0
    // grammar: prereq depth 1 beats the cluster bonus → stays 1
    const nodes = [cluster, word, grammar, node('en:word:z')]
    const edges = [
      edge('en:word:flight', 'en:cluster:travel', 'part_of'),
      edge('en:word:z', 'en:grammar:x'),
    ]
    const tiers = buildLayoutTiers(nodes, edges)
    expect(tiers.get('en:cluster:travel')).toBe(0)
    expect(tiers.get('en:word:flight')).toBe(1)
    expect(tiers.get('en:grammar:x')).toBe(1)
    expect(tiers.get('en:word:z')).toBe(0)
  })

  it('part_of edges to non-cluster nodes do NOT raise the tier', () => {
    const chunk = node('en:chunk:x')
    const word = node('en:word:x')
    const nodes = [chunk, word]
    const tiers = buildLayoutTiers(nodes, [edge('en:word:x', 'en:chunk:x', 'part_of')])
    expect(tiers.get('en:word:x')).toBe(0)
  })
})

describe('computeTreeLayout — stability (M6 acceptance)', () => {
  const world = () => ({
    nodes: [
      node('en:word:aaa', { frequencyRank: 100 }),
      node('en:word:bbb', { frequencyRank: 200 }),
      node('en:word:ccc', { frequencyRank: 300 }),
      node('en:grammar:g', { type: 'grammar_pattern' as const }),
      node('en:cluster:c', { type: 'topic_cluster' as const }),
    ],
    edges: [edge('en:word:aaa', 'en:grammar:g'), edge('en:word:bbb', 'en:cluster:c', 'part_of')],
  })

  it('two renders with unchanged state → IDENTICAL positions', () => {
    const { nodes, edges } = world()
    const r1 = computeTreeLayout({ nodes, edges, saved: new Map() })
    const r2 = computeTreeLayout({ nodes, edges, saved: new Map() })
    expect(JSON.stringify([...r1.positions.entries()])).toBe(JSON.stringify([...r2.positions.entries()]))
  })

  it('first full layout: x = slot × GAP, y = tier × TIER_GAP, all nodes placed', () => {
    const { nodes, edges } = world()
    const r = computeTreeLayout({ nodes, edges, saved: new Map() })
    expect(r.positions.size).toBe(nodes.length)
    expect(r.newIds.length).toBe(nodes.length)
    for (const [id, p] of r.positions) {
      expect(p.x).toBe(slotOfX(p.x) * GAP) // integer slots only
      expect(p.y).toBe(p.tier * TIER_GAP)
      void id
    }
    expect(r.positions.get('en:cluster:c')!.tier).toBe(0)
    expect(r.positions.get('en:word:bbb')!.tier).toBe(1) // cluster member
    expect(r.positions.get('en:grammar:g')!.tier).toBe(1) // prereq child
    expect(r.positions.get('en:word:ccc')!.tier).toBe(0) // standalone word
  })

  it('saved positions are kept EXACTLY; only new nodes get fresh slots', () => {
    const { nodes, edges } = world()
    const first = computeTreeLayout({ nodes, edges, saved: new Map() })

    // a new node is "planted" (docs/03 §B5) — as if the growth engine added it
    const planted = node('en:word:seedling', { frequencyRank: 5000 })
    const second = computeTreeLayout({
      nodes: [...nodes, planted],
      edges,
      saved: first.positions,
    })
    // every old node keeps its exact position
    for (const [id, p] of first.positions) {
      expect(second.positions.get(id)).toEqual(p)
    }
    expect(second.newIds).toEqual(['en:word:seedling'])
    // the seedling: standalone word, tier 0, next free slot right of the tier
    const p = second.positions.get('en:word:seedling')!
    const tier0 = [...first.positions.values()].filter((x) => x.tier === 0)
    const maxTier0Slot = Math.max(...tier0.map((p) => slotOfX(p.x)))
    expect(p.tier).toBe(0)
    expect(slotOfX(p.x)).toBe(maxTier0Slot + 1)
  })

  it('no two nodes ever share a (tier, slot)', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => node(`en:word:w${i}`, { frequencyRank: i * 10 }))
    const r = computeTreeLayout({ nodes, edges: [], saved: new Map() })
    const slots = new Set([...r.positions.values()].map((p) => `${p.tier}:${slotOfX(p.x)}`))
    expect(slots.size).toBe(40)
  })

  it('slot layout is collision-free even with sparse saved positions at odd x', () => {
    const nodes = [node('a'), node('b')]
    const saved = new Map([
      ['a', { x: 7 * GAP, y: 0, tier: 0 }],
      ['b', { x: 3.5 * GAP, y: 0, tier: 0 }], // hand-edited legacy x
    ])
    const r = computeTreeLayout({ nodes, edges: [], saved })
    expect(r.positions.get('a')).toEqual({ x: 7 * GAP, y: 0, tier: 0 })
    expect(r.positions.get('b')).toEqual({ x: 3.5 * GAP, y: 0, tier: 0 })
    expect(r.newIds).toEqual([])
  })

  it('stale saved rows for removed nodes are dropped silently', () => {
    const nodes = [node('a')]
    const saved = new Map([['en:word:ghost', { x: 5 * GAP, y: 0, tier: 0 }]])
    const r = computeTreeLayout({ nodes, edges: [], saved })
    expect(r.positions.size).toBe(1)
    expect(r.newIds).toEqual(['a'])
  })

  it('within-tier order: cluster members hug their anchor, then rank, then id', () => {
    const cluster = node('en:cluster:c', { type: 'topic_cluster' })
    const m1 = node('en:word:m1', { frequencyRank: 900 })
    const m2 = node('en:word:m2', { frequencyRank: 10 })
    const solo = node('en:word:solo', { frequencyRank: 5 })
    const nodes = [cluster, m1, m2, solo]
    const edges = [edge('en:word:m1', 'en:cluster:c', 'part_of'), edge('en:word:m2', 'en:cluster:c', 'part_of')]
    const r = computeTreeLayout({ nodes, edges, saved: new Map() })
    // tier 0 slots: cluster first (typeGroup 0), then by cluster membership…
    // cluster anchor at slot 0; m1/m2 are tier 1 (cluster members); solo tier 0 slot 1
    const slotOf = (id: string) => slotOfX(r.positions.get(id)!.x)
    expect(slotOf('en:cluster:c')).toBe(0)
    expect(slotOf('en:word:solo')).toBe(1)
    // m2 (rank 10) before m1 (rank 900) within tier 1
    const t1 = [slotOf('en:word:m2'), slotOf('en:word:m1')]
    expect(t1[0]).toBeLessThan(t1[1])
  })
})

describe('plantTierFor (docs/03 §B5)', () => {
  it('tier = 1 + max(prereq tiers), raised by cluster anchor', () => {
    const tiers = new Map([
      ['p1', 0],
      ['p2', 2],
      ['anchor', 1],
    ])
    expect(plantTierFor('x', ['p1'], tiers, null)).toBe(1)
    expect(plantTierFor('x', ['p1', 'p2'], tiers, null)).toBe(3)
    expect(plantTierFor('x', [], tiers, 1)).toBe(2)
    expect(plantTierFor('x', ['p2'], tiers, 1)).toBe(3) // max wins
  })
})
