/** M5 verification — real turn metas for the browser-test session. bun scripts/check-turns-m5.ts */
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const u = await db.user.findUnique({ where: { email: 'sara-m5@test.local' } })
const s = await db.chatSession.findFirst({ where: { userId: u!.id }, orderBy: { startedAt: 'desc' } })
const turns = await db.turn.findMany({ where: { sessionId: s!.id }, orderBy: { createdAt: 'asc' } })
for (const t of turns) {
  const meta = t.meta ? JSON.parse(t.meta) : {}
  console.log(t.role.padEnd(6), '| rate:', meta.unknownRate ?? '-', '| unknown:', JSON.stringify(meta.unknownWords ?? []), '| rewritten:', meta.rewritten ?? '-', '| fallback:', meta.fallback ?? '-')
}
await db.$disconnect()
