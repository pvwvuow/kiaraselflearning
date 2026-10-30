/**
 * GET /api/graph/stats smoke test (docs/05 M1 acceptance).
 * The route is a plain handler (no next/server import) so it can be invoked
 * directly in vitest.
 */
import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/graph/stats/route'
import { loadGraph } from '@/lib/graph/load'

describe('GET /api/graph/stats', () => {
  it('returns counts by type and cefr', async () => {
    const res = await GET()
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      ok: boolean
      lang: string
      totalNodes: number
      totalEdges: number
      byType: Record<string, number>
      byCefr: Record<string, number>
      byCefrWords: Record<string, number>
      edges: { byType: Record<string, number> }
    }

    expect(body.ok).toBe(true)
    expect(body.lang).toBe('en')
    expect(body.totalNodes).toBeGreaterThanOrEqual(250)

    const g = loadGraph('en')
    expect(body.totalNodes).toBe(g.nodes.length)
    expect(body.totalEdges).toBe(g.edges.length)

    const sumOf = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0)
    expect(sumOf(body.byType)).toBe(g.nodes.length)
    expect(body.byType.word).toBeGreaterThanOrEqual(185)

    // words per band present
    expect(body.byCefrWords.A1).toBeGreaterThan(0)
    expect(body.byCefrWords.A2).toBeGreaterThan(0)
    expect(body.byCefrWords.B1).toBeGreaterThan(0)

    expect(sumOf(body.edges.byType)).toBe(g.edges.length)
    expect(body.edges.byType.prerequisite).toBeGreaterThan(0)
  })
})
