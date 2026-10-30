/**
 * M6 verification prep — gives the dev demo user a realistic tree:
 * a spread of states (learning / fading / mastered / assumed_known) so the
 * tree view shows every display state. Idempotent: upserts, never overwrites
 * an existing practiced row's schedule (only fills gaps).
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const DAY = 86_400_000
const now = Date.now()

async function main() {
  const user = await db.user.findUnique({ where: { email: 'demo@kiara.app' } })
  if (!user) throw new Error('demo user missing — run scripts/seed-demo-user.ts first')
  console.log('demo user', user.id)

  const upsert = (nodeId: string, skill: string, data: Record<string, unknown>) =>
    db.userNodeState.upsert({
      where: { userId_nodeId_skill: { userId: user.id, nodeId, skill } },
      create: { userId: user.id, nodeId, skill, ...data } as never,
      update: {}, // never overwrite practiced state
    })

  const learning = {
    stability: 4.2,
    difficulty: 5.1,
    lastReviewAt: new Date(now - 2 * DAY),
    due: new Date(now + 3 * DAY),
    reps: 2,
    fsrsState: 'Learning',
    displayState: 'learning',
    strength: 0.55,
  }
  const fading = {
    stability: 9.8,
    difficulty: 6.4,
    lastReviewAt: new Date(now - 42 * DAY),
    due: new Date(now - 32 * DAY),
    reps: 3,
    fsrsState: 'Review',
    displayState: 'learning',
    strength: 0.3,
  }
  const mastered = {
    stability: 38.2,
    difficulty: 4.4,
    lastReviewAt: new Date(now - 20 * DAY),
    due: new Date(now + 17 * DAY),
    reps: 6,
    fsrsState: 'Review',
    displayState: 'mastered',
    masteredAt: new Date(now - 20 * DAY),
    pendingDelayTest: false,
    strength: 0.9,
  }
  const assumed = {
    stability: 0,
    difficulty: 0,
    reps: 0,
    fsrsState: 'New',
    displayState: 'assumed_known',
    strength: 0.5,
  }

  const ops: Promise<unknown>[] = []
  // learning (travel-flavored words)
  for (const id of ['en:word:flight', 'en:word:luggage', 'en:word:recommend', 'en:chunk:could-you', 'en:word:airport']) {
    ops.push(upsert(id, 'writing', learning))
    ops.push(upsert(id, 'reading', { ...learning, strength: 0.65 }))
  }
  // fading (overdue → dashed ring + red)
  for (const id of ['en:word:hotel', 'en:chunk:how-many', 'en:word:expensive']) {
    ops.push(upsert(id, 'writing', fading))
  }
  // mastered (green)
  for (const id of ['en:word:water', 'en:word:food', 'en:grammar:present-simple']) {
    ops.push(upsert(id, 'writing', mastered))
  }
  // assumed_known (violet) — a placement-like spread
  const words = (await db.graphNode.findMany({
    where: { type: 'word', cefr: { in: ['A1', 'A2'] }, status: 'active' },
    take: 60,
    orderBy: { frequencyRank: 'asc' },
  })).map((n) => n.id)
  for (const id of words) ops.push(upsert(id, 'writing', assumed))
  for (const id of words.slice(0, 40)) ops.push(upsert(id, 'reading', assumed))

  await Promise.all(ops)
  const count = await db.userNodeState.count({ where: { userId: user.id } })
  console.log('states now:', count)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
