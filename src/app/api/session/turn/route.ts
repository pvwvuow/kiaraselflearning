/**
 * POST /api/session/turn { sessionId, content } — one tutor exchange (docs/05 M3).
 * Tutor call → i+1 check → rewrite pass if needed → Turn persistence.
 * 401 unauthenticated · 400 invalid · 404 unknown/foreign session · 409 ended.
 */
import { z } from 'zod'
import { requireUser } from '@/lib/auth/session'
import { runTutorTurn, ChatError } from '@/lib/session/chat'

const turnSchema = z.object({
  sessionId: z.string().min(1).max(64),
  content: z.string().min(1, 'empty message').max(2000),
})

export async function POST(req: Request) {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const parsed = turnSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'validation failed', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    )
  }
  if (!auth.user.consentLlmAt) {
    return Response.json(
      { ok: false, error: 'llm_consent_required', errorFa: 'برای گفتگو باید با پردازش xAI موافقت کنید.' },
      { status: 403 },
    )
  }

  try {
    const result = await runTutorTurn(auth.user.id, parsed.data.sessionId, parsed.data.content)
    return Response.json({
      ok: true,
      tutor: result.tutor,
      meta: result.meta,
      userTurnCount: result.userTurnCount,
      summaryUpdated: result.summaryUpdated,
    })
  } catch (err) {
    if (err instanceof ChatError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'ended' ? 409 : 400
      return Response.json({ ok: false, error: err.code }, { status })
    }
    console.error('session/turn failed:', err)
    return Response.json(
      { ok: false, error: 'turn_failed', errorFa: 'پاسخ مربی ناموفق بود. دوباره تلاش کنید.' },
      { status: 500 },
    )
  }
}
