/**
 * POST /api/auth/register { email, password, displayName? }
 * → 201 { ok, user } + httpOnly session cookie · 409 email taken · 400 invalid
 */
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth/password'
import { createSession, createSessionCookie, toPublicUser } from '@/lib/auth/session'
import { registerSchema } from '@/lib/auth/schemas'

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'validation failed', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    )
  }
  const { email, password, displayName } = parsed.data

  const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } })
  if (existing) {
    return Response.json({ ok: false, error: 'email already registered' }, { status: 409 })
  }

  const user = await db.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      displayName: displayName ?? null,
    },
  })

  const session = await createSession(user.id)
  return Response.json(
    { ok: true, user: toPublicUser(user) },
    { status: 201, headers: { 'set-cookie': createSessionCookie(session.token) } },
  )
}
