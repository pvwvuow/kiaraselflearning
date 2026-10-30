/**
 * Onboarding profile API (docs/05 M2).
 *
 * GET  /api/onboarding → current profile (prefill for the wizard) · 401 if unauthenticated
 * PATCH /api/onboarding { cefrSelf, goal, interests[], dailyMinutes, correctionStyle,
 *                         consentLlm, displayName? }
 * → persists all profile fields; consentLlm=true stores consentLlmAt = NOW
 *   (timestamped xAI consent, docs/00 metric #4); consentLlm=false stores null.
 *
 * NOTE: the placement quiz (engine M1) is submitted afterwards and will set
 * cefrComputed via applyPlacement — cefrSelf is only the ladder's start hint.
 */
import { db } from '@/lib/db'
import { requireUser, toPublicUser } from '@/lib/auth/session'
import { onboardingSchema } from '@/lib/auth/schemas'

export async function GET(req: Request) {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response
  return Response.json({ ok: true, user: toPublicUser(auth.user) })
}

export async function PATCH(req: Request) {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const parsed = onboardingSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'validation failed', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    )
  }
  const { cefrSelf, goal, interests, dailyMinutes, correctionStyle, consentLlm, displayName } =
    parsed.data

  const user = await db.user.update({
    where: { id: auth.user.id },
    data: {
      cefrSelf,
      goal,
      interests: JSON.stringify(interests),
      dailyMinutes,
      correctionStyle,
      consentLlmAt: consentLlm ? new Date() : null,
      ...(displayName !== undefined ? { displayName } : {}),
    },
  })

  return Response.json({ ok: true, user: toPublicUser(user) })
}
