/**
 * Dev-only demo user (docs/05 M2: "demo user seed for dev").
 * Idempotent upsert. Password comes from DEMO_PASSWORD env (default below is
 * a dev convenience, not a secret; the account exists only in local DBs).
 * Run: bunx tsx scripts/seed-demo-user.ts
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const email = 'demo@kiara.app'
  const password = process.env.DEMO_PASSWORD ?? 'kiara-demo-1234'
  const passwordHash = await bcrypt.hash(password, 10)

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      displayName: 'کاربر نمونه',
      cefrSelf: 'A2',
      goal: 'travel',
      interests: JSON.stringify(['travel', 'food', 'movies']),
      dailyMinutes: 15,
      correctionStyle: 'immediate',
      consentLlmAt: new Date(),
    },
    update: { passwordHash }, // keep the known password working in dev
  })

  console.log(`demo user ready: ${user.email} (id=${user.id})`)
  console.log(`login password: ${password === 'kiara-demo-1234' ? 'kiara-demo-1234 (default)' : 'from DEMO_PASSWORD env'}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
