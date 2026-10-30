/**
 * POST /api/evidence/:id/dispute — the user's control over the LLM's judgement
 * (docs/00 R3): flag evidence, exclude it from every future aggregation.
 * Append-only: the row is never deleted, only `disputed=true` + optional reason.
 * 401 unauthenticated · 404 unknown/foreign · 200 { disputed: true }.
 */
import { requireUser } from '@/lib/auth/session'
import { disputeEvidence } from '@/lib/evidence/writer'

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

  const { id } = await ctx.params
  if (!id) return Response.json({ ok: false, error: 'missing id' }, { status: 400 })

  let reason: string | null = null
  try {
    const body = (await req.json()) as { reason?: unknown }
    if (body && typeof body.reason === 'string' && body.reason.trim().length > 0) {
      reason = body.reason.trim().slice(0, 500)
    }
  } catch {
    reason = null // body optional
  }

  const result = await disputeEvidence(auth.user.id, id, reason)
  if (!result) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })

  return Response.json({ ok: true, id: result.id, disputed: true })
}
