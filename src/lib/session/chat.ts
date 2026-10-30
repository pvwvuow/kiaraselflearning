/**
 * Chat loop orchestration (docs/05 M3) — sits between the API routes and the
 * pure pieces: brief snapshot → tutor call → i+1 check → rewrite → persist.
 *
 * Failure policy: the conversation NEVER 500s because of the LLM. Any tutor /
 * rewrite / summary failure degrades to deterministic fallbacks (documented in
 * docs/04 §4) and is recorded in the Turn meta for observability.
 */
import { db } from '@/lib/db'
import { loadGraph } from '@/lib/graph/load'
import { xaiChat, type XaiMessage, type XaiResult } from '@/lib/llm/xai'
import { analyzeTurn, type AnalystInput, type AnalystResult, type AnalystNodeRef } from '@/lib/llm/analyst'
import { writeTurnEvidence } from '@/lib/evidence/writer'
import {
  buildFallbackReply,
  buildRewriteMessages,
  buildRollingSummaryMessages,
  renderTutorSystemPrompt,
  wrapUserMessage,
  type XaiMessageLite,
} from '@/lib/llm/prompts'
import { checkIPlus1 } from '@/lib/engine/iplus1'
import { probeSlotFor, type StoredProbePlan } from '@/lib/engine/delayed-test'
import type { SessionBrief } from '@/lib/engine/types'
import { recordMetric } from '@/lib/metrics'
import {
  BUDGET_MESSAGE_FA,
  BUDGET_TURN_NOTICE_EN,
  budgetState,
  recordLlmCall,
} from '@/lib/llm/budget'
import { safetyRedirectMessage, screenUserText } from '@/lib/llm/safety'
import { buildBriefBundle, getKnownLemmas, type BriefUserRow } from './brief-builder'
import { parseBriefColumn } from './db-map'
import {
  probeSpecsFromStates,
  runConfirmatoryTurn,
  RIDEALONG_TRANSITION,
  RIDEALONG_WARMUP_TURNS,
} from './confirmatory'
import { ChatError } from './errors'
import type { PickedScenario } from './scenarios'

export { ChatError }

/** every N user turns the rolling summary refreshes (docs/05 M3) */
export const ROLLING_SUMMARY_EVERY = 10
/** assistant/alternating turns fed to the tutor beyond the summary */
export const HISTORY_WINDOW = 20

export interface ChatDeps {
  /** injectable for tests (mocked LLM) */
  chat?: (opts: {
    messages: XaiMessage[]
    role: 'tutor' | 'analyst'
    temperature?: number
    maxTokens?: number
  }) => Promise<XaiResult>
  /** injectable per-turn analyst (tests mock the whole module) */
  analyze?: (input: AnalystInput) => Promise<AnalystResult>
}

const defaultChat = (opts: Parameters<NonNullable<ChatDeps['chat']>>[0]) => xaiChat(opts)

function x(messages: XaiMessageLite[]): XaiMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }))
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/session/start
// ─────────────────────────────────────────────────────────────────────────────

export interface StartSessionResult {
  sessionId: string
  brief: SessionBrief
  scenario: PickedScenario
  opener: { content: string; meta: TurnMeta }
  /** M8 ride-along delayed-test probes planned for this session (ids never sent to the client) */
  probeCount: number
}

