/**
 * POST /api/session/start — create a roleplay session (docs/05 M3).
 * Builds the brief from real state, picks a scenario, opens the roleplay
 * with a tutor line. 401 unauthenticated · 403 LLM consent missing.
 */
import { requireUser } from '@/lib/auth/session'
import { startSession, toBriefUserRow } from '@/lib/session/chat'

export async function POST(req: Request) {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

  // xAI consent gate (docs/00 R7 — the user always owns the LLM switch)
  if (!auth.user.consentLlmAt) {
    return Response.json(
      { ok: false, error: 'llm_consent_required', errorFa: 'برای شروع گفتگو باید با پردازش xAI موافقت کنید.' },
      { status: 403 },
    )
  }

  try {
    const result = await startSession(toBriefUserRow(auth.user))
    return Response.json({
      ok: true,
      sessionId: result.sessionId,
      brief: result.brief,
      scenario: result.scenario,
      opener: result.opener,
    })
  } catch (err) {
    console.error('session/start failed:', err)
    return Response.json(
      { ok: false, error: 'session_start_failed', errorFa: 'شروع جلسه ناموفق بود. دوباره تلاش کنید.' },
      { status: 500 },
    )
  }
}
