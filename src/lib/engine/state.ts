/**
 * State engine — display states, session review application, propagation,
 * root-cause attribution, mastery gating & fading (docs/03 §A3–A7).
 * Pure: `now` injected; no I/O.
 */
import { ENGINE_CONFIG } from './config'
import { aggregateSession, sessionCountsAsErrorObservation, toRating } from './grading'
import { applyRating, cardToStateFields, retrievability } from './fsrs'
import type {
  ApplyReviewInput,
  ApplyReviewResult,
  DisplayState,
  EngineEdge,
  EngineNode,
  EvidenceItem,
  NodeSkillState,
  PropagationEmit,
  Skill,
} from './types'

// ── constructors ──

export function newState(
  userId: string,
  nodeId: string,
  skill: Skill,
  displayState: DisplayState = 'available',
): NodeSkillState {
  return {
    userId,
    nodeId,
    skill,
    stability: 0,
    difficulty: 0,
    due: null,
    lastReviewAt: null,
    reps: 0,
    lapses: 0,
    learningSteps: 0,
    fsrsState: 'New',
    displayState,
    strength: 0,
    pendingDelayTest: false,
    delayTestEligibleAt: null,
    masteredAt: null,
    lastAppliedEvidenceId: null,
  }
}

// ── display state (docs/03 §A5) ──

/**
 * Recompute the display state for an EXISTING state row.
 * (locked/available for not-yet-tracked nodes is graph-level; see availability.ts)
 */
export function computeDisplayState(state: NodeSkillState, now: Date): DisplayState {
  if (state.masteredAt) {
    return isFading(state, now) ? 'fading' : 'mastered'
  }
  if (state.displayState === 'assumed_known' && state.reps === 0) return 'assumed_known'
  if (state.reps === 0) return state.displayState // available (planted, not yet practiced)
  return isFading(state, now) ? 'fading' : 'learning'
}

/** fading = R < FADING_R, or overdue > FADING_OVERDUE_FACTOR × interval (and > min days) */
export function isFading(state: NodeSkillState, now: Date): boolean {
  if (!state.lastReviewAt || state.reps === 0) return false
  const r = retrievability(state, now)
  if (r !== null && r < ENGINE_CONFIG.FADING_R) return true
  if (state.due) {
    const interval = state.due.getTime() - state.lastReviewAt.getTime()
    const overdueBy = now.getTime() - state.due.getTime()
    if (
      interval > 0 &&
      overdueBy > ENGINE_CONFIG.FADING_OVERDUE_FACTOR * interval &&
      overdueBy > ENGINE_CONFIG.FADING_OVERDUE_MIN_DAYS * 86_400_000
    ) {
      return true
    }
  }
  return false
}

/** soft strength update: EMA of recent aggregated outcomes, used by propagation & UI */
export function updateStrength(state: NodeSkillState, aggValue: number, weight: number): number {
  if (weight <= 0) return state.strength
  const alpha = 0.4 // fast enough to react to a gap, slow enough not to flip-flop
  const target = (aggValue + 1) / 2 // map −1..+1 → 0..1
  return Math.min(1, Math.max(0, state.strength + alpha * weight * (target - state.strength)))
}

// ── session review application (docs/03 §A7 core step) ──

