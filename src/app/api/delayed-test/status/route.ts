/**
 * GET /api/delayed-test/status — delayed-test readiness for the home card
 * (docs/05 M8). `eligible` = nodes a confirmatory session can probe right
 * now; `pending` = nodes in sight of mastery not yet due (3d age gate).
 * Node ids stay server-side (docs/00 C2 — never announce which nodes).
 */
import { requireUser } from '@/lib/auth/session'
import { collectDelayedTestStatus } from '@/lib/session/db-map'

export async function GET(req: Request) {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

  const { eligible, pendingCount } = await collectDelayedTestStatus(auth.user.id, new Date())
  return Response.json({
    ok: true,
    eligible: eligible.length,
    pending: pendingCount,
    maxPerSession: 2,
    contextsPerProbe: 3,
  })
}
