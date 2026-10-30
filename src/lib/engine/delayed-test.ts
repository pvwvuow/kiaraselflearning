/**
 * Delayed tests & confirmatory sessions (docs/03 §A6, docs/00 C2).
 * Pure machinery: eligibility gates, probe sampling, fresh-context building
 * and probe grading. `now` and `rng` are ALWAYS injected — no clock, no
 * ambient randomness (tests/engine/purity.test.ts enforces this).
 *
 * Design decisions recorded in AGENT_STATE.md (M8):
 *  - "no unresolved gap" = the FSRS card is still Relearning (lapse not yet
 *    repaired) — a deterministic, rebuildable reading of §A6.
 *  - Mastery pass ALSO applies a `Good` to the card so a mastered node gets a
 *    natural maintenance-probe schedule (due + 3d age gate); §A6's fail path
 *    (Again + 7d) is unchanged.
 *  - Post-mastery probes ("a mastered node that fails 2 subsequent delayed
 *    probes → learning") ride the same card schedule — they are due when the
 *    card is due and ≥3d old, plus the 7d retry window after a failed probe.
 *  - Probeable node types exclude `error_pattern` (cued-recall production
 *    items do not measure "the error stopped appearing").
 */
import { ENGINE_CONFIG } from './config'
import { masteryEligibility } from './state'
import type { EngineNode, EvidenceItem, NodeSkillState, Skill } from './types'

// ── families for fresh contexts (cued recall — the item names its target,
//    what stays secret is WHICH nodes are sampled, per docs/00 C2) ──

export interface ContextFamily {
  id: string
  /** English situation frame; the target + Persian gloss are appended */
  frame: string
}

export const CONTEXT_FAMILIES: readonly ContextFamily[] = [
  { id: 'travel', frame: 'You are talking with a fellow traveler at the airport hotel.' },
  { id: 'work', frame: 'You are writing a short message to a colleague at work.' },
  { id: 'daily', frame: 'You are chatting with a friend about weekend plans.' },
  { id: 'study', frame: 'You are answering an exam-style writing prompt.' },
  { id: 'shopping', frame: 'You are at a small shop deciding what to buy.' },
  { id: 'health', frame: 'You are explaining how you feel at a clinic.' },
]

/** node types a cued-recall production probe can measure */
export const PROBEABLE_NODE_TYPES: readonly EngineNode['type'][] = [
  'word',
  'chunk',
  'grammar_pattern',
  'pragmatic_skill',
]

// ── eligibility (docs/03 §A6 gate, full form) ──

/** DB-derived context flags (wiring layer computes them from Evidence rows) */
export interface ProbeContextFlags {
  /** unresolved gap = FSRS card still Relearning */
  openGap: boolean
  /** any of the last 2 sessions touching this (node × skill) used hints */
  hintAssistedRecent: boolean
}

const DAY_MS = 86_400_000

/** pre-mastery confirmation probe: due when pendingDelayTest and ≥3d old */
export function confirmationProbeDue(state: NodeSkillState, now: Date): boolean {
  return (
    masteryEligibility(state, now) &&
    state.pendingDelayTest &&
    state.delayTestEligibleAt !== null &&
    now.getTime() >= state.delayTestEligibleAt.getTime()
  )
}

/** post-mastery maintenance probe: the card is due (and ≥3d old), 7d retry honored */
export function maintenanceProbeDue(state: NodeSkillState, now: Date): boolean {
  if (!state.masteredAt || !state.lastReviewAt) return false
  const gates: number[] = [state.lastReviewAt.getTime() + ENGINE_CONFIG.MASTERY_MIN_AGE_DAYS * DAY_MS]
  if (state.due) gates.push(state.due.getTime())
  if (state.delayTestEligibleAt) gates.push(state.delayTestEligibleAt.getTime())
  return now.getTime() >= Math.max(...gates)
}

/**
 * Full §A6 eligibility. The base strength gates (reps ≥ 4, S ≥ 21d, ≥3d old)
 * and "no unresolved gap" + "not hint-assisted in the last 2 sessions" apply
 * to CONFIRMATION probes. MAINTENANCE probes (already-mastered nodes) are
 * gated by the card schedule + retry window only: the card being in
 * Relearning is exactly what the probe re-tests — blocking on it would make
 * the §A6 revocation path unreachable (a failed maintenance probe always
 * lands the card in Relearning, and mastered nodes are never re-practiced).
 * The hint gate stays for both: recent help means the memory is unproven.
 */
