/**
 * POST /api/auth/logout — revokes the current session and clears the cookie.
 * Idempotent: 200 even when not logged in.
 */
import { clearSessionCookie, revokeSession, sessionTokenFromRequest } from '@/lib/auth/session'

export async function POST(req: Request) {
  const token = sessionTokenFromRequest(req)
  await revokeSession(token)
  return Response.json({ ok: true }, { headers: { 'set-cookie': clearSessionCookie() } })
}
