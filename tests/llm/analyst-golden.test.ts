/**
 * M4 acceptance — analyst golden set harness (docs/05 M4):
 * "Analyst golden set (≥20 labeled turns) ≥85% node-attribution accuracy
 * (offline, mocked)". The offline harness scores the recorded outputs through
 * the REAL validation pipeline (zod + whitelist + drop rules); the same file
 * doubles as the live harness fixture (KIARA_LIVE_SMOKE=1 runs the real model).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateAnalystOutput } from '@/lib/llm/analyst'
import { loadGraph } from '@/lib/graph/load'

interface GoldenTurn {
  id: string
  tutorContext: string
  learnerText: string
  knownNodes: string[]
  targetNodes: string[]
  expected: { nodeId: string; outcome: string }[]
  analystJson: unknown // object, or a raw (possibly fenced) string
}

const golden: GoldenTurn[] = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'data/analyst-golden.json'), 'utf8'),
).turns

function rawText(t: GoldenTurn): string {
  return typeof t.analystJson === 'string' ? t.analystJson : JSON.stringify(t.analystJson)
}

function scoreTurn(t: GoldenTurn): boolean {
  const whitelist = new Set(t.knownNodes)
  const v = validateAnalystOutput(rawText(t), whitelist)
  if (!v.ok) return false
  const got = v.items.map((i) => `${i.nodeId}|${i.outcome}`).sort()
  const want = t.expected.map((e) => `${e.nodeId}|${e.outcome}`).sort()
  return got.length === want.length && got.every((g, i) => g === want[i])
}

describe('analyst golden set (offline harness)', () => {
  it('has at least 20 labeled turns', () => {
    expect(golden.length).toBeGreaterThanOrEqual(20)
    for (const t of golden) expect(t.expected).toBeDefined()
  })

  it('every referenced node id is REAL in the graph (typo guard)', () => {
    const g = loadGraph('en')
    for (const t of golden) {
      for (const id of [...t.knownNodes, ...t.targetNodes, ...t.expected.map((e) => e.nodeId)]) {
        expect(g.byId.has(id), `${t.id}: ${id} must exist in the graph`).toBe(true)
      }
    }
  })

  it('every expected node is inside the turn whitelist (attribution sanity)', () => {
    for (const t of golden) {
      const wl = new Set(t.knownNodes)
      for (const e of t.expected) {
        expect(wl.has(e.nodeId), `${t.id}: expected ${e.nodeId} must be in knownNodes`).toBe(true)
      }
    }
  })

  it('attribution accuracy ≥ 85% after the validation pipeline (docs/05 M4)', () => {
    const results = golden.map((t) => ({ id: t.id, ok: scoreTurn(t) }))
    const correct = results.filter((r) => r.ok).length
    const accuracy = correct / golden.length
    // report the misses so a future fixture fix is one glance away
    const missed = results.filter((r) => !r.ok).map((r) => r.id)
    expect(accuracy, `missed: ${missed.join(', ') || 'none'}`).toBeGreaterThanOrEqual(0.85)
  })

  it('hallucination cases really exercise the drop-to-unknown path', () => {
    for (const id of ['g03', 'g21']) {
      const t = golden.find((x) => x.id === id)!
      const v = validateAnalystOutput(rawText(t), new Set(t.knownNodes))
      expect(v.ok).toBe(true)
      if (v.ok) {
        for (const item of v.items) expect(t.knownNodes).toContain(item.nodeId)
        expect(v.newUnknownWords.length).toBeGreaterThan(0)
      }
    }
  })
})
