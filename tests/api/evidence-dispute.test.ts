/**
 * M4 acceptance — dispute API (docs/05 M4): "flag evidence → excluded from
 * next aggregation (unit + DB test)". Append-only: the row is never deleted.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { POST as register } from '@/app/api/auth/register/route'
import { POST as dispute } from '@/app/api/evidence/[id]/dispute/route'
import { endSession } from '@/lib/session/pipeline'
import { writeTurnEvidence } from '@/lib/evidence/writer'

const prisma = new PrismaClient()
const DOMAIN = 'dispute.test'
const NODE = 'en:word:price' // A1 word, frequent, no prereqs

let cookie = ''
let userId = ''

function req(url: string, body: unknown, withCookie = true): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } })
  await prisma.$disconnect()
})

describe('POST /api/evidence/:id/dispute', () => {
  it('setup: user + a session whose only evidence is one error', async () => {
    const email = `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`
    const res = await register(req('http://x/api/auth/register', { email, password: 's3cret-pass' }, false))
    cookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('kiara_session='))!.split(';')[0]
    const user = await prisma.user.findUnique({ where: { email } })
    userId = user!.id
  })

  it('flags the evidence with a reason; row still exists (append-only)', async () => {
    const session = await prisma.chatSession.create({
      data: { userId, type: 'roleplay_targeted', status: 'active' },
    })
    const written = await writeTurnEvidence(userId, session.id, 't1', {
      ok: true,
      items: [
        { nodeId: NODE, skill: 'writing', outcome: 'error', confidence: 0.95, errorType: 'form' },
      ],
      newUnknownWords: [],
    })
    expect(written.written).toBe(1)
    const evidenceId = written.ids[0]

    const res = await dispute(
      req(`http://x/api/evidence/${evidenceId}/dispute`, { reason: 'این خطا نبود، تایپ اشتباه بود' }),
      { params: Promise.resolve({ id: evidenceId }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; disputed: boolean }
    expect(body.ok).toBe(true)
    expect(body.disputed).toBe(true)

    const row = await prisma.evidence.findUnique({ where: { id: evidenceId } })
    expect(row, 'dispute must NEVER delete the row').toBeTruthy()
    expect(row?.disputed).toBe(true)
    expect(row?.disputeReason).toContain('تایپ')

    // idempotent second dispute → 200, reason unchanged
    const res2 = await dispute(
      req(`http://x/api/evidence/${evidenceId}/dispute`, { reason: 'second' }),
      { params: Promise.resolve({ id: evidenceId }) },
    )
    expect(res2.status).toBe(200)
    const row2 = await prisma.evidence.findUnique({ where: { id: evidenceId } })
    expect(row2?.disputeReason).toContain('تایپ')

    // 404 for a foreign/nonexistent id
    const res3 = await dispute(req('http://x/api/evidence/nonexistent/dispute', {}), {
      params: Promise.resolve({ id: 'nonexistent' }),
    })
    expect(res3.status).toBe(404)

    // 401 without a session cookie
    const res4 = await dispute(req(`http://x/api/evidence/${evidenceId}/dispute`, {}, false), {
      params: Promise.resolve({ id: evidenceId }),
    })
    expect(res4.status).toBe(401)
  })

  it('disputed evidence is excluded from the next aggregation → NO state written', async () => {
    const session = await prisma.chatSession.create({
      data: { userId, type: 'roleplay_targeted', status: 'active' },
    })
    // the ONLY evidence of this session is the disputed error from the previous test's session…
    // …so here we write one disputed error into a NEW session and end it:
    await writeTurnEvidence(userId, session.id, 't2', {
      ok: true,
      items: [{ nodeId: NODE, skill: 'writing', outcome: 'error', confidence: 0.95, disputed: true }],
      newUnknownWords: [],
    })
    // but the writer persists disputed=false by default — flag it via the API first:
    const row = await prisma.evidence.findFirst({ where: { sessionId: session.id } })
    await dispute(req(`http://x/api/evidence/${row!.id}/dispute`, { reason: 'again wrong' }), {
      params: Promise.resolve({ id: row!.id }),
    })

    const result = await endSession(userId, session.id, new Date())
    // nothing aggregatable: weight 0 → no rating, no state row for the node
    expect(result.applied).toHaveLength(0)
    const state = await prisma.userNodeState.findUnique({
      where: { userId_nodeId_skill: { userId, nodeId: NODE, skill: 'writing' } },
    })
    expect(state).toBeNull()
  })

  it('control: the same error WITHOUT dispute DOES produce a state (previous test was meaningful)', async () => {
    const session = await prisma.chatSession.create({
      data: { userId, type: 'roleplay_targeted', status: 'active' },
    })
    await writeTurnEvidence(userId, session.id, 't3', {
      ok: true,
      items: [{ nodeId: NODE, skill: 'writing', outcome: 'error', confidence: 0.9 }],
      newUnknownWords: [],
    })
    const result = await endSession(userId, session.id, new Date())
    expect(result.applied).toHaveLength(1)
    expect(result.applied[0]?.rating).toBe('Again') // first exposure, agg −1
    const state = await prisma.userNodeState.findUnique({
      where: { userId_nodeId_skill: { userId, nodeId: NODE, skill: 'writing' } },
    })
    expect(state?.reps).toBe(1)
  })
})
