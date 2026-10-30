/**
 * M7 — seed inbox + growth wiring through the REAL DB (docs/05 M7):
 *  - unit-acceptance (DB level): 2 errors across 2 sessions on an unplanted
 *    word → proposal with score ≥ 0.45 (docs/05 M7 #1)
 *  - cap: the 4th approval in the 7-day window is HELD in queue (docs/05 M7 #2)
 *  - reject → no re-proposal of the same node for 14 days (docs/05 M7 #3)
 *  - planting: state (reading+writing, available) + tree appearance;
 *    track_pattern creates a real user-generated node + prerequisite edge.
 * The LLM is NOT involved — endSession is deterministic.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { GET as seedsGET } from '@/app/api/seeds/route'
import { POST as approve } from '@/app/api/seeds/[id]/approve/route'
import { POST as reject } from '@/app/api/seeds/[id]/reject/route'
import { POST as end } from '@/app/api/session/end/route'
import { GET as treeGET } from '@/app/api/tree/route'
import { POST as register } from '@/app/api/auth/register/route'
import { PATCH as onboardingPATCH } from '@/app/api/onboarding/route'
import { db } from '@/lib/db'
import { writeTurnEvidence } from '@/lib/evidence/writer'
import type { SeedsInboxResponse } from '@/lib/client/api'
import type { ApproveSeedResult } from '@/lib/tree/seed-service'

const DOMAIN = 'seeds.test'
const WORD = 'en:word:recommend' // rank 1987 · tags work/restaurant/smalltalk

let seq = 0

function jsonReq(url: string, body: unknown, cookie?: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

function getReq(url: string, cookie?: string): Request {
  return new Request(url, { method: 'GET', headers: cookie ? { cookie } : {} })
}

async function freshUser(goal: string): Promise<{ cookie: string; userId: string }> {
  const email = `vitest-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`
  const res = await register(jsonReq('http://x/api/auth/register', { email, password: 's3cret-pass' }))
  const cookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('kiara_session='))!.split(';')[0]
  await onboardingPATCH(
    new Request('http://x/api/onboarding', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        cefrSelf: 'A2',
        goal,
        interests: [],
        dailyMinutes: 15,
        correctionStyle: 'immediate',
        consentLlm: true,
      }),
    }),
  )
  const user = await db.user.findUnique({ where: { email }, select: { id: true } })
  return { cookie, userId: user!.id }
}

function errorItem(nodeId: string) {
  return {
    nodeId,
    skill: 'writing' as const,
    outcome: 'error' as const,
    confidence: 0.9,
    errorType: 'form',
    produced: 'he recommend it',
    expected: 'he recommends it',
    l1Interference: true,
    hintUsed: false,
  }
}

/** one active session + one confident error turn written through the real writer */
async function errorSession(userId: string, nodeId: string): Promise<string> {
  const s = await db.chatSession.create({
    data: { userId, type: 'roleplay_targeted', status: 'active', startedAt: new Date() },
  })
  await writeTurnEvidence(userId, s.id, `turn-${s.id}`, { ok: true, items: [errorItem(nodeId)], newUnknownWords: [] })
  return s.id
}

async function endViaApi(cookie: string, sessionId: string) {
  const res = await end(jsonReq('http://x/api/session/end', { sessionId }, cookie))
  expect(res.status).toBe(200)
  return (await res.json()) as { seeds: { seedId: string; nodeId: string | null; score: number }[] }
}

async function inbox(cookie: string): Promise<SeedsInboxResponse> {
  const res = await seedsGET(getReq('http://x/api/seeds', cookie))
  expect(res.status).toBe(200)
  return (await res.json()) as SeedsInboxResponse
}

async function proposedSeeds(userId: string, nodeId: string) {
  return db.seed.findMany({ where: { userId, status: 'proposed', candidateNodeId: nodeId } })
}

/** route ctx for dynamic [id] handlers */
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(async () => {
  seq = 0
})

afterAll(async () => {
  // delete our users' user-generated nodes first (GraphNode.ownerId is a soft
  // reference — no FK cascade) so the dev DB stays clean across runs
  const users = await db.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } })
  for (const u of users) {
    await db.graphNode.deleteMany({ where: { isUserGenerated: true, ownerId: u.id } })
  }
  await db.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } })
  await db.$disconnect()
})

