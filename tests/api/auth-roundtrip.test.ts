/**
 * M2 acceptance — auth round-trip + onboarding persistence + 401 guards
 * (docs/05: register → login → me → logout via API; consent timestamp;
 * unauthenticated routes 401).
 *
 * Route handlers are plain Request/Response functions (no next/headers), so
 * they're called directly — DB is the real dev SQLite.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { POST as register } from '@/app/api/auth/register/route'
import { POST as login } from '@/app/api/auth/login/route'
import { POST as logout } from '@/app/api/auth/logout/route'
import { GET as me } from '@/app/api/auth/me/route'
import { GET as onboardingGET, PATCH as onboardingPATCH } from '@/app/api/onboarding/route'

const prisma = new PrismaClient()
const DOMAIN = 'kiara.test'
const created: string[] = []

function jsonReq(url: string, body: unknown, cookie?: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

function cookieOf(res: Response): string {
  const setCookie = res.headers.getSetCookie?.() ?? []
  const session = setCookie.find((c) => c.startsWith('kiara_session='))
  expect(session, 'expected a kiara_session cookie').toBeTruthy()
  const pair = (session as string).split(';')[0]
  expect(pair).toMatch(/^kiara_session=[A-Za-z0-9_-]+$/)
  expect(session as string).toContain('HttpOnly')
  return pair
}

function patchReq(url: string, body: unknown, cookie: string): Request {
  return new Request(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

const newEmail = () => `vitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`

afterAll(async () => {
  // cascade deletes sessions
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } })
  await prisma.$disconnect()
})

describe('auth round-trip (register → me → logout → login → me)', () => {
  it('register creates user + session cookie', async () => {
    const email = newEmail()
    created.push(email)
    const res = await register(jsonReq('http://x/api/auth/register', { email, password: 's3cret-pass' }))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { ok: boolean; user: { email: string; passwordHash?: string } }
    expect(body.ok).toBe(true)
    expect(body.user.email).toBe(email.toLowerCase())
    expect((body.user as { passwordHash?: string }).passwordHash).toBeUndefined()
    cookieOf(res) // shape asserted inside
  })

  it('me returns the profile with the cookie and 401 without it', async () => {
    const email = newEmail()
    created.push(email)
    const regRes = await register(jsonReq('http://x/api/auth/register', { email, password: 's3cret-pass' }))
    const cookie = cookieOf(regRes)

    const meRes = await me(new Request('http://x/api/auth/me', { headers: { cookie } }))
    expect(meRes.status).toBe(200)
    const body = (await meRes.json()) as { user: { email: string; onboardingComplete: boolean } }
    expect(body.user.email).toBe(email.toLowerCase())
    expect(body.user.onboardingComplete).toBe(false) // nothing filled yet

    const anon = await me(new Request('http://x/api/auth/me'))
    expect(anon.status).toBe(401)
  })

  it('logout revokes the session; old cookie stops working', async () => {
    const email = newEmail()
    created.push(email)
    const regRes = await register(jsonReq('http://x/api/auth/register', { email, password: 's3cret-pass' }))
    const cookie = cookieOf(regRes)

    const outRes = await logout(new Request('http://x/api/auth/logout', { method: 'POST', headers: { cookie } }))
    expect(outRes.status).toBe(200)

    const meRes = await me(new Request('http://x/api/auth/me', { headers: { cookie } }))
    expect(meRes.status).toBe(401)
  })

  it('login works with correct credentials and rejects wrong ones; duplicate register 409', async () => {
    const email = newEmail()
    created.push(email)
    await register(jsonReq('http://x/api/auth/register', { email, password: 's3cret-pass', displayName: 'تستی' }))

    const loginRes = await login(jsonReq('http://x/api/auth/login', { email, password: 's3cret-pass' }))
    expect(loginRes.status).toBe(200)
    const cookie = cookieOf(loginRes)
    const meRes = await me(new Request('http://x/api/auth/me', { headers: { cookie } }))
    expect(meRes.status).toBe(200)

    const badRes = await login(jsonReq('http://x/api/auth/login', { email, password: 'wrong-pass-99' }))
    expect(badRes.status).toBe(401)

    const dupRes = await register(jsonReq('http://x/api/auth/register', { email, password: 'another-pass' }))
    expect(dupRes.status).toBe(409)
  })

  it('invalid payloads → 400 (short password, bad email, bad JSON)', async () => {
    const short = await register(jsonReq('http://x/api/auth/register', { email: newEmail(), password: 'short' }))
    expect(short.status).toBe(400)

    const badEmail = await register(jsonReq('http://x/api/auth/register', { email: 'not-an-email', password: 's3cret-pass' }))
    expect(badEmail.status).toBe(400)

    const raw = new Request('http://x/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json at all',
    })
    expect((await register(raw)).status).toBe(400)
  })
})

describe('onboarding (M2 acceptance: persist + consent timestamp + guards)', () => {
  const VALID = {
    cefrSelf: 'A2',
    goal: 'travel',
    interests: ['travel', 'food'],
    dailyMinutes: 20,
    correctionStyle: 'immediate',
    consentLlm: true,
    displayName: 'سارا',
  } as const

  it('PATCH persists all profile fields and stores consent timestamp', async () => {
    const email = newEmail()
    created.push(email)
    const cookie = cookieOf(
      await register(jsonReq('http://x/api/auth/register', { email, password: 's3cret-pass' })),
    )

    const before = Date.now()
    const res = await onboardingPATCH(patchReq('http://x/api/onboarding', VALID, cookie))
    expect(res.status).toBe(200)

    const body = (await res.json()) as { user: { cefrSelf: string; goal: string; interests: string[]; dailyMinutes: number; correctionStyle: string; consentLlmAt: string | null; onboardingComplete: boolean } }
    expect(body.user.cefrSelf).toBe('A2')
    expect(body.user.goal).toBe('travel')
    expect(body.user.interests).toEqual(['travel', 'food'])
    expect(body.user.dailyMinutes).toBe(20)
    expect(body.user.correctionStyle).toBe('immediate')
    expect(body.user.onboardingComplete).toBe(true)

    const consentAt = new Date(body.user.consentLlmAt as string).getTime()
    expect(consentAt).toBeGreaterThanOrEqual(before - 1000)
    expect(consentAt).toBeLessThanOrEqual(Date.now() + 1000)

    // persisted in DB with the raw JSON string form
    const row = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    expect(row?.interests).toBe(JSON.stringify(['travel', 'food']))
    expect(row?.consentLlmAt).toBeInstanceOf(Date)
  })

  it('GET prefills the profile for the wizard (authenticated)', async () => {
    const email = newEmail()
    created.push(email)
    const cookie = cookieOf(
      await register(jsonReq('http://x/api/auth/register', { email, password: 's3cret-pass' })),
    )
    await onboardingPATCH(patchReq('http://x/api/onboarding', VALID, cookie))

    const res = await onboardingGET(new Request('http://x/api/onboarding', { headers: { cookie } }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { cefrSelf: string; dailyMinutes: number } }
    expect(body.user.cefrSelf).toBe('A2')
    expect(body.user.dailyMinutes).toBe(20)
  })

  it('withdrawing consent stores a null timestamp', async () => {
    const email = newEmail()
    created.push(email)
    const cookie = cookieOf(
      await register(jsonReq('http://x/api/auth/register', { email, password: 's3cret-pass' })),
    )
    await onboardingPATCH(patchReq('http://x/api/onboarding', VALID, cookie))
    const res = await onboardingPATCH(
      patchReq('http://x/api/onboarding', { ...VALID, consentLlm: false }, cookie),
    )
    const body = (await res.json()) as { user: { consentLlmAt: string | null; onboardingComplete: boolean } }
    expect(body.user.consentLlmAt).toBeNull()
    expect(body.user.onboardingComplete).toBe(false)
  })

  it('invalid onboarding payload → 400; unauthenticated GET/PATCH → 401', async () => {
    const email = newEmail()
    created.push(email)
    const cookie = cookieOf(
      await register(jsonReq('http://x/api/auth/register', { email, password: 's3cret-pass' })),
    )

    const bad = await onboardingPATCH(
      patchReq('http://x/api/onboarding', { ...VALID, goal: 'become-rich' }, cookie),
    )
    expect(bad.status).toBe(400)

    const anonGet = await onboardingGET(new Request('http://x/api/onboarding'))
    expect(anonGet.status).toBe(401)

    const anonPatch = await onboardingPATCH(
      patchReq('http://x/api/onboarding', VALID, 'kiara_session=nope'),
    )
    expect(anonPatch.status).toBe(401)
  })
})
