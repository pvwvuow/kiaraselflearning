/**
 * M8 live check against the running dev server (:3000) — demo user flow:
 * login → delayed-test status → seed an eligible state → start confirmatory
 * → 3 real answers (real grok-4.20 analyst grades them) → end → summary.
 */
const BASE = 'http://localhost:3000'
const NODE = 'en:word:recommend'

async function j(method: string, path: string, body?: unknown, cookie?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  const text = await res.text()
  let json: unknown = null
  try { json = JSON.parse(text) } catch { /* html */ }
  return { status: res.status, json, cookie: setCookie.map((c) => c.split(';')[0]).join('; ') }
}

async function main() {
  const login = await j('POST', '/api/auth/login', { email: 'demo@kiara.app', password: 'kiara-demo-1234' })
  console.log('login:', login.status)
  const cookie = login.cookie
  if (!cookie) throw new Error('no cookie')

  const status0 = await j('GET', '/api/delayed-test/status', undefined, cookie)
  console.log('status before:', JSON.stringify(status0.json))

  // seed a mastery-eligible state directly in the DB via the demo user
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
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
      reps: 5, stability: 30, fsrsState: 'Review', masteredAt: null,
      lastReviewAt: new Date(Date.now() - 6 * 86400000),
      due: new Date(Date.now() + 24 * 86400000),
      pendingDelayTest: true,
      delayTestEligibleAt: new Date(Date.now() - 3 * 86400000),
      displayState: 'learning',
    },
  })
  console.log('seeded eligible state for', NODE)

  const status1 = await j('GET', '/api/delayed-test/status', undefined, cookie)
  console.log('status after:', JSON.stringify(status1.json))

  const start = await j('POST', '/api/session/start', { type: 'confirmatory' }, cookie)
  console.log('confirmatory start:', start.status, JSON.stringify(start.json).slice(0, 400))
  const data = start.json as { started: boolean; sessionId?: string; plan?: { probeCount: number; contextsPerProbe: number } }
  if (!data.started || !data.sessionId) { await prisma.$disconnect(); return }

  const answers = [
    'I recommend the airport hotel — it is close to the terminal.',
    'I recommend trying the local food market.',
    'I no recommend this one, is bad.', // deliberate error on the 3rd
  ]
  for (const a of answers) {
    const t = await j('POST', '/api/session/turn', { sessionId: data.sessionId, content: a }, cookie)
    console.log('turn:', t.status, JSON.stringify(t.json).slice(0, 160))
  }

  const end = await j('POST', '/api/session/end', { sessionId: data.sessionId }, cookie)
  console.log('end:', end.status, JSON.stringify(end.json).slice(0, 600))

  const st = await prisma.userNodeState.findUnique({
    where: { userId_nodeId_skill: { userId: user.id, nodeId: NODE, skill: 'writing' } },
  })
  console.log('final state:', { displayState: st?.displayState, masteredAt: st?.masteredAt, reps: st?.reps, pending: st?.pendingDelayTest })
  await prisma.$disconnect()
}

main().catch((e) => { console.error('LIVE CHECK FAILED:', e); process.exit(1) })
