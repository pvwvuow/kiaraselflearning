/**
 * M5 verification helper — placement persistence for the browser test user.
 * Run: bun scripts/check-placement-m5.ts
 */
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const u = await db.user.findUnique({ where: { email: 'sara-m5@test.local' } })
console.log('cefrSelf:', u?.cefrSelf, '| cefrComputed:', u?.cefrComputed, '| consent:', u?.consentLlmAt?.toISOString())
const states = await db.userNodeState.findMany({ where: { userId: u!.id, displayState: 'assumed_known' } })
console.log('assumed_known states:', states.length, '| all pendingDelayTest:', states.every((s) => s.pendingDelayTest), '| mastered count:', states.filter((s) => s.masteredAt).length)
const m = await db.metricEvent.findFirst({ where: { userId: u!.id, name: 'placement_applied' } })
console.log('metric placement_applied:', m ? JSON.parse(m.props) : 'MISSING')
await db.$disconnect()
