/**
 * POST /api/seeds/:id/reject — decline a proposal (docs/05 M7).
 * requireUser-guarded · 404 foreign/unknown · 409 already decided.
 * The node then sits out a 14-day cooldown enforced by the pipeline scan
 * (docs/03 §B4): no re-proposal of the same node for 14 days.
 */
import { requireUser } from '@/lib/auth/session'
import { rejectSeed } from '@/lib/tree/seed-service'

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

  const { id } = await ctx.params
  if (!id || id.length > 100) {
    return Response.json({ ok: false, error: 'missing id' }, { status: 400 })
  }

  const result = await rejectSeed(auth.user.id, id, new Date())
  if (result.notFound) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  if (result.alreadyDecided) {
    return Response.json({ ok: false, error: 'already_decided' }, { status: 409 })
  }

  return Response.json({ ok: true })
}
