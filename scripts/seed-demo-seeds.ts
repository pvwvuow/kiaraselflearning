/**
 * M7 verification prep — gives the dev demo user REAL seed proposals in the
 * inbox: two independent sessions each with one confident writing error on
 * two unplanted, goal-relevant, prereq-free words, then the deterministic
 * end-of-session pipeline runs the growth scan (docs/03 §B2–B3) so the
 * proposals land in the inbox with real score breakdowns.
 * Run: bunx tsx scripts/seed-demo-seeds.ts
 */
import { PrismaClient } from '@prisma/client'
import { loadGraph } from '@/lib/graph/load'
import { prerequisitesOf } from '@/lib/engine/graph'
import { endSession } from '@/lib/session/pipeline'
import { writeTurnEvidence } from '@/lib/evidence/writer'

const db = new PrismaClient()

const TRAVEL_TAGS = ['travel', 'airport', 'hotel', 'food', 'restaurant', 'directions', 'shopping', 'smalltalk']

async function main() {
  const user = await db.user.findUnique({ where: { email: 'demo@kiara.app' } })
  if (!user) throw new Error('demo user missing — run scripts/seed-demo-user.ts first')
  const goal = user.goal ?? 'travel'
  const goalTags = goal === 'travel' ? TRAVEL_TAGS : null
  const graph = loadGraph('en')

  const [states, seeds] = await Promise.all([
    db.userNodeState.findMany({ where: { userId: user.id }, select: { nodeId: true } }),
    db.seed.findMany({
      where: { userId: user.id, status: { in: ['proposed', 'approved', 'planted'] } },
      select: { candidateNodeId: true },
    }),
  ])
  const taken = new Set([...states.map((s) => s.nodeId), ...seeds.map((s) => s.candidateNodeId)])

  const candidates = graph.nodes
    .filter((n) => n.type === 'word' && !taken.has(n.id))
    .filter((n) => (n.frequencyRank ?? Infinity) <= 5000)
    .filter((n) => goalTags === null || n.tags.some((t) => goalTags.includes(t)))
    .filter((n) => prerequisitesOf(n.id, graph.edges).length === 0) // readiness 1.0 → score 0.80
    .sort((a, b) => (a.frequencyRank ?? 1e9) - (b.frequencyRank ?? 1e9))
    .slice(0, 2)

  if (candidates.length === 0) {
    console.log('nothing to propose — demo inbox already seeded')
    return
  }
  console.log('candidates:', candidates.map((c) => `${c.id} (rank ${c.frequencyRank})`).join(', '))

  for (let i = 0; i < 2; i++) {
    const session = await db.chatSession.create({
      data: { userId: user.id, type: 'roleplay_targeted', status: 'active', startedAt: new Date() },
    })
    for (const n of candidates) {
      await writeTurnEvidence(user.id, session.id, `turn-${session.id}-${n.id}`, {
        ok: true,
        items: [
          {
            nodeId: n.id,
            skill: 'writing',
            outcome: 'error',
            confidence: 0.9,
            errorType: 'form',
            produced: 'he recommend it',
            expected: 'he recommends it',
            l1Interference: true,
            hintUsed: false,
          },
        ],
        newUnknownWords: [],
      })
    }
    const r = await endSession(user.id, session.id, new Date())
    console.log(`session ${i + 1} ended → seeds:`, r.seeds.length)
  }

  const inbox = await db.seed.findMany({ where: { userId: user.id, status: 'proposed' } })
  console.log(`inbox now holds ${inbox.length} proposal(s):`)
  for (const s of inbox) {
    console.log('-', s.candidateNodeId ?? s.candidatePayload, `score ${s.score}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
