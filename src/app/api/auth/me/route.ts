/**
 * GET /api/auth/me — current user profile (public shape, no passwordHash).
 * 401 when unauthenticated — reference guard for all user-scoped routes.
 */
import { requireUser, toPublicUser } from '@/lib/auth/session'

export async function GET(req: Request) {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response
  return Response.json({ ok: true, user: toPublicUser(auth.user) })
}
