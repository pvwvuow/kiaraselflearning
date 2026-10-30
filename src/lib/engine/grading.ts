/**
 * Grading — evidence → session aggregate → FSRS rating (docs/03 §A1–A2).
 * Pure functions; deterministic; all constants from config.
 *
 * Philosophy encoded here:
 *  - one error is an OBSERVATION, never a verdict (no instant demotion)
 *  - a GAP needs ≥ GAP_SESSION_THRESHOLD distinct sessions with confident errors
 *  - low-confidence evidence carries little weight; < MIN_AGG_WEIGHT total → no update
 */
import { ENGINE_CONFIG } from './config'
import type { EvidenceItem, FsrsRating, NodeType, Outcome, SessionAggregate } from './types'

/** numeric value of an outcome (docs/03 §A1) */
export function outcomeValue(outcome: Outcome): number {
  switch (outcome) {
    case 'correct':
      return 1
    case 'used_with_hint':
      return 0.5
    case 'slip_self_corrected':
      return 0.6
    case 'avoided':
      return 0
    case 'error':
      return -1
    case 'unknown':
      return 0 // excluded from the mean below via weight 0
  }
}

/** effective value: hints cap a "correct" at +0.5 (docs/03 §A1 edge rules) */
function effectiveValue(item: EvidenceItem): number {
  let v = outcomeValue(item.outcome)
  if (item.outcome === 'unknown') return 0
  if (item.outcome === 'correct' && item.hintUsed) v = Math.min(v, 0.5)
  return v
}

/** effective weight: unknown items weigh nothing */
function effectiveWeight(item: EvidenceItem): number {
  if (item.outcome === 'unknown') return 0
  return clamp(item.confidence, 0, 1)
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

/**
 * Aggregate one session's non-disputed evidence for one (nodeId, skill).
 * `propagated` items participate with their own (already low) confidence.
 */
export function aggregateSession(items: EvidenceItem[]): SessionAggregate {
  const included = items.filter((i) => !i.disputed && i.outcome !== 'unknown')
  let wSum = 0
  let vSum = 0
  let errorItems = 0
  let positiveItems = 0
  let hasHint = false
  for (const it of included) {
    const w = effectiveWeight(it)
    wSum += w
    vSum += w * effectiveValue(it)
    if (it.outcome === 'error' && it.confidence >= ENGINE_CONFIG.CONFIDENT_EVIDENCE) errorItems++
    if (
      (it.outcome === 'correct' || it.outcome === 'slip_self_corrected') &&
      it.confidence >= ENGINE_CONFIG.CONFIDENT_EVIDENCE &&
      !it.hintUsed
    ) {
      positiveItems++
    }
    if (it.hintUsed) hasHint = true
  }
  return {
    agg: wSum === 0 ? 0 : vSum / wSum,
    totalWeight: wSum,
    errorItems,
    positiveItems,
    hasError: errorItems > 0,
    hasHint,
    n: included.length,
  }
}

/** a confident error "observation" = this session contains at least one */
export function sessionCountsAsErrorObservation(items: EvidenceItem[]): boolean {
  return items.some(
    (i) =>
      !i.disputed &&
      i.outcome === 'error' &&
      i.confidence >= ENGINE_CONFIG.CONFIDENT_EVIDENCE,
  )
}

/**
 * Aggregate → FSRS rating (docs/03 §A2 table).
 * `priorErrorSessions` = distinct PAST sessions with confident errors (queried by caller).
 */
export function toRating(
  agg: SessionAggregate,
  ctx: {
    firstExposure: boolean
    priorErrorSessions: number
    reps: number
    nodeType: NodeType
  },
): FsrsRating | null {
  // not enough trustworthy signal → no FSRS update at all (docs/03 §A1)
  if (agg.totalWeight < ENGINE_CONFIG.MIN_AGG_WEIGHT) return null

  const gapThreshold =
    ctx.nodeType === 'error_pattern'
      ? ENGINE_CONFIG.GAP_SESSION_THRESHOLD_ERROR_PATTERN
      : ENGINE_CONFIG.GAP_SESSION_THRESHOLD

  const thisSessionErrors = agg.errorItems > 0
  const gapConfirmed = thisSessionErrors && ctx.priorErrorSessions + 1 >= gapThreshold

  if (ctx.firstExposure) {
    if (agg.agg >= 0.5) return 'Good'
    if (agg.agg >= 0.2) return 'Hard'
    return 'Again' // first exposure failed hard
  }

  // Easy needs corroboration: ≥2 confident positive items AND reps ≥ 3
  // (a single correct production is never proof of "easy" — docs/03 §A2)
  if (agg.agg >= 0.85 && !agg.hasError && !agg.hasHint && agg.positiveItems >= 2) {
    return ctx.reps >= 3 ? 'Easy' : 'Good'
  }
  if (agg.agg >= 0.5) return 'Good'
  if (agg.agg >= 0.2) return 'Hard'
  // agg < 0.2
  if (gapConfirmed) return 'Again'
  return 'Hard' // single error = observation, no demotion
}

/** exported for tests & logging */
export function isGapConfirmed(
  priorErrorSessions: number,
  currentSessionHasConfidentError: boolean,
  nodeType: NodeType,
): boolean {
  const threshold =
    nodeType === 'error_pattern'
      ? ENGINE_CONFIG.GAP_SESSION_THRESHOLD_ERROR_PATTERN
      : ENGINE_CONFIG.GAP_SESSION_THRESHOLD
  return currentSessionHasConfidentError && priorErrorSessions + 1 >= threshold
}
