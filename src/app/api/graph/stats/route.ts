/**
 * GET /api/graph/stats — counts by type and CEFR (docs/05 M1 acceptance).
 * Source of truth is the versioned data files via the cached loader
 * (the DB mirrors them through scripts/seed-graph.ts).
 */
import { loadGraph } from '@/lib/graph/load'

export async function GET() {
  const g = loadGraph('en')

  const byType: Record<string, number> = {}
  const byCefr: Record<string, number> = {}
  const byCefrWords: Record<string, number> = {}
  const edgeByType: Record<string, number> = {}

  for (const n of g.nodes) {
    byType[n.type] = (byType[n.type] ?? 0) + 1
    if (n.cefr) {
      byCefr[n.cefr] = (byCefr[n.cefr] ?? 0) + 1
      if (n.type === 'word') byCefrWords[n.cefr] = (byCefrWords[n.cefr] ?? 0) + 1
    }
  }
  for (const e of g.edges) {
    edgeByType[e.type] = (edgeByType[e.type] ?? 0) + 1
  }

  return Response.json({
    ok: true,
    lang: 'en',
    version: g.version,
    totalNodes: g.nodes.length,
    totalEdges: g.edges.length,
    byType,
    byCefr,
    byCefrWords,
    edges: { byType: edgeByType },
  })
}