export function applySessionReview(input: ApplyReviewInput): ApplyReviewResult {
  const { state, items, priorErrorSessions, now, nodeType, userId } = input
  const nodeId = state?.nodeId ?? items[0]?.nodeId
  const skill = state?.skill ?? items[0]?.skill
  if (!nodeId || !skill) throw new Error('applySessionReview: missing nodeId/skill')

  const base: NodeSkillState = state ?? newState(userId, nodeId, skill)
  const agg = aggregateSession(items)
  const appliedEvidenceIds = items.filter((i) => !i.disputed).map((i) => i.id).filter((x): x is string => !!x)

  const thisSessionErrors = sessionCountsAsErrorObservation(items)
  const errorSessionsAfter = priorErrorSessions + (thisSessionErrors ? 1 : 0)

  const rating = toRating(agg, {
    firstExposure: base.reps === 0,
    priorErrorSessions,
    reps: base.reps,
    nodeType,
  })

  let updated: NodeSkillState = { ...base }
  if (rating) {
    const card = applyRating(base, rating, now)
    updated = {
      ...updated,
      ...cardToStateFields(card),
      displayState: 'learning', // recomputed below
    }
  }
  // strength tracks the raw aggregate even when no rating was issued
  updated.strength = updateStrength(base, agg.agg, Math.min(1, agg.totalWeight))
  updated.displayState = computeDisplayState(updated, now)

  // mastery candidacy: strength gate now; the AGE gate is applied by the
  // planner via isDelayTestDue (probe allowed only ≥3d after lastReview) —
  // docs/03 §A6: pendingDelayTest means "candidate", delayTestEligibleAt is
  // the earliest legal probe time.
  const strongEnough =
    !updated.masteredAt &&
    updated.reps >= ENGINE_CONFIG.MASTERY_MIN_REPS &&
    updated.stability >= ENGINE_CONFIG.MASTERY_MIN_STABILITY
  if (strongEnough) {
    updated.pendingDelayTest = true
    if (!updated.delayTestEligibleAt) {
      updated.delayTestEligibleAt = new Date(
        (updated.lastReviewAt ?? now).getTime() + ENGINE_CONFIG.MASTERY_MIN_AGE_DAYS * 86_400_000,
      )
    }
  }

  if (appliedEvidenceIds.length > 0) {
    updated.lastAppliedEvidenceId = appliedEvidenceIds[appliedEvidenceIds.length - 1]
  }

  return {
    rating,
    updated,
    errorSessionsAfter,
    gapConfirmed:
      rating === 'Again' &&
      thisSessionErrors &&
      priorErrorSessions + 1 >=
        (nodeType === 'error_pattern'
          ? ENGINE_CONFIG.GAP_SESSION_THRESHOLD_ERROR_PATTERN
          : ENGINE_CONFIG.GAP_SESSION_THRESHOLD),
    appliedEvidenceIds,
  }
}

// ── propagation (docs/03 §A4) ──

/**
 * Downward propagation: a strong success on `node` emits low-weight positive
 * evidence for weak/fading prerequisites. NEVER enough to master anything.
 */
export function propagateFromSuccess(input: {
  node: EngineNode
  skill: Skill
  items: EvidenceItem[]
  agg: number
  edges: EngineEdge[] // prerequisite edges of the whole graph (filtered inside)
  prereqStates: Map<string, NodeSkillState | null> // by node id
  sessionId: string
  turnId: string
  userId: string
}): PropagationEmit[] {
  const { node, skill, items, agg, edges, prereqStates } = input
  if (agg < ENGINE_CONFIG.PROPAGATION_MIN_AGG) return []
  const confidentItems = items.filter(
    (i) =>
      !i.disputed &&
      i.confidence >= ENGINE_CONFIG.PROPAGATION_MIN_ITEM_CONFIDENCE &&
      (i.outcome === 'correct' || i.outcome === 'slip_self_corrected'),
  )
  // ALL items must be confidently positive for propagation to fire (docs/03 §A4)
  if (confidentItems.length === 0 || confidentItems.length !== items.filter((i) => !i.disputed).length) {
    return []
  }

  const emits: PropagationEmit[] = []
  for (const edge of edges) {
    if (edge.type !== 'prerequisite' || edge.toId !== node.id) continue
    const pState = prereqStates.get(edge.fromId) ?? null
    // rescue fading/learning prerequisites only — healthy ones need nothing
    if (!pState || (pState.displayState !== 'fading' && pState.displayState !== 'learning')) continue
    const conf = Math.min(
      1,
      ENGINE_CONFIG.PROPAGATION_FACTOR * Math.max(...confidentItems.map((i) => i.confidence)),
    )
    emits.push({
      nodeId: edge.fromId,
      skill,
      outcome: 'correct',
      confidence: conf,
      propagated: true,
      hintUsed: false,
      l1Interference: false,
      errorType: null,
      produced: null,
      expected: null,
      responseLatencyMs: null,
      disputed: false,
    })
  }
  return emits
}

/**
 * Upward root-cause re-attribution: a confirmed gap on `node` with a weak
 * prerequisite routes the error to that prerequisite (bounded, logged, reversible).
 */