export async function startSession(
  user: BriefUserRow,
  deps: ChatDeps = {},
  now: Date = new Date(),
): Promise<StartSessionResult> {
  const chat = deps.chat ?? defaultChat

  // M9 cost guardrail: an over-cap user starts NO new LLM session today.
  const budget = await budgetState(user.id, now)
  if (budget.over) throw new ChatError('budget', BUDGET_MESSAGE_FA)

  const bundle = await buildBriefBundle(user, now)

  // M8 ride-along probes (docs/00 C2): the planner already flipped p≈0.3
  // inside planSession — the picked states become concrete probe specs with
  // fresh contexts. Stored on the session row; ids never reach the client.
  const day = now.toISOString().slice(0, 10)
  const probeSpecs = probeSpecsFromStates(
    user.id,
    day,
    bundle.plan.delayedTestProbes.map((s) => ({ nodeId: s.nodeId, skill: s.skill })),
    bundle.scenario.id,
  )
  const probePlan: StoredProbePlan | null = probeSpecs.length
    ? { warmupTurns: RIDEALONG_WARMUP_TURNS, probes: probeSpecs }
    : null

  const session = await db.chatSession.create({
    data: {
      userId: user.id,
      type: 'roleplay_targeted',
      status: 'active',
      brief: JSON.stringify({ brief: bundle.brief, probePlan }),
      scenario: JSON.stringify(bundle.scenario),
    },
  })

  const system = renderTutorSystemPrompt(bundle.brief)
  const openerReply = await chat({
    role: 'tutor',
    temperature: 0.8,
    maxTokens: 300,
    messages: x([
      { role: 'system', content: system },
      {
        role: 'user',
        content:
          'Start the roleplay now: open in character with 1–3 short sentences and end with a question for the learner. English only (Persian notes are not needed yet).',
      },
    ]),
  })
  if (openerReply.ok) {
    await recordLlmCall(user.id, 'tutor', openerReply.promptTokens, openerReply.completionTokens, {
      sessionId: session.id,
      stage: 'opener',
    })
  }

  let opener: { content: string; meta: TurnMeta }
  if (openerReply.ok) {
    const targets = collectTargets(bundle.brief, bundle.scenario)
    // the opener obeys the same i+1 → rewrite → fallback path as any turn
    const enforced = await enforceIPlus1(
      chat,
      system,
      [],
      openerReply,
      bundle.knownLemmas,
      targets,
      bundle.scenario.role,
      user.id,
      session.id,
    )
    if (enforced.meta.rewritten) {
      await recordMetric(user.id, 'iplus1_violation', {
        sessionId: session.id,
        stage: 'opener',
        rate: enforced.meta.unknownRate ?? null,
      })
    }
    opener = {
      content: enforced.content,
      meta: { ...enforced.meta, latencyMs: openerReply.latencyMs, model: openerReply.model, opener: true },
    }
  } else {
    // deterministic opener — a failing LLM never blocks starting a session
    opener = {
      content: buildFallbackReply('opener', bundle.scenario.role),
      meta: { latencyMs: openerReply.latencyMs, model: null, rewritten: false, fallback: true, opener: true },
    }
  }

  await db.turn.create({
    data: {
      sessionId: session.id,
      role: 'tutor',
      content: opener.content,
      meta: JSON.stringify(opener.meta),
    },
  })

  await db.metricEvent
    .create({
      data: {
        userId: user.id,
        name: 'session_start',
        props: JSON.stringify({
          sessionId: session.id,
          scenarioId: bundle.scenario.id,
          briefTokens: bundle.tokenEstimate,
          probes: probeSpecs.length,
        }),
      },
    })
    .catch(() => {}) // metrics are write-only best-effort (docs/02)

  // M9: probes offered this session (ride-along delayed tests, docs/00 §4)
  if (probeSpecs.length > 0) {
    await recordMetric(user.id, 'delay_test_offered', {
      sessionId: session.id,
      mode: 'ride_along',
      count: probeSpecs.length,
    })
  }

  return {
    sessionId: session.id,
    brief: bundle.brief,
    scenario: bundle.scenario,
    opener,
    probeCount: probeSpecs.length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/session/turn
// ─────────────────────────────────────────────────────────────────────────────

export interface TurnMeta {
  latencyMs?: number
  model?: string | null
  unknownRate?: number
  unknownWords?: string[]
  rewritten?: boolean
  fallback?: boolean
  opener?: boolean
  /** M8: this tutor turn ASKS the given probe context (grading maps on it) */
  probe?: { probeIndex: number; contextIndex: number }
  /** M8: deterministic probe turn — no tutor LLM was involved */
  probeTurn?: boolean
  /** M8: ride-along probes finished, back to the roleplay */
  probesDone?: boolean
  /** M9: turn answered WITHOUT any LLM — daily token budget exhausted */
  budgetCapped?: boolean
  /** M9: turn blocked by the deterministic safety screen (no LLM saw it) */
  safetyBlocked?: boolean
}

export interface TurnResult {
  tutor: string
  meta: TurnMeta
  userTurnCount: number
  summaryUpdated: boolean
}

export async function runTutorTurn(
  userId: string,
  sessionId: string,
  content: string,
  deps: ChatDeps = {},
  now: Date = new Date(),
): Promise<TurnResult> {
  const chat = deps.chat ?? defaultChat

  const session = await db.chatSession.findUnique({ where: { id: sessionId } })
  if (!session || session.userId !== userId) throw new ChatError('not_found', 'session not found')
  if (session.status !== 'active') throw new ChatError('ended', 'session already ended')

  // confirmatory sessions run the deterministic delayed-test loop (docs/03 §A6)
  // — no tutor LLM, no roleplay chrome; the route layer stays type-agnostic
  if (session.type === 'confirmatory') {
    const r = await runConfirmatoryTurn(userId, sessionId, content, { analyze: deps.analyze }, now)
    return { tutor: r.tutor, meta: r.meta as TurnMeta, userTurnCount: r.userTurnCount, summaryUpdated: false }
  }

  // persist the learner turn FIRST (source of truth, even if the LLM fails)
  const userTurn = await db.turn.create({
    data: { sessionId, role: 'user', content, createdAt: now },
  })

  const stored = parseBriefColumn(session.brief)
  const brief = stored.brief
  const probePlan = stored.probePlan
  const scenario = parseJson<PickedScenario | null>(session.scenario, null)

  // ── history: rolling summary (if any) + last turns, learner messages wrapped ──
  const allTurns = await db.turn.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
  })
  const userTurnCount = allTurns.filter((t) => t.role === 'user').length

  // ── M9 guardrails, BEFORE any LLM (tutor, analyst, summary — everything):
  // 1) deterministic safety screen — flagged text never reaches a model;
  //    warm redirect, no accusation, `safety_blocked` metric (docs/00 #6/#7).
  const safety = screenUserText(content)
  if (safety.flagged) {
    const meta: TurnMeta = { safetyBlocked: true, fallback: true }
    await db.turn.create({
      data: { sessionId, role: 'tutor', content: safetyRedirectMessage(), meta: JSON.stringify(meta), createdAt: now },
    })
    await recordMetric(userId, 'safety_blocked', {
      sessionId,
      turnId: userTurn.id,
      category: safety.category ?? null,
    })
    return { tutor: safetyRedirectMessage(), meta, userTurnCount, summaryUpdated: false }
  }

  // 2) daily token budget — over cap: NO LLM call happens today; the turn
  //    still persists and the conversation keeps flowing (friendly notice).
  const budget = await budgetState(userId, now)
  if (budget.over) {
    const notice = `${BUDGET_TURN_NOTICE_EN}\n${BUDGET_MESSAGE_FA}`
    const meta: TurnMeta = { budgetCapped: true, fallback: true }
    await db.turn.create({
      data: { sessionId, role: 'tutor', content: notice, meta: JSON.stringify(meta), createdAt: now },
    })
    return { tutor: notice, meta, userTurnCount, summaryUpdated: false }
  }

  const history: XaiMessageLite[] = allTurns
    .slice(-HISTORY_WINDOW)
    .map((t) => ({
      role: t.role === 'user' ? 'user' : 'assistant',
      content: t.role === 'user' ? wrapUserMessage(t.content) : t.content,
    }))

  // ── M8: ride-along probe turn (docs/00 C2) — after the 2-turn warm-up the
  // plan's contexts replace the tutor LLM for exactly one turn each. The
  // analyst grades the answer against ONLY the probed node (no contamination
  // of other groups), and the rolling summary skips this turn. ──
  const probeSlot = probeSlotFor(probePlan, userTurnCount)
  if (probeSlot && probePlan) {
    const probe = probePlan.probes[probeSlot.probeIndex]
    const contextText = probe.contexts[probeSlot.contextIndex]?.text ?? ''
    const graph = loadGraph('en')
    const probeNode = graph.byId.get(probe.nodeId)
    const analyze = deps.analyze ?? ((input: AnalystInput) => analyzeTurn(input))
    let analysis: AnalystResult | null = null
    try {
      analysis = await analyze({
        turnId: userTurn.id,
        tutorContext: contextText,
        learnerText: content,
        knownNodes: probeNode
          ? [{ id: probeNode.id, title: probeNode.title, type: probeNode.type, glossFa: probeNode.glossFa }]
          : [],
        targetNodeIds: [probe.nodeId],
        responseLatencyMs: 0,
      })
    } catch {
      analysis = null
    }
    if (analysis) {
      await recordLlmCall(userId, 'analyst', analysis.promptTokens ?? null, analysis.completionTokens ?? null, {
        sessionId,
        stage: 'probe_grading',
      })
      await writeTurnEvidence(userId, sessionId, userTurn.id, analysis)
    }

    const nextSlot = probeSlotFor(probePlan, userTurnCount + 1)
    const meta: TurnMeta = nextSlot
      ? { probe: { probeIndex: nextSlot.probeIndex, contextIndex: nextSlot.contextIndex }, probeTurn: true }
      : { probeTurn: true, probesDone: true }
    const replyText = nextSlot
      ? `${RIDEALONG_TRANSITION}\n${probePlan.probes[nextSlot.probeIndex].contexts[nextSlot.contextIndex]?.text ?? ''}`
      : 'Thanks — now, back to our conversation!'
    await db.turn.create({
      data: { sessionId, role: 'tutor', content: replyText, meta: JSON.stringify(meta), createdAt: now },
    })
    return { tutor: replyText, meta, userTurnCount, summaryUpdated: false }
  }

  const messages: XaiMessageLite[] = [{ role: 'system', content: renderTutorSystemPrompt(
    brief ?? {
      user: { level: 'A1', goal: 'general', interests: [], correctionStyle: 'immediate', tone: 'warm' },
      knownLexicon: { A1: 0, A2: 0, B1: 0, sampleLemmas: [] },
      weakNodes: [],
      frontierNodes: [],
      activeErrorPatterns: [],
      scenario: { title: 'Free conversation', role: 'a friendly English tutor', mustElicit: [] },
    },
  ) }]
  if (session.summary) {
    const s = parseJson<{ text?: string }>(session.summary, {})
    if (s.text) {
      messages.push({ role: 'system', content: `Summary of the earlier turns:\n${s.text}` })
    }
  }
  messages.push(...history)

  // ── per-turn analyst runs IN PARALLEL with the tutor call (docs/04 §5):
  // it only needs the learner's message + previous tutor context, so the turn
  // latency does not grow. Failure → metric only, never blocks the chat.
  // M8: probed node ids are SUBTRACTED from the whitelist — probe answers
  // must flow exclusively through the delayed-test grading (no warm-up). ──
  const analyze = deps.analyze ?? ((input: AnalystInput) => analyzeTurn(input))
  const probeNodeIds = new Set((probePlan?.probes ?? []).map((p) => p.nodeId))
  const prevTutor = [...allTurns].reverse().find((t) => t.role === 'tutor')
  const latencyMs = prevTutor ? Math.max(0, now.getTime() - prevTutor.createdAt.getTime()) : 0
  const analysisPromise: Promise<AnalystResult | null> = analyze({
    turnId: userTurn.id,
    tutorContext: prevTutor?.content ?? null,
    learnerText: content,
    knownNodes: (await analystKnownNodes(userId, brief, scenario)).filter((n) => !probeNodeIds.has(n.id)),
    targetNodeIds: collectTargetIds(brief, scenario).filter((id) => !probeNodeIds.has(id)),
    responseLatencyMs: latencyMs,
  }).catch(() => null)

  // ── tutor call ──
  const reply = await chat({ role: 'tutor', temperature: 0.8, maxTokens: 300, messages: x(messages) })
  if (reply.ok) {
    await recordLlmCall(userId, 'tutor', reply.promptTokens, reply.completionTokens, { sessionId, stage: 'turn' })
  }

  // ── i+1 check → rewrite → fallback (docs/04 §4) ──
  const knownLemmas = await getKnownLemmas(userId)
  const targetTitles = collectTargets(brief, scenario)
  const meta: TurnMeta = { latencyMs: reply.ok ? reply.latencyMs : 0, model: reply.ok ? reply.model : null }

  let finalContent: string
  if (!reply.ok) {
    finalContent = buildFallbackReply('turn', scenario?.role ?? null)
    meta.fallback = true
  } else {
    const enforced = await enforceIPlus1(
      chat,
      messages[0].content,
      history,
      reply,
      knownLemmas,
      targetTitles,
      scenario?.role ?? null,
      userId,
      sessionId,
    )
    finalContent = enforced.content
    meta.unknownRate = enforced.meta.unknownRate
    meta.unknownWords = enforced.meta.unknownWords
    if (enforced.meta.rewritten) {
      meta.rewritten = true
      await recordMetric(userId, 'iplus1_violation', {
        sessionId,
        stage: 'turn',
        rate: enforced.meta.unknownRate ?? null,
      })
    }
    if (enforced.meta.fallback) meta.fallback = true
  }

  await db.turn.create({
    data: {
      sessionId,
      role: 'tutor',
      content: finalContent,
      meta: JSON.stringify(meta),
    },
  })

  // ── collect the analyst result → Evidence rows (append-only, idempotent) ──
  const analysis = await analysisPromise
  if (analysis) {
    await recordLlmCall(userId, 'analyst', analysis.promptTokens ?? null, analysis.completionTokens ?? null, {
      sessionId,
      stage: 'turn',
    })
    await writeTurnEvidence(userId, sessionId, userTurn.id, analysis)
    if (!analysis.ok) {
      await db.metricEvent
        .create({ data: { userId, name: 'analyst_parse_fail', props: JSON.stringify({ sessionId, turnId: userTurn.id, error: analysis.error }) } })
        .catch(() => {})
    }
  }

  // ── rolling summary every 10 learner turns (skipped on probe turns above) ──
  let summaryUpdated = false
  if (userTurnCount > 0 && userTurnCount % ROLLING_SUMMARY_EVERY === 0) {
    const prior = parseJson<{ text?: string; upToUserTurn?: number }>(session.summary, {})
    const transcript = allTurns
      .slice(-ROLLING_SUMMARY_EVERY * 2)
      .map((t) => `${t.role === 'user' ? 'Learner' : 'Tutor'}: ${t.content}`)
      .join('\n')
    const summary = await chat({
      role: 'analyst',
      temperature: 0.1,
      maxTokens: 220,
      messages: x(buildRollingSummaryMessages(prior.text ? `Previous summary:\n${prior.text}\n\n${transcript}` : transcript)),
    })
    if (summary.ok) {
      await recordLlmCall(userId, 'analyst', summary.promptTokens, summary.completionTokens, {
        sessionId,
        stage: 'rolling_summary',
      })
      await db.chatSession.update({
        where: { id: sessionId },
        data: {
          summary: JSON.stringify({ text: summary.content, upToUserTurn: userTurnCount, updatedAt: now.toISOString() }),
        },
      })
      summaryUpdated = true
    }
  }

  return { tutor: finalContent, meta, userTurnCount, summaryUpdated }
}

