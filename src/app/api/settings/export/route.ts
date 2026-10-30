/**
 * GET /api/settings/export — the user's data, portability guarantee (docs/05
 * M9): one JSON document with the profile (never the password hash), every
 * chat session with its turns and evidence, all node states, seeds, tree
 * positions and metric events. Served as an attachment download.
 */
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'

function publicUserRow(u: {
  id: string
  email: string
  displayName: string | null
  l1: string
  targetLang: string
  cefrSelf: string | null
  cefrComputed: string | null
  goal: string
  interests: string
  dailyMinutes: number
  correctionStyle: string
  consentLlmAt: Date | null
  createdAt: Date
}) {
  let interests: string[] = []
  try {
    const parsed: unknown = JSON.parse(u.interests)
    if (Array.isArray(parsed)) interests = parsed.map(String)
  } catch {
    interests = []
  }
  return { ...u, interests, passwordHash: undefined }
}

export async function GET(req: Request) {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response
  const userId = auth.user.id

  const [sessions, states, seeds, positions, metrics] = await Promise.all([
    db.chatSession.findMany({
      where: { userId },
      orderBy: { startedAt: 'asc' },
      include: {
        turns: { orderBy: { createdAt: 'asc' }, select: { id: true, role: true, content: true, meta: true, createdAt: true } },
        evidences: { orderBy: { createdAt: 'asc' } },
      },
    }),
    db.userNodeState.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.seed.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.nodePosition.findMany({ where: { userId } }),
    db.metricEvent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
  ])

  const payload = {
    app: 'kiara',
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    user: publicUserRow(auth.user),
    chatSessions: sessions.map((s) => ({
      id: s.id,
      type: s.type,
      status: s.status,
      brief: s.brief,
      scenario: s.scenario,
      summary: s.summary,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      turns: s.turns,
      evidence: s.evidences,
    })),
    nodeStates: states,
    seeds,
    treePositions: positions,
    metricEvents: metrics,
  }

  const date = new Date().toISOString().slice(0, 10)
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="kiara-export-${date}.json"`,
      'cache-control': 'no-store',
    },
  })
}
