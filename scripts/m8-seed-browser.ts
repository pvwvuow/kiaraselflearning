/** seed an eligible state on a node NOT touched by earlier M8 checks (journey) */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const NODE = 'en:word:journey'
const main = async () => {
  const user = await prisma.user.findUnique({ where: { email: 'demo@kiara.app' } })
  if (!user) throw new Error('demo user missing')
  await prisma.userNodeState.upsert({
    where: { userId_nodeId_skill: { userId: user.id, nodeId: NODE, skill: 'writing' } },
    create: {
      userId: user.id, nodeId: NODE, skill: 'writing',
      reps: 5, stability: 30, difficulty: 4.5, fsrsState: 'Review',
      lastReviewAt: new Date(Date.now() - 6 * 86400000),
      due: new Date(Date.now() + 24 * 86400000),
      pendingDelayTest: true,
      delayTestEligibleAt: new Date(Date.now() - 3 * 86400000),
      strength: 0.7, displayState: 'learning',
    },
    update: {
      reps: 5, stability: 30, difficulty: 4.5, fsrsState: 'Review', masteredAt: null,
      lastReviewAt: new Date(Date.now() - 6 * 86400000),
      due: new Date(Date.now() + 24 * 86400000),
      pendingDelayTest: true,
      delayTestEligibleAt: new Date(Date.now() - 3 * 86400000),
      displayState: 'learning',
    },
  })
  console.log('seeded', NODE)
  await prisma.$disconnect()
}
main()
