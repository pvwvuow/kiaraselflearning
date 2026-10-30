/**
 * POST /api/auth/login { email, password }
 * → 200 { ok, user } + httpOnly session cookie · 401 wrong credentials
 */
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/auth/password'
import { createSession, createSessionCookie, toPublicUser } from '@/lib/auth/session'
import { loginSchema } from '@/lib/auth/schemas'

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'validation failed' }, { status: 400 })
  }
  const { email, password } = parsed.data

  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } })
  // generic 401 for both unknown email and wrong password (no user enumeration)
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return Response.json({ ok: false, error: 'invalid credentials' }, { status: 401 })
  }

  const session = await createSession(user.id)
  return Response.json(
    { ok: true, user: toPublicUser(user) },
    { headers: { 'set-cookie': createSessionCookie(session.token) } },
  )
}