describe('guards', () => {
  it('401 without a session cookie (list / approve / reject)', async () => {
    expect((await seedsGET(getReq('http://x/api/seeds'))).status).toBe(401)
    expect((await approve(jsonReq('http://x/api/seeds/xyz/approve', {}))).status).toBe(401)
    expect((await reject(jsonReq('http://x/api/seeds/xyz/reject', {}))).status).toBe(401)
  })

  it('404 for another user’s seed', async () => {
    const a = await freshUser('work')
    const b = await freshUser('work')
    const seed = await db.seed.create({
      data: {
        userId: a.userId,
        triggerType: 'repeated_error',
        triggerRef: JSON.stringify({ nodeId: WORD, errorCount: 2, dedupeKey: `${WORD}::form` }),
        candidateNodeId: WORD,
        score: 0.8,
        scoreBreakdown: JSON.stringify({ goalRelevance: 1, frequency: 0.8, readiness: 1, novelty: 1 }),
        status: 'proposed',
        reasonFa: 'دو خطای مستقل',
        expiresAt: new Date(Date.now() + 14 * 86_400_000),
      },
    })
    expect((await approve(jsonReq(`http://x/api/seeds/${seed.id}/approve`, {}, b.cookie), ctx(seed.id))).status).toBe(404)
    expect((await reject(jsonReq(`http://x/api/seeds/${seed.id}/reject`, {}, b.cookie), ctx(seed.id))).status).toBe(404)
  })
})

