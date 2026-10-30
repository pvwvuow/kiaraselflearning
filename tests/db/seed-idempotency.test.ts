/**
 * Seeder idempotency + DB mirror test (docs/05 M1 acceptance:
 * "seed script rerunnable without duplicates (idempotency test)").
 *
 * Runs the real seeder twice against the dev SQLite DB and asserts:
 * - node/edge counts are identical after run 1 and run 2
 * - no duplicate rows (unique ids / unique (from,to,type))
 * - DB mirrors the file graph exactly (counts match the loader)
 * - all edges reference existing, active nodes (FK integrity + deprecation rules)
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { loadGraph } from '@/lib/graph/load'

const prisma = new PrismaClient()
const SEED_CMD = 'bunx tsx scripts/seed-graph.ts'

async function counts() {
  const [nodes, edges, activeNodes] = await Promise.all([
    prisma.graphNode.count(),
    prisma.graphEdge.count(),
    prisma.graphNode.count({ where: { status: 'active' } }),
  ])
  return { nodes, edges, activeNodes }
}

/** world-graph rows only — user-generated nodes (M7 plantings) are a separate,
 *  intended population and never part of the file-graph mirror invariant */
const WORLD = { isUserGenerated: false } as const
async function worldCounts() {
  const [nodes, edges] = await Promise.all([
    prisma.graphNode.count({ where: WORLD }),
    prisma.graphEdge.count({
      where: { fromNode: WORLD, toNode: WORLD },
    }),
  ])
  return { nodes, edges }
}

afterAll(async () => {
  await prisma.$disconnect()
})

describe('seed-graph idempotency (real DB)', () => {
  it('running the seeder twice does not duplicate anything', async () => {
    execSync(SEED_CMD, { cwd: path.resolve(process.cwd()), stdio: 'pipe', timeout: 300_000 })
    const afterFirst = await counts()

    execSync(SEED_CMD, { cwd: path.resolve(process.cwd()), stdio: 'pipe', timeout: 300_000 })
    const afterSecond = await counts()

    expect(afterSecond).toEqual(afterFirst)
    expect(afterSecond.nodes).toBeGreaterThanOrEqual(250)
    expect(afterSecond.activeNodes).toBe(afterSecond.nodes) // nothing deprecated
  }, 600_000)

  it('DB mirrors the file graph exactly (no dupes, full FK integrity)', async () => {
    const g = loadGraph('en')

    const dupIds = await prisma.$queryRaw<{ id: string; c: number }[]>`
      SELECT id, COUNT(*) as c FROM GraphNode GROUP BY id HAVING c > 1`
    expect(dupIds).toEqual([])

    const dupEdges = await prisma.$queryRaw<{ fromId: string; toId: string; type: string; c: number }[]>`
      SELECT fromId, toId, type, COUNT(*) as c FROM GraphEdge GROUP BY fromId, toId, type HAVING c > 1`
    expect(dupEdges).toEqual([])

    const [nodes, edges] = await Promise.all([worldCounts(), Promise.resolve(g)])
    expect(nodes.nodes).toBe(g.nodes.length)
    expect(nodes.edges).toBe(g.edges.length)

    const allIds = g.nodes.map((n) => n.id)
    // non-world endpoints are legitimate since M7 (pattern edges word →
    // user-generated node) — the invariant is that every edge endpoint is
    // either a world node or an EXISTING user-generated node (FK guarantees
    // existence; this catches ghost ids / typos in world data)
    const badFrom = await prisma.graphEdge.count({
      where: { fromId: { notIn: allIds }, fromNode: { isUserGenerated: false } },
    })
    const badTo = await prisma.graphEdge.count({
      where: { toId: { notIn: allIds }, toNode: { isUserGenerated: false } },
    })
    expect(badFrom).toBe(0)
    expect(badTo).toBe(0)
  })
})
