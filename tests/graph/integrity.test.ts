/**
 * Graph integrity tests (docs/05 M1 acceptance):
 * - ≥250 nodes with the documented type mix
 * - unique ids; every edge endpoint exists
 * - prerequisite subgraph is a DAG; every prereq-having node is reachable
 *   from a prereq-root (frontier roots = nodes without prereqs)
 * - words are placement/quiz-ready: glossFa + frequencyRank + valid band
 * - content nodes carry at least one example sentence (teach moment)
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadGraph } from '@/lib/graph/load'
import { CEFR_BANDS } from '@/lib/engine/types'

const g = loadGraph('en')

describe('graph size & mix', () => {
  it('has ≥250 nodes', () => {
    expect(g.nodes.length).toBeGreaterThanOrEqual(250)
  })

  it('has the documented type minimums', () => {
    const byType = new Map<string, number>()
    for (const n of g.nodes) byType.set(n.type, (byType.get(n.type) ?? 0) + 1)
    expect(byType.get('word')).toBeGreaterThanOrEqual(185)
    expect(byType.get('chunk')).toBeGreaterThanOrEqual(25)
    expect(byType.get('grammar_pattern')).toBeGreaterThanOrEqual(20)
    expect(byType.get('pragmatic_skill')).toBeGreaterThanOrEqual(15)
    expect(byType.get('error_pattern')).toBeGreaterThanOrEqual(12)
    expect(byType.get('topic_cluster')).toBeGreaterThanOrEqual(6)
  })

  it('has meaningful edges (all four edge types present, ≥150 total)', () => {
    const types = new Set(g.edges.map((e) => e.type))
    for (const t of ['prerequisite', 'related', 'confusable', 'part_of']) {
      expect(types.has(t), `missing edge type ${t}`).toBe(true)
    }
    expect(g.edges.length).toBeGreaterThanOrEqual(150)
  })
})

describe('graph integrity', () => {
  it('node ids are unique', () => {
    expect(g.byId.size).toBe(g.nodes.length)
  })

  it('every edge endpoint exists', () => {
    const dangling = g.edges.filter((e) => !g.byId.has(e.fromId) || !g.byId.has(e.toId))
    expect(dangling).toEqual([])
  })

  it('prerequisite subgraph is a DAG (no cycles — nodeTier relies on this)', () => {
    const prereqOf = new Map<string, string[]>() // node -> its prereqs
    for (const e of g.edges) {
      if (e.type !== 'prerequisite') continue
      const list = prereqOf.get(e.toId) ?? []
      list.push(e.fromId)
      prereqOf.set(e.toId, list)
    }
    const done = new Set<string>()
    let cyclic = false
    const visit = (id: string, stack: Set<string>) => {
      if (cyclic) return
      if (stack.has(id)) {
        cyclic = true
        return
      }
      if (done.has(id)) return
      stack.add(id)
      for (const p of prereqOf.get(id) ?? []) visit(p, stack)
      stack.delete(id)
      done.add(id)
    }
    for (const n of g.nodes) visit(n.id, new Set())
    expect(cyclic, 'prerequisite cycle detected').toBe(false)
  })

  it('every node with prerequisites is reachable from a prereq-root (no islands)', () => {
    const prereqOf = new Map<string, string[]>()
    for (const e of g.edges) {
      if (e.type !== 'prerequisite') continue
      const list = prereqOf.get(e.toId) ?? []
      list.push(e.fromId)
      prereqOf.set(e.toId, list)
    }
    const roots = g.nodes.filter((n) => !(prereqOf.get(n.id)?.length)).map((n) => n.id)
    expect(roots.length, 'graph must have prereq roots for the frontier to exist').toBeGreaterThan(0)

    const reachable = new Set<string>(roots)
    let changed = true
    while (changed) {
      changed = false
      for (const e of g.edges) {
        if (e.type !== 'prerequisite') continue
        if (reachable.has(e.fromId) && !reachable.has(e.toId)) {
          reachable.add(e.toId)
          changed = true
        }
      }
    }
    const orphans = g.nodes
      .filter((n) => (prereqOf.get(n.id)?.length ?? 0) > 0)
      .filter((n) => !reachable.has(n.id))
      .map((n) => n.id)
    expect(orphans, `nodes with prereqs unreachable from any root: ${orphans.join(', ')}`).toEqual([])
  })

  it('all words are placement/quiz-ready: glossFa + frequencyRank + valid band', () => {
    const bad = g.nodes.filter(
      (n) =>
        n.type === 'word' &&
        (!n.glossFa || n.frequencyRank === null || !n.cefr || !(CEFR_BANDS as readonly string[]).includes(n.cefr)),
    )
    expect(bad.map((n) => n.id)).toEqual([])
  })

  it('content nodes in the authored files carry at least one example sentence', () => {
    const dir = path.resolve(process.cwd(), 'data/graph-en')
    const files = ['words.a1.json', 'words.a2.json', 'words.b1.json', 'chunks.json', 'grammar.json', 'pragmatic.json']
    const empty: string[] = []
    for (const f of files) {
      const raw = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as {
        nodes: { id: string; examples: unknown[] }[]
      }
      for (const n of raw.nodes) {
        if (!n.examples || n.examples.length === 0) empty.push(n.id)
      }
    }
    expect(empty).toEqual([])
  })
})
