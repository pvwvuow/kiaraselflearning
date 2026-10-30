/**
 * POST /api/session/end — run the docs/03 §A7 session-end pipeline:
 * aggregation → FSRS update → propagation → root-cause → growth scan → summary.
 * 401 unauthenticated · 404 unknown/foreign · 409 already ended.
 */
import { z } from 'zod'
import { requireUser } from '@/lib/auth/session'
import { endSession } from '@/lib/session/pipeline'
import { ChatError } from '@/lib/session/chat'

const endSchema = z.object({ sessionId: z.string().min(1).max(64) })

export async function POST(req: Request) {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const parsed = endSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'validation failed', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    )
  }

  try {
    const result = await endSession(auth.user.id, parsed.data.sessionId)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof ChatError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'ended' ? 409 : 400
      return Response.json({ ok: false, error: err.code }, { status })
    }
    console.error('session/end failed:', err)
    return Response.json(
      { ok: false, error: 'session_end_failed', errorFa: 'پایان جلسه ناموفق بود. دوباره تلاش کنید.' },
      { status: 500 },
    )
  }
}
