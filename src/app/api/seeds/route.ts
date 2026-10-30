/**
 * GET /api/seeds — the seed inbox (docs/05 M7). requireUser-guarded.
 * Returns ranked proposals (score desc), recently decided seeds for context
 * and the weekly-cap meter (docs/03 §B4: 3 planted / trailing 7 days).
 * Stale proposals (expiresAt < now) are lazily expired on read.
 */
import { requireUser } from '@/lib/auth/session'
import { getSeedInbox } from '@/lib/tree/seed-service'

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

  const payload = await getSeedInbox(auth.user.id, new Date())
  return Response.json(payload)
}