function runIPlus1Sync(
  reply: string,
  knownLemmas: string[],
  targets: string[],
): ReturnType<typeof checkIPlus1> {
  return checkIPlus1({ reply, knownLemmas, allowedTargets: targets })
}

/**
 * Shared i+1 enforcement (docs/04 §4): check → one rewrite pass with the
 * unknown list fed back → deterministic fallback if the rewrite still violates.
 * Used by BOTH the opener and every turn, so meta semantics stay identical.
 * M9: the rewrite tutor call is recorded for the daily token budget.
 */
async function enforceIPlus1(
  chat: NonNullable<ChatDeps['chat']>,
  systemPrompt: string,
  history: XaiMessageLite[],
  reply: Extract<XaiResult, { ok: true }>,
  knownLemmas: string[],
  targets: string[],
  role: string | null,
  userId?: string,
  sessionId?: string,
): Promise<{ content: string; meta: TurnMeta }> {
  const check = runIPlus1Sync(reply.content, knownLemmas, targets)
  const meta: TurnMeta = { unknownRate: check.rate, unknownWords: check.unknown, rewritten: false, fallback: false }

  if (!check.violation) {
    return { content: reply.content, meta }
  }

  const rewrite = await chat({
    role: 'tutor',
    temperature: 0.7,
    maxTokens: 300,
    messages: x(buildRewriteMessages(systemPrompt, history, reply.content, check.unknown)),
  })
  if (rewrite.ok && userId) {
    await recordLlmCall(userId, 'tutor', rewrite.promptTokens, rewrite.completionTokens, {
      sessionId: sessionId ?? null,
      stage: 'iplus1_rewrite',
    })
  }
  if (!rewrite.ok) {
    // rewrite call failed → keep the original reply (better than nothing)
    return { content: reply.content, meta }
  }
  const recheck = runIPlus1Sync(rewrite.content, knownLemmas, targets)
  if (!recheck.violation) {
    return {
      content: rewrite.content,
      meta: { ...meta, unknownRate: recheck.rate, unknownWords: recheck.unknown, rewritten: true },
    }
  }
  return {
    content: buildFallbackReply('turn', role),
    meta: { ...meta, fallback: true },
  }
}

