/**
 * Cookie-token sessions backed by the UserSession table (docs/02).
 *
 * Deliberately framework-free: handlers take the standard `Request` and read
 * the Cookie header directly — no `next/headers` — so every auth route is
 * unit-testable by calling it with a plain Request (docs/05 M2 round-trip test).
 *
 * Security properties:
 * - token = 32 random bytes (base64url) — only the hash-less token lives in
 *   the DB; the cookie is httpOnly (JS can never read it), SameSite=Lax,
 *   Secure in production.
 * - expiry enforced server-side (expired tokens are rejected and revoked).
 */
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import type { User } from '@prisma/client'

export const SESSION_COOKIE = 'kiara_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function createSessionCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ]
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get('cookie') ?? ''
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

export function sessionTokenFromRequest(req: Request): string | null {
  return parseCookies(req)[SESSION_COOKIE] ?? null
}

export interface CreatedSession {
  token: string
  expiresAt: Date
}

export async function createSession(userId: string): Promise<CreatedSession> {
  const token = newSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.userSession.create({ data: { userId, token, expiresAt } })
  return { token, expiresAt }
}

export async function getUserByToken(token: string | null): Promise<User | null> {
  if (!token) return null
  const session = await db.userSession.findUnique({ where: { token }, include: { user: true } })
  if (!session) return null
  if (session.expiresAt.getTime() <= Date.now()) {
    // expired: revoke lazily and reject
    await db.userSession.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }
  return session.user
}

export async function getUserFromRequest(req: Request): Promise<User | null> {
  return getUserByToken(sessionTokenFromRequest(req))
}

export async function revokeSession(token: string | null): Promise<void> {
  if (!token) return
  await db.userSession.deleteMany({ where: { token } })
}

/** 401 helper — the single shape every guarded route returns. */
export function unauthorized(): Response {
  return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
}

/**
 * Guard for user-scoped routes (chat/tree/evidence/onboarding…).
 * Usage:
 *   const auth = await requireUser(req)
 *   if ('response' in auth) return auth.response
 */
export async function requireUser(
  req: Request,
): Promise<{ user: User } | { response: Response }> {
  const user = await getUserFromRequest(req)
  if (!user) return { response: unauthorized() }
  return { user }
}

// ── public user shape (never leaks passwordHash) ──

export interface PublicUser {
  id: string
  email: string
  displayName: string | null
  l1: string
  targetLang: string
  cefrSelf: string | null
  cefrComputed: string | null
  goal: string
  interests: string[]
  dailyMinutes: number
  correctionStyle: string
  consentLlmAt: string | null
  onboardingComplete: boolean
}

export function toPublicUser(u: User): PublicUser {
  let interests: string[] = []
  try {
    const parsed: unknown = JSON.parse(u.interests)
    if (Array.isArray(parsed)) interests = parsed.map(String)
  } catch {
    interests = []
  }
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    l1: u.l1,
    targetLang: u.targetLang,
    cefrSelf: u.cefrSelf,
    cefrComputed: u.cefrComputed,
    goal: u.goal,
    interests,
    dailyMinutes: u.dailyMinutes,
    correctionStyle: u.correctionStyle,
    consentLlmAt: u.consentLlmAt ? u.consentLlmAt.toISOString() : null,
    // the wizard is complete when the user reported a level AND consented to LLM processing
    onboardingComplete: Boolean(u.cefrSelf) && Boolean(u.consentLlmAt),
  }
}
