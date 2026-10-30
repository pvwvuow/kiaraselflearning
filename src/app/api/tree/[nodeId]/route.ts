/**
 * PATCH /api/tree/:nodeId — pin/hide a node (docs/05 M6 node card actions).
 * requireUser-guarded · 404 unknown node · 400 invalid body.
 * Persisted on the user's NodePosition row (created on demand).
 */
import { z } from 'zod'
import { requireUser } from '@/lib/auth/session'
import { setTreeNodeFlags } from '@/lib/tree/tree-service'

const bodySchema = z
  .object({
    pinned: z.boolean().optional(),
    hidden: z.boolean().optional(),
  })
  .refine((v) => v.pinned !== undefined || v.hidden !== undefined, {
    message: 'at least one of pinned/hidden is required',
  })

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ nodeId: string }> },
): Promise<Response> {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

  const { nodeId } = await ctx.params
  if (!nodeId || nodeId.length > 200) {
    return Response.json({ ok: false, error: 'missing nodeId' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'validation failed', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    )
  }

  const result = await setTreeNodeFlags(auth.user.id, nodeId, parsed.data)
  if (!result) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })

  return Response.json({ ok: true, id: result.nodeId, pinned: result.pinned, hidden: result.hidden })
}
