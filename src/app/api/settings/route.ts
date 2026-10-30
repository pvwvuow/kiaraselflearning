/**
 * Settings API (docs/05 M9).
 *
 * PATCH  /api/settings — partial profile update (correction style, self level,
 *        goal, interests, daily minutes, display name, LLM consent toggle).
 *        Only provided keys change; cefrComputed keeps driving the engine
 *        (cefrSelf is the self-report hint).
 * DELETE /api/settings — delete the account: the User row is removed and every
 *        user-owned table cascades (sessions → turns/evidence, states, seeds,
 *        positions) plus the write-only MetricEvents. The session cookie is
 *        cleared in the same response. User-generated GraphNodes stay by design
 *        (world content, docs/03 §B5) — their per-user STATE rows do not.
 */
import { db } from '@/lib/db'
import { clearSessionCookie, requireUser, sessionTokenFromRequest, revokeSession, toPublicUser } from '@/lib/auth/session'
import { settingsSchema } from '@/lib/auth/schemas'

export async function PATCH(req: Request) {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const parsed = settingsSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'validation failed', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    )
  }
  const d = parsed.data

  const user = await db.user.update({
    where: { id: auth.user.id },
    data: {
      ...(d.displayName !== undefined ? { displayName: d.displayName } : {}),
      ...(d.cefrSelf !== undefined ? { cefrSelf: d.cefrSelf } : {}),
      ...(d.goal !== undefined ? { goal: d.goal } : {}),
      ...(d.interests !== undefined ? { interests: JSON.stringify(d.interests) } : {}),
      ...(d.dailyMinutes !== undefined ? { dailyMinutes: d.dailyMinutes } : {}),
      ...(d.correctionStyle !== undefined ? { correctionStyle: d.correctionStyle } : {}),
      ...(d.consentLlm !== undefined ? { consentLlmAt: d.consentLlm ? new Date() : null } : {}),
    },
  })

  return Response.json({ ok: true, user: toPublicUser(user) })
}

export async function DELETE(req: Request) {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

  const token = sessionTokenFromRequest(req)

  // FK cascades (schema: onDelete: Cascade): UserSession, ChatSession → Turn +
  // Evidence, UserNodeState, Seed, NodePosition. MetricEvent is FK-free
  // (write-only) → removed explicitly. User-generated GraphNodes stay (world
  // content by design); their UserNodeState rows cascade away.
  await db.metricEvent.deleteMany({ where: { userId: auth.user.id } })
  await db.user.delete({ where: { id: auth.user.id } })
  await revokeSession(token)

  return Response.json(
    { ok: true, deleted: true },
    { headers: { 'set-cookie': clearSessionCookie() } },
  )
}