describe('docs/05 M7 acceptance', () => {
  it('2 errors across 2 sessions on an unplanted word → proposal with score ≥ 0.45', async () => {
    const { cookie, userId } = await freshUser('work')
    // session 1: one confident error — below the trigger (needs ≥2 sessions)
    const s1 = await errorSession(userId, WORD)
    const r1 = await endViaApi(cookie, s1)
    expect(r1.seeds).toHaveLength(0)

    // session 2: the second independent session → repeated_error fires
    const s2 = await errorSession(userId, WORD)
    const r2 = await endViaApi(cookie, s2)
    expect(r2.seeds).toHaveLength(1)
    expect(r2.seeds[0].nodeId).toBe(WORD)
    expect(r2.seeds[0].score).toBeGreaterThanOrEqual(0.45)

    const box = await inbox(cookie)
    expect(box.proposals).toHaveLength(1)
    const p = box.proposals[0]
    expect(p.title).toBe('recommend')
    expect(p.score).toBeGreaterThanOrEqual(0.45)
    expect(p.breakdown).toEqual({ goalRelevance: 1, frequency: 0.8, readiness: 1, novelty: 1 })
    expect(p.reasonFa).toContain('خطای مستقل')
    expect(p.sample?.expected).toBe('he recommends it')
    expect(box.cap).toEqual({ planted: 0, limit: 3 })
    expect(await proposedSeeds(userId, WORD)).toHaveLength(1)
  })

  it('approve plants the node: states + position + tree shows it; double-approve → 409', async () => {
    const { cookie, userId } = await freshUser('work')
    const s1 = await errorSession(userId, WORD)
    await endViaApi(cookie, s1)
    const s2 = await errorSession(userId, WORD)
    await endViaApi(cookie, s2)

    const box = await inbox(cookie)
    const seedId = box.proposals[0].id
    const res = await approve(jsonReq(`http://x/api/seeds/${seedId}/approve`, {}, cookie), ctx(seedId))
    expect(res.status).toBe(200)
    const body = (await res.json()) as ApproveSeedResult
    expect(body.ok).toBe(true)
    expect(body.held).toBe(false)
    expect(body.plantedNodeId).toBe(WORD)

    // planted-but-unpracticed states for reading + writing. The writing skill
    // already carried error-tracking history from the two sessions (reps ≥ 1)
    // — planting must NEVER overwrite practiced state (§B5 update:{}); the
    // fresh reading skill gets a clean available state.
    const reading = await db.userNodeState.findUnique({
      where: { userId_nodeId_skill: { userId, nodeId: WORD, skill: 'reading' } },
    })
    const writing = await db.userNodeState.findUnique({
      where: { userId_nodeId_skill: { userId, nodeId: WORD, skill: 'writing' } },
    })
    expect(reading?.displayState).toBe('available')
    expect(reading?.fsrsState).toBe('New')
    expect(reading?.reps).toBe(0)
    expect(writing).not.toBeNull()
    expect(writing!.reps).toBeGreaterThanOrEqual(1) // error history preserved

    // the tree shows the node on the user's tree (learning — it has history)
    const treeRes = await treeGET(getReq('http://x/api/tree', cookie))
    const tree = (await treeRes.json()) as { nodes: { id: string; state: string }[] }
    const node = tree.nodes.find((n) => n.id === WORD)
    expect(node?.state).toBe('learning')

    // second approval of the same seed → 409
    expect((await approve(jsonReq(`http://x/api/seeds/${seedId}/approve`, {}, cookie), ctx(seedId))).status).toBe(409)
  })

  it('weekly cap: the 4th approval in the 7-day window is held in queue (not planted)', async () => {
    const { cookie, userId } = await freshUser('work')
    const mk = (nodeId: string) => ({
      userId,
      triggerType: 'repeated_error',
      triggerRef: JSON.stringify({ nodeId, errorCount: 2, dedupeKey: `${nodeId}::form` }),
      candidateNodeId: nodeId,
      score: 0.8,
      scoreBreakdown: JSON.stringify({ goalRelevance: 1, frequency: 0.8, readiness: 1, novelty: 1 }),
      status: 'proposed',
      reasonFa: 'دو خطای مستقل',
      expiresAt: new Date(Date.now() + 14 * 86_400_000),
    })
    const s = []
    for (const id of ['en:word:airport', 'en:word:hotel', 'en:word:flight', WORD]) {
      s.push(await db.seed.create({ data: mk(id) }))
    }

    for (const seeded of s.slice(0, 3)) {
      const res = await approve(jsonReq(`http://x/api/seeds/${seeded.id}/approve`, {}, cookie), ctx(seeded.id))
      expect(res.status).toBe(200)
      const body = (await res.json()) as ApproveSeedResult
      expect(body.held).toBe(false)
    }

    // the 4th approval is HELD: 200, but nothing planted and the seed stays proposed
    const res4 = await approve(jsonReq(`http://x/api/seeds/${s[3].id}/approve`, {}, cookie), ctx(s[3].id))
    expect(res4.status).toBe(200)
    const body4 = (await res4.json()) as ApproveSeedResult
    expect(body4.held).toBe(true)
    expect(body4.cap).toEqual({ planted: 3, limit: 3 })
    expect(await db.userNodeState.count({ where: { userId, nodeId: WORD } })).toBe(0)
    expect((await proposedSeeds(userId, WORD)).length).toBe(1)

    const box = await inbox(cookie)
    expect(box.cap).toEqual({ planted: 3, limit: 3 })
    expect(box.proposals.map((p) => p.id)).toContain(s[3].id)
  })

  it('reject → no re-proposal of the same node for 14 days', async () => {
    const { cookie, userId } = await freshUser('work')
    const s1 = await errorSession(userId, WORD)
    await endViaApi(cookie, s1)
    const s2 = await errorSession(userId, WORD)
    await endViaApi(cookie, s2)

    const box = await inbox(cookie)
    expect(box.proposals).toHaveLength(1)
    const seedId = box.proposals[0].id
    expect((await reject(jsonReq(`http://x/api/seeds/${seedId}/reject`, {}, cookie), ctx(seedId))).status).toBe(200)

    // two MORE sessions repeating the same error — the scan runs again…
    const s3 = await errorSession(userId, WORD)
    await endViaApi(cookie, s3)
    const s4 = await errorSession(userId, WORD)
    const r4 = await endViaApi(cookie, s4)
    // …but the node sits out its 14-day cooldown: no new proposal
    expect(r4.seeds.filter((x) => x.nodeId === WORD)).toHaveLength(0)
    expect(await proposedSeeds(userId, WORD)).toHaveLength(0)
    expect(await db.seed.count({ where: { userId, candidateNodeId: WORD, status: 'rejected' } })).toBe(1)
  })

  it('track_pattern approval creates a user-generated node linked to its source', async () => {
    const { cookie, userId } = await freshUser('work')
    const seed = await db.seed.create({
      data: {
        userId,
        triggerType: 'repeated_error',
        triggerRef: JSON.stringify({
          nodeId: WORD,
          errorCount: 3,
          sessionIds: ['s1', 's2', 's3'],
          sampleProduced: 'he recommend it',
          sampleExpected: 'he recommends it',
          dedupeKey: `${WORD}::form`,
        }),
        candidateNodeId: null,
        candidatePayload: JSON.stringify({ type: 'error_pattern', title: 'recommend — recurring error (form)', cefr: 'A2' }),
        score: 0.72,
        scoreBreakdown: JSON.stringify({ goalRelevance: 0.9, frequency: 0.8, readiness: 1, novelty: 1 }),
        status: 'proposed',
        reasonFa: 'سه خطای مستقل + مربوط به هدف شما',
        expiresAt: new Date(Date.now() + 14 * 86_400_000),
      },
    })

    const res = await approve(jsonReq(`http://x/api/seeds/${seed.id}/approve`, {}, cookie), ctx(seed.id))
    expect(res.status).toBe(200)
    const body = (await res.json()) as ApproveSeedResult
    expect(body.held).toBe(false)
    const nodeId = body.plantedNodeId!
    expect(nodeId).toMatch(/^en:err:u-/)

    const created = await db.graphNode.findUnique({ where: { id: nodeId } })
    expect(created?.isUserGenerated).toBe(true)
    expect(created?.ownerId).toBe(userId)
    expect(created?.type).toBe('error_pattern')

    // prerequisite edge source → pattern (lands under the word in the tree)
    const edge = await db.graphEdge.findFirst({ where: { fromId: WORD, toId: nodeId, type: 'prerequisite' } })
    expect(edge).not.toBeNull()

    const treeRes = await treeGET(getReq('http://x/api/tree', cookie))
    const tree = (await treeRes.json()) as { nodes: { id: string; state: string; userGenerated: boolean; title: string }[] }
    const node = tree.nodes.find((n) => n.id === nodeId)
    expect(node?.state).toBe('available')
    expect(node?.userGenerated).toBe(true)
  })
})
