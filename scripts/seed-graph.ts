/**
 * Idempotent graph seeder: data/graph-en/*.json → Prisma (GraphNode/GraphEdge).
 * Safe to run repeatedly (upsert by stable ids). Never deletes (deprecation only).
 * Two passes inside one transaction: ALL nodes first, then ALL edges — otherwise
 * cross-file edges hit the FK before their endpoint rows exist.
 * Run: bunx tsx scripts/seed-graph.ts
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const DATA_DIR = path.resolve(process.cwd(), 'data/graph-en')

async function main() {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).sort()
  const nodeOps: ReturnType<typeof prisma.graphNode.upsert>[] = []
  const edgeOps: ReturnType<typeof prisma.graphEdge.upsert>[] = []
  let nodeCount = 0
  let edgeCount = 0

  for (const file of files) {
    const raw = JSON.parse(readFileSync(path.join(DATA_DIR, file), 'utf8')) as {
      nodes: Array<Record<string, unknown>>
      edges: Array<{ from: string; to: string; type: string }>
    }

    for (const n of raw.nodes ?? []) {
      nodeOps.push(
        prisma.graphNode.upsert({
          where: { id: String(n.id) },
          create: {
            id: String(n.id),
            type: String(n.type),
            lang: (n.lang as string) ?? 'en',
            cefr: (n.cefr as string) ?? null,
            frequencyRank: (n.frequencyRank as number) ?? null,
            title: String(n.title),
            glossFa: (n.glossFa as string) ?? null,
            explanationFa: (n.explanationFa as string) ?? null,
            examples: JSON.stringify(n.examples ?? []),
            tags: JSON.stringify(n.tags ?? []),
          },
          update: {
            type: String(n.type),
            cefr: (n.cefr as string) ?? null,
            frequencyRank: (n.frequencyRank as number) ?? null,
            title: String(n.title),
            glossFa: (n.glossFa as string) ?? null,
            explanationFa: (n.explanationFa as string) ?? null,
            examples: JSON.stringify(n.examples ?? []),
            tags: JSON.stringify(n.tags ?? []),
            version: { increment: 1 },
          },
        }),
      )
      nodeCount++
    }

    for (const e of raw.edges ?? []) {
      edgeOps.push(
        prisma.graphEdge.upsert({
          where: {
            fromId_toId_type: { fromId: e.from, toId: e.to, type: e.type },
          },
          create: { fromId: e.from, toId: e.to, type: e.type },
          update: {},
        }),
      )
      edgeCount++
    }
  }

  await prisma.$transaction([...nodeOps, ...edgeOps])

  const totals = {
    nodes: await prisma.graphNode.count(),
    edges: await prisma.graphEdge.count(),
  }
  console.log(`seeded ${nodeCount} nodes / ${edgeCount} edges from ${files.length} file(s)`)
  console.log(`db totals:`, totals)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