/** frontier + mustElicit titles are the tutor's allowed NEW words (i+1 targets) */
function collectTargets(brief: SessionBrief | null, scenario: PickedScenario | null): string[] {
  const out: string[] = []
  for (const n of brief?.frontierNodes ?? []) out.push(n.title)
  for (const n of brief?.scenario.mustElicit ?? []) out.push(n.title)
  for (const n of scenario?.mustElicit ?? []) out.push(n.title)
  return out
}

/** analyst whitelist = graph nodes the user has touched + this session's targets */
async function analystKnownNodes(
  userId: string,
  brief: SessionBrief | null,
  scenario: PickedScenario | null,
): Promise<AnalystNodeRef[]> {
  const graph = loadGraph('en')
  const touched = await db.userNodeState.findMany({
    where: { userId, displayState: { in: ['available', 'learning', 'mastered', 'fading', 'assumed_known'] } },
    select: { nodeId: true },
  })
  const ids = new Set(touched.map((t) => t.nodeId))
  for (const n of brief?.scenario.mustElicit ?? []) ids.add(n.id)
  for (const n of brief?.frontierNodes ?? []) ids.add(n.id)
  for (const n of scenario?.mustElicit ?? []) ids.add(n.id)
  return [...ids]
    .map((id) => graph.byId.get(id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .map((n) => ({ id: n.id, title: n.title, type: n.type, glossFa: n.glossFa }))
}

/** target NODE ids for the analyst prompt (higher prior) */
function collectTargetIds(brief: SessionBrief | null, scenario: PickedScenario | null): string[] {
  const out: string[] = []
  for (const n of brief?.scenario.mustElicit ?? []) out.push(n.id)
  for (const n of brief?.frontierNodes ?? []) out.push(n.id)
  for (const n of scenario?.mustElicit ?? []) out.push(n.id)
  return [...new Set(out)]
}

/** convenience for the routes: normalize a User row into BriefUserRow fields */
export function toBriefUserRow(u: {
  id: string
  cefrComputed: string | null
  cefrSelf: string | null
  goal: string
  interests: string
  correctionStyle: string
  dailyMinutes: number
}): BriefUserRow {
  return {
    id: u.id,
    cefrComputed: u.cefrComputed,
    cefrSelf: u.cefrSelf,
    goal: u.goal,
    interests: u.interests,
    correctionStyle: u.correctionStyle,
    dailyMinutes: u.dailyMinutes,
  }
}
