/**
 * POST /api/session/start — create a session (docs/05 M3 + M8).
 * Body `{ type: 'confirmatory' }` starts a delayed-test session (≤2 eligible
 * nodes × 3 fresh contexts, deterministic, no LLM). Default: roleplay session
 * with the planner's mix; ride-along probes ride at p≈0.3 (docs/00 C2).
 * 401 unauthenticated · 403 LLM consent missing.
 */
import { requireUser } from '@/lib/auth/session'
import { startSession, ChatError, toBriefUserRow } from '@/lib/session/chat'
import { startConfirmatorySession } from '@/lib/session/confirmatory'

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

  let type = 'roleplay_targeted'
  try {
    const body = (await req.json().catch(() => ({}))) as { type?: string }
    if (body?.type === 'confirmatory') type = 'confirmatory'
  } catch {
    // empty body → roleplay
  }

  try {
    const userRow = toBriefUserRow(auth.user)

    if (type === 'confirmatory') {
      const result = await startConfirmatorySession(userRow)
      return Response.json({
        ok: true,
        started: result.started,
        sessionId: result.sessionId ?? null,
        opener: result.opener ?? null,
        plan: result.plan ?? null,
        messageFa: result.messageFa ?? null,
        eligible: result.eligible ?? null,
        pendingCount: result.pendingCount ?? null,
      })
    }

    const result = await startSession(userRow)
    return Response.json({
      ok: true,
      sessionId: result.sessionId,
      brief: result.brief,
      scenario: result.scenario,
      opener: result.opener,
    })
  } catch (err) {
    // M9: over the daily token budget → friendly 429, NOT a 500 (docs/05 M9)
    if (err instanceof ChatError && err.code === 'budget') {
      return Response.json({ ok: false, error: 'budget', errorFa: err.message }, { status: 429 })
    }
    console.error('session/start failed:', err)
    return Response.json(
      { ok: false, error: 'session_start_failed', errorFa: 'شروع جلسه ناموفق بود. دوباره تلاش کنید.' },
      { status: 500 },
    )
  }
}
