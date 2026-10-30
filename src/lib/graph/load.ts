/**
 * In-memory world-graph loader with cache.
 * The graph is small (300–10k nodes) and read-heavy → load once per process.
 * Cache key includes the data file mtime so dev edits invalidate cleanly.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import type { EngineEdge, EngineNode, NodeType, EdgeType } from '@/lib/engine/types'

export interface GraphData {
  nodes: EngineNode[]
  edges: EngineEdge[]
  byId: Map<string, EngineNode>
  version: string
}

const DATA_DIR = path.resolve(process.cwd(), 'data/graph-en')

let cache: { key: string; graph: GraphData } | null = null

function fileKey(): string {
  // cheap fingerprint: file name + size + mtimeMs of every json in the dir
  const parts: string[] = []
  for (const f of readdirSync(DATA_DIR).filter((x) => x.endsWith('.json')).sort()) {
    const st = statSync(path.join(DATA_DIR, f))
    parts.push(`${f}:${st.size}:${st.mtimeMs}`)
  }
  return parts.join('|')
}

export function loadGraph(lang = 'en'): GraphData {
  const key = `${lang}::${fileKey()}`
  if (cache && cache.key === key) return cache.graph

  const nodes: EngineNode[] = []
  const edges: EngineEdge[] = []

  for (const file of readdirSync(DATA_DIR).filter((x) => x.endsWith('.json')).sort()) {
    const raw = JSON.parse(readFileSync(path.join(DATA_DIR, file), 'utf8')) as {
      nodes: Array<Record<string, unknown>>
      edges: Array<{ from: string; to: string; type: string }>
    }
    for (const n of raw.nodes ?? []) {
      if (n.lang && n.lang !== lang) continue
      nodes.push({
        id: String(n.id),
        type: n.type as NodeType,
        lang: (n.lang as string) ?? lang,
        cefr: (n.cefr as string) ?? null,
        frequencyRank: (n.frequencyRank as number) ?? null,
        title: String(n.title),
        glossFa: (n.glossFa as string) ?? null,
        tags: Array.isArray(n.tags) ? (n.tags as string[]) : [],
      })
    }
    for (const e of raw.edges ?? []) {
      edges.push({ fromId: e.from, toId: e.to, type: e.type as EdgeType, weight: 1 })
    }
  }

  const graph: GraphData = {
    nodes,
    edges,
    byId: new Map(nodes.map((n) => [n.id, n])),
    version: key,
  }
  cache = { key, graph }
  return graph
}

/** whitelist check for analyst output — the only gate node ids pass (docs/00 R1) */
export function isKnownNodeId(nodeId: string, lang = 'en'): boolean {
  return loadGraph(lang).byId.has(nodeId)
}
