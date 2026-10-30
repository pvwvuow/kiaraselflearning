/**
 * Session brief builder — the DB side of docs/03 §C.
 * Pure engine functions (buildBrief, rankWeakNodes, computeAvailability,
 * estimateBriefTokens) do the math; this module only fetches rows, maps them
 * to engine shapes and enforces the ≤1.5k-token bound.
 */
import { db } from '@/lib/db'
import { loadGraph } from '@/lib/graph/load'
import {
  buildBrief,
  estimateBriefTokens,
  planSession,
  rankWeakNodes,
} from '@/lib/engine/brief'
import { computeAvailability, frontierNodes } from '@/lib/engine/graph'
import { rngFromSeed } from '@/lib/engine/rng'
import type {
  BriefNodeRef,
  DisplayState,
  NodeSkillState,
  SessionBrief,
  SessionPlan,
  Skill,
} from '@/lib/engine/types'
import { CEFR_ORDER, pickScenario, type PickedScenario } from './scenarios'
import { collectDelayedTestStatus, rowToState } from './db-map'

export { rowToState }

export const BRIEF_TOKEN_BUDGET = 1500
/** error-pattern look-back window for the brief's "trouble spots" */
export const ERROR_PATTERN_WINDOW_DAYS = 30

const NON_LOCKED: readonly DisplayState[] = ['available', 'learning', 'mastered', 'fading', 'assumed_known']

const ERROR_TYPE_FA: Record<string, string> = {
  form: 'خطای صیغه‌ای',
  usage: 'کاربرد نادرست',
  word_choice: 'انتخاب نادرست واژه',
  spelling: 'غلط املایی',
  word_order: 'ترتیب نادرست واژه‌ها',
  register: 'لحن نامناسب',
  pronunciation: 'خطای تلفظ (نوشتاری)',
  missing_word: 'جاافتادگی واژه',
}

/** Persian digits for user-facing counts (consistent with rankWeakNodes' why). */
function faDigits(n: number): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹'
  return String(n)
    .split('')
    .map((d) => (/\d/.test(d) ? fa[Number(d)] : d))
    .join('')
}

export interface BriefBundle {
  brief: SessionBrief
  scenario: PickedScenario
  /** every known word lemma — the i+1 checker's allowlist */
  knownLemmas: string[]
  tokenEstimate: number
  /** M8: the planner's mix for this session (40:25:20:15 + probes p=0.3) */
  plan: SessionPlan
}

export interface BriefUserRow {
  id: string
  cefrComputed: string | null
  cefrSelf: string | null
  goal: string
  interests: string
  correctionStyle: string
  /** onboarding preference; null/undefined → default below (docs/02 User) */
  dailyMinutes?: number | null
}