export function probeEligible(state: NodeSkillState, now: Date, flags: ProbeContextFlags): boolean {
  if (flags.hintAssistedRecent) return false
  if (state.masteredAt) return maintenanceProbeDue(state, now)
  if (flags.openGap) return false
  return confirmationProbeDue(state, now)
}

// ── sampling (≤ 2 per session, stochastic via injected rng) ──

export interface ProbeCandidate {
  state: NodeSkillState
  node: EngineNode
  /** true when this is a maintenance probe of an already-mastered node */
  postMastery: boolean
}

/** deterministic partial Fisher-Yates; keeps first `max` after shuffle */
export function selectProbeNodes<T>(candidates: T[], max: number, rng: () => number): T[] {
  const pool = [...candidates]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, max)
}

// ── fresh contexts (3 per node, each from a distinct family ≠ practice) ──

export interface ConfirmatoryContext {
  /** 0-based within its probe */
  index: number
  family: string
  /** full tutor-message text shown to the learner */
  text: string
}

export function buildConfirmatoryContexts(input: {
  node: EngineNode
  /** scenario family of recent practice — never used for probe contexts */
  practiceFamily: string
  rng: () => number
}): ConfirmatoryContext[] {
  const { node, practiceFamily, rng } = input
  const pool = CONTEXT_FAMILIES.filter((f) => f.id !== practiceFamily)
  // pick 3 distinct families deterministically
  const shuffled = selectProbeNodes(pool, ENGINE_CONFIG.DELAY_TEST_CONTEXTS, rng)
  const target = `«${node.title}»${node.glossFa ? ` (${node.glossFa})` : ''}`
  return shuffled.map((f, index) => ({
    index,
    family: f.id,
    text: `${f.frame}\nWrite ONE correct English sentence using ${target}.`,
  }))
}

// ── probe plan (persisted on the ChatSession row as JSON) ──

export interface ProbeSpec {
  nodeId: string
  skill: Skill
  postMastery: boolean
  contexts: ConfirmatoryContext[]
}

export interface StoredProbePlan {
  /** 0 = explicit confirmatory session; 2 = ride-along (no warm-up) */
  warmupTurns: number
  probes: ProbeSpec[]
}

/**
 * Which probe/context does the Nth user turn answer? (1-based userTurnCount.)
 * Returns null for practice turns and for turns beyond the plan.
 */
export function probeSlotFor(
  plan: StoredProbePlan | null,
  userTurnCount: number,
): { probeIndex: number; contextIndex: number; probe: ProbeSpec } | null {
  if (!plan || plan.probes.length === 0) return null
  const idx = userTurnCount - 1 - plan.warmupTurns // 0-based context slot
  if (idx < 0) return null
  const probeIndex = Math.floor(idx / ENGINE_CONFIG.DELAY_TEST_CONTEXTS)
  if (probeIndex >= plan.probes.length) return null
  return { probeIndex, contextIndex: idx % ENGINE_CONFIG.DELAY_TEST_CONTEXTS, probe: plan.probes[probeIndex] }
}

// ── grading (docs/03 §A6: ≥ 2/3 correct with confidence ≥ 0.8) ──

export interface ProbeGrade {
  correct: number
  total: number
  minConfidence: number
}

/**
 * Grade one probed node from its context answers (evidence items per ASKED
 * context, in order). A context counts correct when it has a confident
 * `correct` item and NO confident contradicting `error` item. Contexts the
 * analyst stayed silent on count as NOT correct.
 *
 * minConfidence = min over the CORRECTNESS-ESTABLISHING items only (docs/03
 * §A6: "≥ 2/3 items correct with confidence ≥ 0.8"). An error item's
 * confidence measures the analyst's certainty THAT it was an error — it must
 * not dilute the production-quality gate; the 2/3 ratio already prices the
 * error in.
 *
 * Un-asked contexts (session ended early) are handled by the caller: fewer
 * than DELAY_TEST_CONTEXTS asked → the probe is skipped entirely (fair retry).
 */
export function gradeProbe(askedContexts: EvidenceItem[][]): ProbeGrade {
  const total = askedContexts.length
  let correct = 0
  let minConfidence = 1
  for (const items of askedContexts) {
    const confidentError = items.some(
      (i) => i.outcome === 'error' && i.confidence >= ENGINE_CONFIG.CONFIDENT_EVIDENCE,
    )
    const establishing = items.filter(
      (i) => i.outcome === 'correct' && i.confidence >= ENGINE_CONFIG.DELAY_TEST_MIN_CONFIDENCE,
    )
    if (establishing.length > 0 && !confidentError) {
      correct++
      for (const i of establishing) minConfidence = Math.min(minConfidence, i.confidence)
    }
  }
  return { correct, total, minConfidence }
}
