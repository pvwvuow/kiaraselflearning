/**
 * M6 acceptance (docs/05) — through the REAL API routes + SQLite:
 *  1. layout stability: two GETs with unchanged state → IDENTICAL positions
 *  2. a planted (user-generated) node appears at the next visit at a STABLE
 *     position and never moves existing nodes (docs/03 §B5)
 *  3. node payload carries per-skill mini-state (listening/speaking null →
 *     "—") and fading is recomputed on read (docs/03 §A5)
 *  4. pin/hide persist; unknown node → 404; guards (401) enforced.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { GET as treeGET } from '@/app/api/tree/route'
import { PATCH as treePATCH } from '@/app/api/tree/[nodeId]/route'

const prisma = new PrismaClient()
const DOMAIN = 'tree.test'
const EMAIL = `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`
const SEED_NODE = 'en:word:kiara-test-seed'
const PREREQ = 'en:grammar:present-simple'

let cookie = ''
let userId = ''

function req(url: string, init: RequestInit = {}): Request {
  return new Request(url, { ...init, headers: { cookie, ...(init.headers ?? {}) } })
}

function ctx(nodeId: string): { params: Promise<{ nodeId: string }> } {
  return { params: Promise.resolve({ nodeId }) }
}

interface NodeView {
  id: string
  state: string
  x: number
  y: number
  tier: number
  pinned: boolean
  hidden: boolean
  why: string
  skills: Record<string, { state: string; strength: number; reps: number } | null>
}
interface TreeBody {
  ok: boolean
  nodes: NodeView[]
  edges: { from: string; to: string }[]
  stats: { total: number; hidden: number; byState: Record<string, number> }
}

async function getTree(): Promise<TreeBody> {
  const res = await treeGET(req('http://x/api/tree'))
  expect(res.status).toBe(200)
  return (await res.json()) as TreeBody
}

const posOf = (t: TreeBody, id: string) => {
  const n = t.nodes.find((x) => x.id === id)
  expect(n, `node ${id} in payload`).toBeTruthy()
  return { x: n!.x, y: n!.y, tier: n!.tier }
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: EMAIL, passwordHash: 'x', goal: 'travel', consentLlmAt: new Date() },
  })
  userId = user.id
  const token = randomBytes(32).toString('base64url')
  await prisma.userSession.create({
    data: { userId, token, expiresAt: new Date(Date.now() + 86_400_000) },
  })
  cookie = `kiara_session=${token}`
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } })
  await prisma.graphNode.deleteMany({ where: { id: SEED_NODE } }) // test-created node + cascade edges
  await prisma.$disconnect()
})

describe('GET /api/tree — layout stability (M6 acceptance #1)', () => {
  it('401 without a session cookie', async () => {
    const res = await treeGET(new Request('http://x/api/tree'))
    expect(res.status).toBe(401)
    const res2 = await treePATCH(
      new Request('http://x/api/tree/en:word:flight', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pinned: true }),
      }),
      ctx('en:word:flight'),
    )
    expect(res2.status).toBe(401)
  })

  it('first GET lays out and persists; second GET returns IDENTICAL positions', async () => {
    const t1 = await getTree()
    expect(t1.ok).toBe(true)
    expect(t1.nodes.length).toBeGreaterThanOrEqual(250)
    expect(t1.edges.length).toBeGreaterThan(0)

    // positions were persisted for the user
    const stored = await prisma.nodePosition.findMany({ where: { userId } })
    expect(stored.length).toBe(t1.nodes.length)

    const t2 = await getTree()
    expect(t2.nodes.length).toBe(t1.nodes.length)
    for (const n of t1.nodes) {
      const a = posOf(t1, n.id)
      const b = posOf(t2, n.id)
      expect(b, `stable position for ${n.id}`).toEqual(a)
    }
    // prerequisite edges drive the skeleton
    expect(t1.edges.every((e) => e.from && e.to)).toBe(true)
    // availability wiring: a fresh user must see frontier (available) nodes —
    // stateless words with no prereqs are NEVER all "locked" (docs/03 §A5)
    expect((t1.stats.byState['available'] ?? 0)).toBeGreaterThan(50)
    expect((t1.stats.byState['locked'] ?? 0)).toBeGreaterThan(0)
  })

  it('node payload carries per-skill mini-state; listening/speaking are null ("—")', async () => {
    // learning node (healthy schedule) — fsrsState matches a real first review
    await prisma.userNodeState.create({
      data: {
        userId,
        nodeId: PREREQ,
        skill: 'writing',
        stability: 5,
        difficulty: 5,
        lastReviewAt: new Date(Date.now() - 86_400_000),
        due: new Date(Date.now() + 2 * 86_400_000),
        reps: 1,
        fsrsState: 'Learning',
        displayState: 'learning',
        strength: 0.6,
      },
    })
    // fading node (overdue past the fast channel, docs/03 §A5)
    const fadingNode = 'en:word:flight'
    await prisma.userNodeState.create({
      data: {
        userId,
        nodeId: fadingNode,
        skill: 'reading',
        stability: 10,
        difficulty: 5,
        lastReviewAt: new Date(Date.now() - 40 * 86_400_000),
        due: new Date(Date.now() - 30 * 86_400_000),
        reps: 3,
        fsrsState: 'Review',
        displayState: 'learning',
        strength: 0.4,
      },
    })

    const t = await getTree()
    const learning = t.nodes.find((n) => n.id === PREREQ)!
    expect(learning.state).toBe('learning')
    expect(learning.skills.writing).toBeTruthy()
    expect(learning.skills.listening).toBeNull() // rendered as "—"
    expect(learning.skills.speaking).toBeNull()

    const fading = t.nodes.find((n) => n.id === fadingNode)!
    expect(fading.state).toBe('fading') // recomputed ON READ → dashed ring cue in UI
    expect(fading.why).toContain('فراموشی')
    expect(t.stats.byState['fading']).toBeGreaterThanOrEqual(1)
  })

  it('locked node "why" names its blocking prerequisites', async () => {
    const t = await getTree()
    const locked = t.nodes.find((n) => n.state === 'locked')
    expect(locked).toBeTruthy()
    expect(locked!.why).toContain('قفل')
  })
})

describe('planted seed lands at a STABLE position (M6 acceptance #2, docs/03 §B5)', () => {
  it('user-generated node appears on next visit; old nodes never move', async () => {
    const t1 = await getTree()
    const before = new Map(t1.nodes.map((n) => [n.id, { x: n.x, y: n.y, tier: n.tier }]))

    // the growth engine (M7) will do exactly this: node + prerequisite edge
    await prisma.graphNode.create({
      data: {
        id: SEED_NODE,
        type: 'word',
        lang: 'en',
        cefr: 'A2',
        title: 'seedling',
        glossFa: 'نهال (گره‌ی آزمایشی)',
        isUserGenerated: true,
        ownerId: userId,
      },
    })
    await prisma.graphEdge.create({
      data: { fromId: PREREQ, toId: SEED_NODE, type: 'prerequisite', weight: 1 },
    })

    const t2 = await getTree()
    expect(t2.nodes.length).toBe(t1.nodes.length + 1)
    for (const [id, p] of before) {
      expect(posOf(t2, id), `unchanged position for ${id}`).toEqual(p)
    }
    const seed = posOf(t2, SEED_NODE)
    const prereq = posOf(t2, PREREQ)
    expect(seed.tier).toBe(prereq.tier + 1) // 1 + max(prereq tiers)
    // and it does not move afterwards
    const t3 = await getTree()
    expect(posOf(t3, SEED_NODE)).toEqual(seed)
    expect(t3.nodes.length).toBe(t2.nodes.length)
  })
})

describe('PATCH /api/tree/:nodeId — pin / hide', () => {
  it('pins a node, persists across GETs; hide flags the node in stats', async () => {
    const res = await treePATCH(
      req('http://x/api/tree/en:word:flight', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pinned: true }),
      }),
      ctx('en:word:flight'),
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { pinned: boolean }).pinned).toBe(true)

    let t = await getTree()
    expect(t.nodes.find((n) => n.id === 'en:word:flight')!.pinned).toBe(true)

    const res2 = await treePATCH(
      req('http://x/api/tree/en:word:flight', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hidden: true, pinned: false }),
      }),
      ctx('en:word:flight'),
    )
    expect(res2.status).toBe(200)
    t = await getTree()
    const hidden = t.nodes.find((n) => n.id === 'en:word:flight')!
    expect(hidden.hidden).toBe(true)
    expect(hidden.pinned).toBe(false)
    expect(t.stats.hidden).toBeGreaterThanOrEqual(1)
    // row really persisted with the position untouched
    const row = await prisma.nodePosition.findUnique({
      where: { userId_nodeId: { userId, nodeId: 'en:word:flight' } },
    })
    expect(row?.hidden).toBe(true)
  })

  it('400 on invalid body / empty patch · 404 on unknown node', async () => {
    const empty = await treePATCH(
      req('http://x/api/tree/en:word:flight', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      ctx('en:word:flight'),
    )
    expect(empty.status).toBe(400)

    const bad = await treePATCH(
      req('http://x/api/tree/en:word:flight', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
      ctx('en:word:flight'),
    )
    expect(bad.status).toBe(400)

    const nf = await treePATCH(
      req('http://x/api/tree/en:word:does-not-exist', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pinned: true }),
      }),
      ctx('en:word:does-not-exist'),
    )
    expect(nf.status).toBe(404)
  })
})
