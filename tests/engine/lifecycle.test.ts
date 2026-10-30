/**
 * The S1–S8 lifecycle from docs/03 §A3 — the philosophy in numbers.
 * These expected values were produced by `bun scripts/fsrs-probe.ts` (ts-fsrs v6,
 * request_retention 0.85) and are the contract the engine must reproduce.
 */
import { describe, expect, it } from 'vitest'
import { applySessionReview } from '@/lib/engine/state'
import type { EvidenceItem, NodeSkillState } from '@/lib/engine/types'

const NODE = 'en:chunk:could-you'
const USER = 'u_test'
const T = (s: string) => new Date(s)

function evs(items: Array<[EvidenceItem['outcome'], number]>): EvidenceItem[] {
  return items.map(([outcome, confidence]) => ({
    nodeId: NODE,
    skill: 'writing' as const,
    outcome,
    confidence,
  }))
}

describe('S1–S8 lifecycle (docs/03 §A3 numeric table)', () => {
  let state: NodeSkillState | null = null
  let priorErrorSessions = 0

  it('S1 d0 — first exposure, 2× correct → Good, S≈2.31, D≈2.12, Learning', () => {
    const r = applySessionReview({
      state,
      items: evs([
        ['correct', 0.9],
        ['correct', 0.85],
      ]),
      priorErrorSessions,
      now: T('2026-11-01T10:00:00Z'),
      nodeType: 'chunk',
      userId: USER,
    })
    expect(r.rating).toBe('Good')
    expect(r.updated.stability).toBeCloseTo(2.31, 1)
    expect(r.updated.difficulty).toBeCloseTo(2.12, 1)
    expect(r.updated.fsrsState).toBe('Learning')
    expect(r.updated.reps).toBe(1)
    expect(r.updated.displayState).toBe('learning')
    state = r.updated
  })

  it('S2 d2 — correct → Good, S≈10.96, Review', () => {
    const r = applySessionReview({
      state,
      items: evs([['correct', 0.95]]),
      priorErrorSessions,
      now: T('2026-11-03T10:00:00Z'),
      nodeType: 'chunk',
      userId: USER,
    })
    expect(r.rating).toBe('Good')
    expect(r.updated.stability).toBeCloseTo(10.96, 1)
    expect(r.updated.fsrsState).toBe('Review')
    state = r.updated
  })

  it('S3 d6 — single error (obs=1 < 2) → Hard: NO demotion, S grows, D jumps', () => {
    const r = applySessionReview({
      state,
      items: evs([['error', 0.95]]),
      priorErrorSessions,
      now: T('2026-11-07T10:00:00Z'),
      nodeType: 'chunk',
      userId: USER,
    })
    expect(r.rating).toBe('Hard')
    expect(r.gapConfirmed).toBe(false)
    expect(r.updated.stability).toBeCloseTo(20.51, 1)
    expect(r.updated.difficulty).toBeCloseTo(4.75, 1)
    expect(r.updated.lapses).toBe(0)
    priorErrorSessions = r.errorSessionsAfter // 1
    state = r.updated
  })

  it('S4 d13 — 3rd error across sessions → gap confirmed → Again, lapse, S collapses', () => {
    const r = applySessionReview({
      state,
      items: evs([
        ['error', 0.9],
        ['error', 0.85],
      ]),
      priorErrorSessions, // 1 prior → +1 = 2 ≥ threshold
      now: T('2026-11-14T10:00:00Z'),
      nodeType: 'chunk',
      userId: USER,
    })
    expect(r.rating).toBe('Again')
    expect(r.gapConfirmed).toBe(true)
    expect(r.updated.fsrsState).toBe('Relearning')
    expect(r.updated.lapses).toBe(1)
    expect(r.updated.stability).toBeCloseTo(1.8, 1)
    expect(r.updated.difficulty).toBeCloseTo(8.26, 1)
    priorErrorSessions = r.errorSessionsAfter
    state = r.updated
  })

  it('S5–S8 — steady recovery to S≈36.77 → mastery-eligible', () => {
    const steps: Array<[string, EvidenceItem['outcome']]> = [
      ['2026-11-15T10:00:00Z', 'correct'],
      ['2026-11-20T10:00:00Z', 'correct'],
      ['2026-12-01T10:00:00Z', 'correct'],
      ['2026-12-20T10:00:00Z', 'correct'],
    ]
    for (const [when, outcome] of steps) {
      const r = applySessionReview({
        state,
        items: evs([[outcome, 0.9]]),
        priorErrorSessions,
        now: new Date(when),
        nodeType: 'chunk',
        userId: USER,
      })
      expect(r.rating).toBe('Good')
      state = r.updated
      priorErrorSessions = r.errorSessionsAfter
    }
    expect(state.reps).toBe(8)
    expect(state.stability).toBeCloseTo(36.77, 0)
    expect(state.lapses).toBe(1)
    // mastery eligibility (reps≥4, S≥21d, age≥3d since lastReview 12-20)
    expect(state.pendingDelayTest).toBe(true)
    expect(state.delayTestEligibleAt?.toISOString().slice(0, 10)).toBe('2026-12-23')
  })
})

describe('aggregation edge behavior', () => {
  it('insufficient weight → rating null, state untouched, evidence still consumable', () => {
    const r = applySessionReview({
      state: null,
      items: evs([['correct', 0.3]]),
      priorErrorSessions: 0,
      now: T('2026-11-01T10:00:00Z'),
      nodeType: 'chunk',
      userId: USER,
    })
    expect(r.rating).toBeNull()
    expect(r.updated.reps).toBe(0)
    expect(r.updated.displayState).toBe('available')
  })

  it('disputed evidence never triggers updates', () => {
    const r = applySessionReview({
      state: null,
      items: evs([['error', 0.95]]).map((e) => ({ ...e, disputed: true })),
      priorErrorSessions: 0,
      now: T('2026-11-01T10:00:00Z'),
      nodeType: 'chunk',
      userId: USER,
    })
    expect(r.rating).toBeNull()
    expect(r.errorSessionsAfter).toBe(0)
  })
})
