/**
 * POST /api/seeds/:id/approve — plant a proposal (docs/03 §B5, docs/05 M7).
 * requireUser-guarded · 404 foreign/unknown · 409 already decided or expired.
 * Weekly cap (§B4): the 4th approval inside the trailing 7-day window is
 * HELD in queue — 200 with `held: true`, the seed stays `proposed`.
 */
import { requireUser } from '@/lib/auth/session'
import { approveSeed } from '@/lib/tree/seed-service'

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

  const result = await approveSeed(auth.user.id, id, new Date())
  if (result.notFound) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  if (result.alreadyDecided) {
    return Response.json({ ok: false, error: 'already_decided' }, { status: 409 })
  }
  if (result.expired) {
    return Response.json({ ok: false, error: 'expired' }, { status: 409 })
  }

  return Response.json({
    ok: true,
    held: result.held ?? false,
    cap: result.cap,
    plantedNodeId: result.plantedNodeId ?? null,
    entry: result.entry ?? null,
  })
}
