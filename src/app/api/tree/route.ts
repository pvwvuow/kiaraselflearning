/**
 * GET /api/tree — the user's personal skill tree (docs/05 M6).
 * requireUser-guarded. Positions are PERSISTENT (semi-fixed layout): the
 * first call lays the whole world out deterministically and stores every
 * NodePosition; later calls keep saved positions verbatim and only place
 * nodes that appeared since (e.g. a planted seed — docs/03 §B5). Fading is
 * recomputed on read (docs/03 §A5), and each node carries a Persian "why".
 */
import { requireUser } from '@/lib/auth/session'
import { getTreeView } from '@/lib/tree/tree-service'

export async function GET(req: Request): Promise<Response> {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

  const payload = await getTreeView(auth.user.id, new Date())
  return Response.json(payload)
}
