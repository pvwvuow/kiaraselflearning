/**
 * Chat loop orchestration (docs/05 M3) — sits between the API routes and the
 * pure pieces: brief snapshot → tutor call → i+1 check → rewrite → persist.
 *
 * Failure policy: the conversation NEVER 500s because of the LLM. Any tutor /
 * rewrite / summary failure degrades to deterministic fallbacks (documented in
 * docs/04 §4) and is recorded in the Turn meta for observability.
 */
import { db } from '@/lib/db'
import { xaiChat, type XaiMessage, type XaiResult } from '@/lib/llm/xai'
import {
  buildFallbackReply,
  buildRewriteMessages,
  buildRollingSummaryMessages,
  renderTutorSystemPrompt,
  wrapUserMessage,
  type XaiMessageLite,
} from '@/lib/llm/prompts'
import { checkIPlus1 } from '@/lib/engine/iplus1'
import type { SessionBrief } from '@/lib/engine/types'
import { buildBriefBundle, getKnownLemmas, type BriefUserRow } from './brief-builder'
import type { PickedScenario } from './scenarios'

/** every N user turns the rolling summary refreshes (docs/05 M3) */
export const ROLLING_SUMMARY_EVERY = 10
/** assistant/alternating turns fed to the tutor beyond the summary */
export const HISTORY_WINDOW = 20

export class ChatError extends Error {
  constructor(
    public code: 'not_found' | 'ended' | 'empty_content' | 'too_long',
    message: string,
  ) {
    super(message)
  }
}

export interface ChatDeps {
  /** injectable for tests (mocked LLM) */
  chat?: (opts: {
    messages: XaiMessage[]
    role: 'tutor' | 'analyst'
    temperature?: number
    maxTokens?: number
  }) => Promise<XaiResult>
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
}

export async function startSession(
  user: BriefUserRow,
  deps: ChatDeps = {},
  now: Date = new Date(),
): Promise<StartSessionResult> {
  const chat = deps.chat ?? defaultChat
  const bundle = await buildBriefBundle(user, now)

  const session = await db.chatSession.create({
    data: {
      userId: user.id,
      type: 'roleplay_targeted',
      status: 'active',
      brief: JSON.stringify(bundle.brief),
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
    )
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
        props: JSON.stringify({ sessionId: session.id, scenarioId: bundle.scenario.id, briefTokens: bundle.tokenEstimate }),
      },
    })
    .catch(() => {}) // metrics are write-only best-effort (docs/02)

  return {
    sessionId: session.id,
    brief: bundle.brief,
    scenario: bundle.scenario,
    opener,
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

  // persist the learner turn FIRST (source of truth, even if the LLM fails)
  await db.turn.create({
    data: { sessionId, role: 'user', content, createdAt: now },
  })

  const brief = parseJson<SessionBrief | null>(session.brief, null)
  const scenario = parseJson<PickedScenario | null>(session.scenario, null)

  // ── history: rolling summary (if any) + last turns, learner messages wrapped ──
  const allTurns = await db.turn.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
  })
  const history: XaiMessageLite[] = allTurns
    .slice(-HISTORY_WINDOW)
    .map((t) => ({
      role: t.role === 'user' ? 'user' : 'assistant',
      content: t.role === 'user' ? wrapUserMessage(t.content) : t.content,
    }))

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

  // ── tutor call ──
  const reply = await chat({ role: 'tutor', temperature: 0.8, maxTokens: 300, messages: x(messages) })

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
    )
    finalContent = enforced.content
    meta.unknownRate = enforced.meta.unknownRate
    meta.unknownWords = enforced.meta.unknownWords
    if (enforced.meta.rewritten) meta.rewritten = true
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

  // ── rolling summary every 10 learner turns ──
  const userTurnCount = allTurns.filter((t) => t.role === 'user').length
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
 */
async function enforceIPlus1(
  chat: NonNullable<ChatDeps['chat']>,
  systemPrompt: string,
  history: XaiMessageLite[],
  reply: Extract<XaiResult, { ok: true }>,
  knownLemmas: string[],
  targets: string[],
  role: string | null,
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

/** convenience for the routes: normalize a User row into BriefUserRow fields */
export function toBriefUserRow(u: {
  id: string
  cefrComputed: string | null
  cefrSelf: string | null
  goal: string
  interests: string
  correctionStyle: string
}): BriefUserRow {
  return {
    id: u.id,
    cefrComputed: u.cefrComputed,
    cefrSelf: u.cefrSelf,
    goal: u.goal,
    interests: u.interests,
    correctionStyle: u.correctionStyle,
  }
}
