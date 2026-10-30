/**
 * POST /api/placement — adaptive placement quiz, stateless ladder (docs/05 M1
 * wired into the M5 onboarding wizard).
 *
 * The client sends the self-reported band + every answer given so far
 * ({ nodeId, optionIndex }). The server rebuilds the SAME deterministic quiz
 * (seed = hash(userId)), grades every answer where correctIndex lives, reruns
 * the ladder and returns the next item WITHOUT correctIndex. `finish: true`
 * applies the ladder: assumed_known states (NEVER mastered) + cefrComputed.
 *
 * 401 unauthenticated · 400 invalid body.
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { loadGraph } from '@/lib/graph/load'
import { hashSeed } from '@/lib/session/scenarios'
import {
  buildPlacementQuiz,
  pickItemForBand,
  runLadder,
  applyPlacement,
  bandIndex,
  isCefrBand,
  clampBand,
} from '@/lib/engine/placement'
import { CEFR_BANDS } from '@/lib/engine/types'
import type { CefrBand, PlacementAnswer } from '@/lib/engine/types'

const bodySchema = z.object({
  selfBand: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
  answers: z
    .array(
      z.object({
        nodeId: z.string().min(1).max(120),
        optionIndex: z.number().int().min(0).max(7),
      }),
    )
    .max(30),
  finish: z.boolean().optional(),
})

/** self-report A1..C2 → the MVP ladder's A1..B1 world (B2+ starts at the top) */
function toStartBand(selfBand: string): CefrBand {
  if (!isCefrBand(selfBand)) return 'B1' // B2..C2 self-reports start at the top band
  return clampBand(Math.min(bandIndex(selfBand), CEFR_BANDS.length - 1))
}

export async function POST(req: Request) {
  const auth = await requireUser(req)
  if ('response' in auth) return auth.response

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
  const { selfBand, answers, finish } = parsed.data

  // deterministic per user: rebuild == the quiz the client is showing
  const graph = loadGraph()
  const startBand = toStartBand(selfBand)
  const quiz = buildPlacementQuiz(graph.nodes, startBand, hashSeed(auth.user.id))

  // grade server-side (correctIndex never leaves the server)
  const byNodeId = new Map<string, (typeof quiz.pools)['A1'][number]>()
  for (const band of CEFR_BANDS) for (const item of quiz.pools[band]) byNodeId.set(item.nodeId, item)

  const graded: PlacementAnswer[] = []
  const used = new Set<string>()
  for (const a of answers) {
    const item = byNodeId.get(a.nodeId)
    if (!item) continue // unknown item — ignore, never crash the ladder
    graded.push({ band: item.band, correct: a.optionIndex === item.correctIndex })
    used.add(item.nodeId)
  }

  const ladder = runLadder(startBand, graded)
  const next = pickItemForBand(quiz, ladder.currentBand, used)
  const askedCount = graded.length

  if (finish) {
    const now = new Date()
    const drafts = applyPlacement(graph.nodes, ladder, auth.user.id, now)
    // placement only FILLS GAPS: an existing practiced state is never overwritten
    await db.$transaction(
      drafts.map((d) =>
        db.userNodeState.upsert({
          where: {
            userId_nodeId_skill: { userId: d.userId, nodeId: d.nodeId, skill: d.skill },
          },
          create: {
            userId: d.userId,
            nodeId: d.nodeId,
            skill: d.skill,
            stability: d.stability,
            difficulty: d.difficulty,
            due: d.due,
            lastReviewAt: d.lastReviewAt,
            reps: d.reps,
            lapses: d.lapses,
            learningSteps: d.learningSteps,
            fsrsState: d.fsrsState,
            displayState: d.displayState,
            strength: d.strength,
            pendingDelayTest: d.pendingDelayTest,
            delayTestEligibleAt: d.delayTestEligibleAt,
            masteredAt: d.masteredAt,
            lastAppliedEvidenceId: d.lastAppliedEvidenceId,
          },
          update: {},
        }),
      ),
    )
    await db.user.update({
      where: { id: auth.user.id },
      data: { cefrComputed: ladder.finalBand },
    })
    await db.metricEvent
      .create({
        data: {
          userId: auth.user.id,
          name: 'placement_applied',
          props: JSON.stringify({
            finalBand: ladder.finalBand,
            lit: drafts.length,
            asked: askedCount,
          }),
        },
      })
      .catch(() => {})

    return Response.json({
      ok: true,
      next: null,
      askedCount,
      done: true,
      finalBand: ladder.finalBand,
      litCount: drafts.length,
    })
  }

  return Response.json({
    ok: true,
    next: next
      ? { nodeId: next.nodeId, band: next.band, word: next.word, options: next.options }
      : null,
    askedCount,
    done: next === null,
    finalBand: null,
    litCount: 0,
  })
}