export function rootCauseAttribution(input: {
  node: EngineNode
  gapConfirmed: boolean
  items: EvidenceItem[]
  edges: EngineEdge[]
  prereqStates: Map<string, NodeSkillState | null>
}): { routeToNodeId: string; evidence: EvidenceItem } | null {
  const { node, gapConfirmed, items, edges, prereqStates } = input
  if (!gapConfirmed) return null
  const errorItem = items.find(
    (i) => i.outcome === 'error' && i.confidence >= ENGINE_CONFIG.CONFIDENT_EVIDENCE && !i.disputed,
  )
  if (!errorItem) return null

  // weakest prerequisite by strength
  let weakest: { id: string; strength: number } | null = null
  for (const edge of edges) {
    if (edge.type !== 'prerequisite' || edge.toId !== node.id) continue
    const pState = prereqStates.get(edge.fromId) ?? null
    const strength = pState?.strength ?? 0
    if (strength < ENGINE_CONFIG.ROOT_CAUSE_MAX_STRENGTH) {
      if (!weakest || strength < weakest.strength) weakest = { id: edge.fromId, strength }
    }
  }
  if (!weakest) return null

  return {
    routeToNodeId: weakest.id,
    evidence: {
      ...errorItem,
      nodeId: weakest.id,
      confidence: errorItem.confidence * ENGINE_CONFIG.ROOT_CAUSE_CONFIDENCE_FACTOR,
    },
  }
}

// ── mastery & delayed tests (docs/03 §A6) ──

export function masteryEligibility(state: NodeSkillState, now: Date): boolean {
  if (state.masteredAt) return false
  if (state.reps < ENGINE_CONFIG.MASTERY_MIN_REPS) return false
  if (state.stability < ENGINE_CONFIG.MASTERY_MIN_STABILITY) return false
  if (!state.lastReviewAt) return false
  const ageDays = (now.getTime() - state.lastReviewAt.getTime()) / 86_400_000
  return ageDays >= ENGINE_CONFIG.MASTERY_MIN_AGE_DAYS
}

export function isDelayTestDue(state: NodeSkillState, now: Date): boolean {
  if (!state.pendingDelayTest || state.masteredAt) return false
  if (!state.delayTestEligibleAt) return false
  return now.getTime() >= state.delayTestEligibleAt.getTime()
}

/**
 * Apply a delayed-test outcome. Pass = mastery. Fail = Again + retry window.
 * Revocation after MASTERY_REVOKE_FAILS failed probes since mastery.
 */
export function applyDelayedTestOutcome(
  state: NodeSkillState,
  outcome: {
    correct: number
    total: number
    minConfidence: number
    failedProbesSinceMastery: number
  },
  now: Date,
): { updated: NodeSkillState; mastered: boolean; revoked: boolean } {
  const pass =
    outcome.total >= ENGINE_CONFIG.DELAY_TEST_CONTEXTS &&
    outcome.correct / outcome.total >= ENGINE_CONFIG.DELAY_TEST_PASS_RATIO &&
    outcome.minConfidence >= ENGINE_CONFIG.DELAY_TEST_MIN_CONFIDENCE

  let updated: NodeSkillState = { ...state }

  if (pass && !state.masteredAt) {
    updated.masteredAt = now
    updated.displayState = 'mastered'
    updated.pendingDelayTest = false
    return { updated, mastered: true, revoked: false }
  }

  // failed probe (either pre-mastery or post-mastery check)
  const card = applyRating(state, 'Again', now)
  updated = { ...updated, ...cardToStateFields(card) }
  updated.pendingDelayTest = false
  updated.delayTestEligibleAt = new Date(
    now.getTime() + ENGINE_CONFIG.DELAY_TEST_RETRY_DAYS * 86_400_000,
  )

  if (state.masteredAt) {
    // mastery being challenged
    if (outcome.failedProbesSinceMastery + 1 >= ENGINE_CONFIG.MASTERY_REVOKE_FAILS) {
      updated.masteredAt = null
      updated.displayState = 'learning'
      return { updated, mastered: false, revoked: true }
    }
    // keep mastery but record the warning by leaving masteredAt set
    updated.masteredAt = state.masteredAt
    updated.displayState = 'learning' // under scrutiny visually
    return { updated, mastered: false, revoked: false }
  }

  updated.displayState = computeDisplayState(updated, now)
  return { updated, mastered: false, revoked: false }
}
