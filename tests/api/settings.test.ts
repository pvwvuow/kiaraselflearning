/**
 * M9 — settings API (docs/05 M9 acceptance):
 *  - PATCH  /api/settings: partial profile update (correction style, level…),
 *           401 when unauthenticated, 400 on invalid payload
 *  - GET    /api/settings/export: one JSON with ALL user data sections
 *  - DELETE /api/settings: the User row is removed and every user-owned table
 *           cascades — the acceptance criterion is ZERO remaining rows.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'

// the settings tests only need the ROUTE plumbing — no real LLM (a session
// start with the real grok-4.7 opener would blow the 5s vitest timeout)
vi.mock('@/lib/llm/xai', () => ({
  xaiChat: vi.fn(async (opts: { role: string }) => {
    if (opts.role === 'analyst') {
      return { ok: true, content: 'summary text', model: 'grok-test', latencyMs: 1, promptTokens: 1, completionTokens: 1 }
    }
    return { ok: true, content: 'Great — tell me more!', model: 'grok-4.7', latencyMs: 3, promptTokens: 10, completionTokens: 5 }
  }),
}))

vi.mock('@/lib/llm/analyst', () => ({
  analyzeTurn: vi.fn(async () => ({ ok: true, items: [], newUnknownWords: [], attempts: 1 })),
}))

import { PATCH as settingsPATCH, DELETE as settingsDELETE } from '@/app/api/settings/route'
import { GET as settingsExport } from '@/app/api/settings/export/route'
import { POST as register } from '@/app/api/auth/register/route'
import { PATCH as onboardingPATCH } from '@/app/api/onboarding/route'
import { POST as start } from '@/app/api/session/start/route'
import { loadGraph } from '@/lib/graph/load'
import { db } from '@/lib/db'

const DOMAIN = 'settings.test'

function jsonReq(url: string, method: string, body?: unknown, cookie?: string): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

let seq = 0

async function freshUser(): Promise<{ cookie: string; userId: string; email: string }> {
  const email = `vitest-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`
  const res = await register(jsonReq('http://x/api/auth/register', 'POST', { email, password: 's3cret-pass' }))
  const cookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('kiara_session='))!.split(';')[0]
  await onboardingPATCH(jsonReq('http://x/api/onboarding', 'PATCH', {
    cefrSelf: 'A2',
    goal: 'travel',
    interests: [],
    dailyMinutes: 15,
    correctionStyle: 'immediate',
    consentLlm: true,
  }, cookie))
  const user = (await db.user.findUnique({ where: { email }, select: { id: true } }))!
  return { cookie, userId: user.id, email }
}

afterAll(async () => {
  // remove any survivors by email prefix (deleted users cascade anyway)
  await db.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } })
  await db.$disconnect()
})

describe('PATCH /api/settings — partial profile update', () => {
  it('401 without a session cookie', async () => {
    const res = await settingsPATCH(jsonReq('http://x/api/settings', 'PATCH', { dailyMinutes: 30 }))
    expect(res.status).toBe(401)
  })

  it('400 on an invalid payload', async () => {
    const { cookie } = await freshUser()
    const res = await settingsPATCH(jsonReq('http://x/api/settings', 'PATCH', { dailyMinutes: 9999 }, cookie))
    expect(res.status).toBe(400)
  })

  it('updates only the provided keys and returns the public user', async () => {
    const { cookie, userId } = await freshUser()
    const res = await settingsPATCH(
      jsonReq('http://x/api/settings', 'PATCH', { dailyMinutes: 30, correctionStyle: 'end_of_session' }, cookie),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; user: { dailyMinutes: number; correctionStyle: string; goal: string } }
    expect(body.ok).toBe(true)
    expect(body.user.dailyMinutes).toBe(30)
    expect(body.user.correctionStyle).toBe('end_of_session')
    // untouched keys keep their values
    expect(body.user.goal).toBe('travel')
    const row = await db.user.findUnique({ where: { id: userId } })
    expect(row?.dailyMinutes).toBe(30)
  })
})

describe('GET /api/settings/export — full user data as JSON', () => {
  it('401 without a session cookie', async () => {
    const res = await settingsExport(new Request('http://x/api/settings/export'))
    expect(res.status).toBe(401)
  })

  it('returns every user-data section (sessions + turns + evidence + states + metrics)', async () => {
    const { cookie, userId } = await freshUser()
    // one real session so the export has content
    const started = await start(jsonReq('http://x/api/session/start', 'POST', {}, cookie))
    expect(started.status).toBe(200)

    const res = await settingsExport(new Request('http://x/api/settings/export', { headers: { cookie } }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')

    const data = (await res.json()) as {
      app: string
      user: { id: string; email: string }
      chatSessions: { turns: unknown[]; evidence: unknown[] }[]
      nodeStates: unknown[]
      seeds: unknown[]
      treePositions: unknown[]
      metricEvents: { name: string }[]
    }
    expect(data.app).toBe('kiara')
    expect(data.user.id).toBe(userId)
    expect(data.chatSessions.length).toBeGreaterThan(0)
    expect(data.chatSessions[0].turns.length).toBeGreaterThan(0) // tutor opener
    expect(data.metricEvents.some((m) => m.name === 'session_start')).toBe(true)
    expect(Array.isArray(data.nodeStates)).toBe(true)
    expect(Array.isArray(data.seeds)).toBe(true)
    expect(Array.isArray(data.treePositions)).toBe(true)
  })
})

describe('DELETE /api/settings — cascade to zero rows', () => {
  it('401 without a session cookie', async () => {
    const res = await settingsDELETE(new Request('http://x/api/settings', { method: 'DELETE' }))
    expect(res.status).toBe(401)
  })

  it('removes the user and ALL user-owned rows (verify zero rows per table)', async () => {
    const { cookie, userId, email } = await freshUser()
    // give the user rows in every user-owned table: a real session (turns,
    // metrics) + direct state/position rows (a fresh user without placement
    // lights nothing — data-honest — so seed them at the DB level)
    await start(jsonReq('http://x/api/session/start', 'POST', {}, cookie))
    const nodeId = loadGraph().nodes[0].id
    await db.userNodeState.create({
      data: { userId, nodeId, skill: 'reading', displayState: 'available' },
    })
    await db.nodePosition.create({
      data: { userId, nodeId, x: 0, y: 0, tier: 0 },
    })
    expect(await db.userNodeState.count({ where: { userId } })).toBeGreaterThan(0)
    expect(await db.metricEvent.count({ where: { userId } })).toBeGreaterThan(0)
    expect(await db.nodePosition.count({ where: { userId } })).toBeGreaterThan(0)

    const res = await settingsDELETE(new Request('http://x/api/settings', { method: 'DELETE', headers: { cookie } }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; deleted: boolean }
    expect(body).toEqual({ ok: true, deleted: true })

    // THE acceptance criterion: zero rows everywhere
    expect(await db.user.findUnique({ where: { id: userId } })).toBeNull()
    expect(await db.user.count({ where: { email } })).toBe(0)
    expect(await db.chatSession.count({ where: { userId } })).toBe(0)
    expect(await db.turn.count({ where: { session: { userId } } })).toBe(0)
    expect(await db.evidence.count({ where: { userId } })).toBe(0)
    expect(await db.userNodeState.count({ where: { userId } })).toBe(0)
    expect(await db.seed.count({ where: { userId } })).toBe(0)
    expect(await db.nodePosition.count({ where: { userId } })).toBe(0)
    expect(await db.metricEvent.count({ where: { userId } })).toBe(0)
    expect(await db.userSession.count({ where: { userId } })).toBe(0)

    // the cleared cookie no longer authenticates
    const me = await settingsExport(new Request('http://x/api/settings/export', { headers: { cookie } }))
    expect(me.status).toBe(401)
  })
})
