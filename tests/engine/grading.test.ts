/**
 * Grading tests — encode the rules of docs/03 §A1–A2 exactly.
 */
import { describe, expect, it } from 'vitest'
import {
  aggregateSession,
  outcomeValue,
  sessionCountsAsErrorObservation,
  toRating,
} from '@/lib/engine/grading'
import type { EvidenceItem, Outcome } from '@/lib/engine/types'

function ev(outcome: Outcome, confidence: number, over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    nodeId: 'en:chunk:could-you',
    skill: 'writing',
    outcome,
    confidence,
    ...over,
  }
}

describe('outcomeValue', () => {
  it('maps outcomes to the documented values', () => {
    expect(outcomeValue('correct')).toBe(1)
    expect(outcomeValue('used_with_hint')).toBe(0.5)
    expect(outcomeValue('slip_self_corrected')).toBe(0.6)
    expect(outcomeValue('avoided')).toBe(0)
    expect(outcomeValue('error')).toBe(-1)
  })
})

describe('aggregateSession', () => {
  it('S1: two corrects (c .90/.85) → agg 1.00', () => {
    const a = aggregateSession([ev('correct', 0.9), ev('correct', 0.85)])
    expect(a.agg).toBeCloseTo(1.0, 5)
    expect(a.totalWeight).toBeCloseTo(1.75, 5)
    expect(a.errorItems).toBe(0)
  })

  it('S4: two errors (c .90/.85) → agg −1.00, 2 error items', () => {
    const a = aggregateSession([ev('error', 0.9), ev('error', 0.85)])
    expect(a.agg).toBeCloseTo(-1.0, 5)
    expect(a.errorItems).toBe(2)
  })

  it('hint caps a correct at +0.5 (docs A1 edge rule)', () => {
    const a = aggregateSession([ev('correct', 0.9, { hintUsed: true })])
    expect(a.agg).toBe(0.5)
  })

  it('disputed items are excluded entirely', () => {
    const a = aggregateSession([
      ev('error', 0.9, { disputed: true }),
      ev('correct', 0.8),
    ])
    expect(a.agg).toBe(1)
    expect(a.n).toBe(1)
  })

  it('unknown items carry zero weight', () => {
    const a = aggregateSession([ev('unknown', 0.9), ev('correct', 0.8)])
    expect(a.agg).toBe(1)
    expect(a.n).toBe(1)
  })

  it('low-confidence evidence weighs little (weighted mean)', () => {
    const a = aggregateSession([ev('correct', 0.9), ev('error', 0.3)])
    expect(a.agg).toBeCloseTo((0.9 * 1 + 0.3 * -1) / 1.2, 5)
    expect(a.errorItems).toBe(0) // 0.3 < CONFIDENT_EVIDENCE
  })
})

describe('toRating', () => {
  const base = { firstExposure: false, priorErrorSessions: 0, reps: 2, nodeType: 'chunk' as const }

  it('S1: first exposure, agg 1.0 → Good (never Easy)', () => {
    expect(
      toRating(aggregateSession([ev('correct', 0.9), ev('correct', 0.85)]), {
        ...base,
        firstExposure: true,
        reps: 0,
      }),
    ).toBe('Good')
  })

  it('clean strong success with reps ≥ 3 AND ≥2 corroborating items → Easy', () => {
    expect(
      toRating(aggregateSession([ev('correct', 0.95), ev('correct', 0.9)]), { ...base, reps: 3 }),
    ).toBe('Easy')
  })

  it('single clean success → Good even with reps ≥ 3 (Easy needs corroboration)', () => {
    expect(
      toRating(aggregateSession([ev('correct', 0.95)]), { ...base, reps: 3 }),
    ).toBe('Good')
  })

  it('clean strong success with reps < 3 → Good', () => {
    expect(
      toRating(aggregateSession([ev('correct', 0.95)]), { ...base, reps: 2 }),
    ).toBe('Good')
  })

  it('S3: single error (errorObs=1 < 2) → Hard — NO instant demotion', () => {
    expect(
      toRating(aggregateSession([ev('error', 0.95)]), {
        ...base,
        priorErrorSessions: 0,
      }),
    ).toBe('Hard')
  })

  it('S4: error with priorErrorSessions=2 → Again (gap confirmed)', () => {
    expect(
      toRating(aggregateSession([ev('error', 0.9), ev('error', 0.85)]), {
        ...base,
        priorErrorSessions: 2,
      }),
    ).toBe('Again')
  })

  it('error_pattern nodes need 3 sessions (stricter threshold)', () => {
    expect(
      toRating(aggregateSession([ev('error', 0.9)]), {
        ...base,
        priorErrorSessions: 1,
        nodeType: 'error_pattern',
      }),
    ).toBe('Hard')
    expect(
      toRating(aggregateSession([ev('error', 0.9)]), {
        ...base,
        priorErrorSessions: 2,
        nodeType: 'error_pattern',
      }),
    ).toBe('Again')
  })

  it('total weight below MIN_AGG_WEIGHT → null (no FSRS update)', () => {
    const a = aggregateSession([ev('correct', 0.3)]) // weight 0.3 < 0.5
    expect(a.totalWeight).toBeLessThan(0.5)
    expect(toRating(a, base)).toBeNull()
  })

  it('mid aggregates map to Good/Hard bands', () => {
    expect(toRating(aggregateSession([ev('correct', 0.9, { hintUsed: true })]), base)).toBe('Good') // agg exactly 0.5 → Good band
    expect(toRating(aggregateSession([ev('used_with_hint', 0.9)]), base)).toBe('Good') // agg 0.5 → Good band
    expect(
      toRating(aggregateSession([ev('slip_self_corrected', 0.7), ev('avoided', 0.7)]), base),
    ).toBe('Hard') // agg 0.3 → Hard
  })
})

describe('sessionCountsAsErrorObservation', () => {
  it('only confident, non-disputed errors count', () => {
    expect(sessionCountsAsErrorObservation([ev('error', 0.7)])).toBe(true)
    expect(sessionCountsAsErrorObservation([ev('error', 0.5)])).toBe(false)
    expect(sessionCountsAsErrorObservation([ev('error', 0.9, { disputed: true })])).toBe(false)
    expect(sessionCountsAsErrorObservation([ev('correct', 0.9)])).toBe(false)
  })
})
