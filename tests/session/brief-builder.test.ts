/**
 * M3 acceptance — brief builder wired to real state (docs/05 M3):
 * "brief builder unit test: contains weak/frontier/error-pattern sections,
 * bounded size (≤1.5k tokens)".
 * Uses the real dev SQLite: user + states + error evidence seeded inline.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { buildBriefBundle, boundToBudget, getKnownLemmas } from '@/lib/session/brief-builder'
import { estimateBriefTokens } from '@/lib/engine/brief'
import { loadGraph } from '@/lib/graph/load'
import type { SessionBrief } from '@/lib/engine/types'

const prisma = new PrismaClient()
const DOMAIN = 'brief-builder.test'
const now = new Date('2026-10-30T12:00:00Z')
let userId = ''

async function makeUser(): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`,
      passwordHash: 'x',
      cefrSelf: 'A2',
      goal: 'travel',
      interests: JSON.stringify(['food', 'travel']),
      correctionStyle: 'immediate',
      consentLlmAt: now,
    },
  })
  return u.id
}

async function addState(userId: string, nodeId: string, opts: Partial<{ strength: number; lapses: number; displayState: string }>) {
  await prisma.userNodeState.create({
    data: {
      userId,
      nodeId,
      skill: 'writing',
      strength: opts.strength ?? 0.5,
      lapses: opts.lapses ?? 0,
      displayState: opts.displayState ?? 'learning',
    },
  })
}

async function addSessionWithError(userId: string, errorTypes: string[]) {
  const session = await prisma.chatSession.create({
    data: { userId, type: 'roleplay_targeted', status: 'ended', startedAt: new Date(now.getTime() - 86400_000) },
  })
  for (const errorType of errorTypes) {
    await prisma.evidence.create({
      data: {
        userId,
        sessionId: session.id,
        turnId: 't_test',
        nodeId: 'en:word:time',
        skill: 'writing',
        outcome: 'error',
        errorType,
        confidence: 0.9,
        createdAt: new Date(now.getTime() - 3600_000),
      },
    })
  }
}

beforeAll(async () => {
  userId = await makeUser()
  // known lexicon: 3×A1 + 2×A2 + 1×B1 word states (ids verified against the DB)
  await addState(userId, 'en:word:time', {}) // A1
  await addState(userId, 'en:word:food', {}) // A1
  await addState(userId, 'en:word:night', {}) // A1
  await addState(userId, 'en:word:travel', {}) // A2
  await addState(userId, 'en:word:reserve', {}) // A2
  await addState(userId, 'en:word:afford', {}) // B1
  // one clearly weak node (low strength + lapses)
  await addState(userId, 'en:word:price', { strength: 0.05, lapses: 5 })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } })
  await prisma.$disconnect()
})

describe('brief builder (DB wiring)', () => {
  it('builds a brief with weak / frontier / error-pattern sections from real rows', async () => {
    await addSessionWithError(userId, ['form', 'form', 'word_choice'])

    const bundle = await buildBriefBundle({ id: userId, cefrComputed: null, cefrSelf: 'A2', goal: 'travel', interests: JSON.stringify(['food']), correctionStyle: 'immediate' }, now)

    // lexicon bands count the seeded word states
    expect(bundle.brief.knownLexicon.A1).toBeGreaterThanOrEqual(3)
    expect(bundle.brief.knownLexicon.A2).toBeGreaterThanOrEqual(2)
    expect(bundle.brief.knownLexicon.B1).toBeGreaterThanOrEqual(1)
    expect(bundle.brief.knownLexicon.sampleLemmas.length).toBeGreaterThan(0)
    expect(bundle.knownLemmas).toContain('time')

    // weak section contains the deliberately weak node
    expect(bundle.brief.weakNodes.length).toBeGreaterThan(0)
    expect(bundle.brief.weakNodes.some((w) => w.id === 'en:word:price')).toBe(true)

    // frontier section exists with real graph nodes
    expect(bundle.brief.frontierNodes.length).toBeGreaterThan(0)
    for (const f of bundle.brief.frontierNodes) expect(f.glossFa).toBeTruthy()

    // error patterns grouped from evidence: form×2 > word_choice×1
    expect(bundle.brief.activeErrorPatterns.length).toBe(2)
    expect(bundle.brief.activeErrorPatterns[0].desc).toContain('خطای صیغه‌ای')
    expect(bundle.brief.activeErrorPatterns[0].desc).toContain('۲ بار')

    // user section carried over
    expect(bundle.brief.user.level).toBe('A2')
    expect(bundle.brief.user.goal).toBe('travel')
    expect(bundle.brief.user.correctionStyle).toBe('immediate')
  })

  it('scenario pick is goal-filtered and mustElicit is whitelist-resolved', async () => {
    const bundle = await buildBriefBundle({ id: userId, cefrComputed: null, cefrSelf: 'A2', goal: 'travel', interests: '[]', correctionStyle: 'immediate' }, now)
    const graph = loadGraph('en')
    expect(bundle.scenario.title).toBeTruthy()
    expect(bundle.scenario.mustElicit.length).toBeGreaterThan(0)
    for (const m of bundle.scenario.mustElicit) {
      expect(graph.byId.has(m.id)).toBe(true)
    }
    // travel goal → one of the travel scenarios
    expect(['hotel-checkin', 'lost-luggage', 'asking-directions', 'restaurant-reservation', 'gift-shopping', 'pharmacy', 'doctor-visit']).toContain(bundle.scenario.id)
  })

  it('is bounded: tokenEstimate ≤ 1500 (docs/03 §C)', async () => {
    const bundle = await buildBriefBundle({ id: userId, cefrComputed: null, cefrSelf: 'A2', goal: 'travel', interests: '[]', correctionStyle: 'immediate' }, now)
    expect(bundle.tokenEstimate).toBeLessThanOrEqual(1500)
  })

  it('boundToBudget trims an oversized brief down to the budget', () => {
    const fat: SessionBrief = {
      user: { level: 'A2', goal: 'travel', interests: Array.from({ length: 12 }, (_, i) => `interest-number-${i}`), correctionStyle: 'immediate', tone: 'warm' },
      knownLexicon: { A1: 900, A2: 400, B1: 100, sampleLemmas: Array.from({ length: 60 }, (_, i) => `lemma${i}`) },
      weakNodes: Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, title: `weak node number ${i}`, glossFa: 'توضیح فارسی طولانی', why: 'چندین لغزش اخیر' })),
      frontierNodes: Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, title: `frontier-node-${i}`, glossFa: 'معنی فارسی' })),
      activeErrorPatterns: Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, desc: `خطای شماره ${i} با توضیح طولانی` })),
      scenario: { title: 'سناریو', role: 'role with a fairly long description here', mustElicit: [] },
    }
    // sanity: the fixture really is over budget
    expect(estimateBriefTokens(fat)).toBeGreaterThan(1500)
    const bundle = boundToBudget({ brief: fat, scenario: { id: 'x', title: 'سناریو', role: 'r', mustElicit: [] }, knownLemmas: [], tokenEstimate: 1e9 })
    expect(bundle.tokenEstimate).toBeLessThanOrEqual(1500)
    expect(bundle.brief.weakNodes.length).toBeLessThan(30)
  })

  it('getKnownLemmas returns exactly the non-locked word titles', async () => {
    const lemmas = await getKnownLemmas(userId)
    expect(lemmas).toContain('time')
    expect(lemmas).toContain('price')
    expect(lemmas).not.toContain('luggage') // never stated
  })
})