export function parseInterests(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/**
 * Build the session brief from the user's real state.
 * Deterministic for the same (rows, now): no Math.random anywhere.
 */
export async function buildBriefBundle(user: BriefUserRow, now: Date): Promise<BriefBundle> {
  const graph = loadGraph('en')
  const rows = await db.userNodeState.findMany({ where: { userId: user.id } })
  const states = rows.map(rowToState)

  // states keyed by node (any skill)
  const byNode = new Map<string, NodeSkillState[]>()
  for (const s of states) {
    const list = byNode.get(s.nodeId) ?? []
    list.push(s)
    byNode.set(s.nodeId, list)
  }

  // ── known lexicon: word nodes with ANY non-locked state, per CEFR band ──
  const knownWordNodes = graph.nodes.filter(
    (n) => n.type === 'word' && (byNode.get(n.id) ?? []).some((s) => NON_LOCKED.includes(s.displayState)),
  )
  const knownBands = { A1: 0, A2: 0, B1: 0 }
  for (const n of knownWordNodes) {
    if (n.cefr === 'A1') knownBands.A1++
    else if (n.cefr === 'A2') knownBands.A2++
    else if (n.cefr === 'B1') knownBands.B1++
  }
  const sampleLemmas = [...knownWordNodes]
    .sort((a, b) => (a.frequencyRank ?? 1e9) - (b.frequencyRank ?? 1e9))
    .slice(0, 48) // engine slices again to BRIEF_MAX_SAMPLE_LEMMAS
    .map((n) => n.title)

  // ── weak nodes: engine ranking, deduped per node (best skill wins) ──
  const meta = new Map(graph.nodes.map((n) => [n.id, { title: n.title, glossFa: n.glossFa }]))
  const seen = new Set<string>()
  const weakNodes: BriefNodeRef[] = []
  for (const ref of rankWeakNodes(states, meta, now)) {
    if (seen.has(ref.id)) continue
    seen.add(ref.id)
    weakNodes.push(ref)
  }

  // ── frontier: available, never practiced — top-frequency first ──
  const avail = computeAvailability({
    nodes: graph.nodes,
    edges: graph.edges,
    states: byNode,
    lang: 'en',
  })
  const frontier = frontierNodes(avail)
    .sort((a, b) => {
      const ra = a.node.frequencyRank ?? 1e9
      const rb = b.node.frequencyRank ?? 1e9
      if (ra !== rb) return ra - rb
      const ca = CEFR_ORDER[(a.node.cefr ?? 'B1') as keyof typeof CEFR_ORDER] ?? 3
      const cb = CEFR_ORDER[(b.node.cefr ?? 'B1') as keyof typeof CEFR_ORDER] ?? 3
      return ca - cb
    })
    .map((a) => ({ id: a.node.id, title: a.node.title, glossFa: a.node.glossFa }))

  // ── active error patterns from recent confident errors ──
  const since = new Date(now.getTime() - ERROR_PATTERN_WINDOW_DAYS * 24 * 3600 * 1000)
  const errRows = await db.evidence.findMany({
    where: { userId: user.id, disputed: false, outcome: 'error', confidence: { gte: 0.6 }, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: { errorType: true },
  })
  const counts = new Map<string, number>()
  for (const r of errRows) {
    const key = r.errorType ?? 'unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const activeErrorPatterns = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => ({
      id: `err:${type}`,
      desc: `${ERROR_TYPE_FA[type] ?? type} (${faDigits(count)} بار اخیر)`,
    }))

  // ── M8 planner (docs/03 §C): the 40:25:20:15 mix bounds the session's
  // content and the p≈0.3 probe flip picks ride-along delayed-test nodes.
  // Probed nodes are then REMOVED from the practice material (weak/frontier/
  // mustElicit) — never practiced in-session, per docs/03 §A6 no-warm-up. ──
  const dailyMinutes = user.dailyMinutes ?? 15
  const dueReviews = states.filter(
    (s) => !s.masteredAt && s.reps > 0 && s.due !== null && s.due.getTime() <= now.getTime(),
  )
  const day = now.toISOString().slice(0, 10)
  const interests = parseInterests(user.interests)
  const { eligible: probeCandidates } = await collectDelayedTestStatus(user.id, now)
  const plan = planSession({
    dueReviews,
    frontier,
    remedial: weakNodes,
    interestFlavor: interests[0] ?? null,
    dailyMinutes,
    delayTestCandidates: probeCandidates.map((c) => c.state),
    rng: rngFromSeed(`${user.id}:${day}:plan`),
  })
  const probeIds = new Set(plan.delayedTestProbes.map((s) => s.nodeId))
  const plannedWeak = weakNodes.filter((w) => !probeIds.has(w.id))
  const plannedFrontier = frontier.filter((f) => !probeIds.has(f.id))

  // ── scenario: deterministic per (user, day) ──
  const resolveNode = (nodeId: string): BriefNodeRef | null => {
    const n = graph.byId.get(nodeId)
    return n ? { id: n.id, title: n.title, glossFa: n.glossFa } : null
  }
  const scenario = pickScenario(user.goal, `${user.id}:${day}`, resolveNode)
  const plannedScenario = {
    ...scenario,
    mustElicit: scenario.mustElicit.filter((m) => !probeIds.has(m.id)),
  }

  const brief = buildBrief({
    user: {
      level: user.cefrComputed ?? user.cefrSelf ?? 'A1',
      goal: user.goal,
      interests: parseInterests(user.interests),
      correctionStyle: (user.correctionStyle === 'end_of_session' ? 'end_of_session' : 'immediate'),
      tone: 'warm',
    },
    knownBands,
    sampleLemmas,
    weakNodes: plannedWeak,
    frontierNodes: plannedFrontier,
    activeErrorPatterns,
    scenario: {
      title: plannedScenario.title,
      role: plannedScenario.role,
      mustElicit: plannedScenario.mustElicit,
    },
  })

  const bundle: BriefBundle = {
    brief,
    scenario: plannedScenario,
    knownLemmas: knownWordNodes.map((n) => n.title),
    tokenEstimate: estimateBriefTokens(brief),
    plan,
  }
  return boundToBudget(bundle)
}

/**
 * Known-lemma allowlist for the i+1 checker (docs/03 §C): titles of word nodes
 * the user has ANY non-locked state in. Function words are exempted separately
 * inside the checker, so they don't need to live here.
 */
export async function getKnownLemmas(userId: string): Promise<string[]> {
  const graph = loadGraph('en')
  const rows = await db.userNodeState.findMany({
    where: { userId, displayState: { in: [...NON_LOCKED] } },
    select: { nodeId: true },
  })
  const known = new Set(rows.map((r) => r.nodeId))
  return graph.nodes.filter((n) => n.type === 'word' && known.has(n.id)).map((n) => n.title)
}

/**
 * Enforce the ≤1.5k-token brief budget (docs/03 §C) by trimming the softest
 * signal first: error patterns → weak nodes → frontier → sample lemmas.
 */
export function boundToBudget(bundle: BriefBundle, budget = BRIEF_TOKEN_BUDGET): BriefBundle {
  let b = bundle.brief
  const rebuild = (): BriefBundle => ({
    ...bundle,
    brief: b,
    tokenEstimate: estimateBriefTokens(b),
  })

  if (estimateBriefTokens(b) <= budget) return rebuild()

  b = { ...b, activeErrorPatterns: b.activeErrorPatterns.slice(0, 1) }
  if (estimateBriefTokens(b) <= budget) return rebuild()

  b = { ...b, weakNodes: b.weakNodes.slice(0, 2) }
  if (estimateBriefTokens(b) <= budget) return rebuild()

  b = { ...b, frontierNodes: b.frontierNodes.slice(0, 2) }
  if (estimateBriefTokens(b) <= budget) return rebuild()

  b = {
    ...b,
    knownLexicon: { ...b.knownLexicon, sampleLemmas: b.knownLexicon.sampleLemmas.slice(0, 8) },
  }
  return rebuild() // final — should never exceed the budget; test pins this
}
