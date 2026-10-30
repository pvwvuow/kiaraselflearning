/**
 * State engine tests: propagation bounds, root-cause attribution,
 * mastery gating/revocation, fading thresholds (docs/03 §A4–A6).
 */
import { describe, expect, it } from 'vitest'
import {
  applyDelayedTestOutcome,
  computeDisplayState,
  isFading,
  masteryEligibility,
  newState,
  propagateFromSuccess,
  rootCauseAttribution,
} from '@/lib/engine/state'
import { retrievability } from '@/lib/engine/fsrs'
import type {
  EngineEdge,
  EngineNode,
  EvidenceItem,
  NodeSkillState,
} from '@/lib/engine/types'

const NOW = new Date('2026-11-01T10:00:00Z')
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

function node(id: string, over: Partial<EngineNode> = {}): EngineNode {
  return {
    id,
    type: 'chunk',
    lang: 'en',
    cefr: 'A2',
    frequencyRank: 900,
    title: id,
    glossFa: null,
    tags: [],
    ...over,
  }
}

function learningState(nodeId: string, over: Partial<NodeSkillState> = {}): NodeSkillState {
  return {
    ...newState('u1', nodeId, 'writing'),
    reps: 2,
    stability: 5,
    difficulty: 3,
    displayState: 'learning',
    fsrsState: 'Review',
    lastReviewAt: day(-3),
    due: day(4),
    ...over,
  }
}

// ── propagation ──

describe('propagateFromSuccess (docs A4)', () => {
  const edges: EngineEdge[] = [
    { fromId: 'en:grammar:past-simple', toId: 'en:chunk:used-to', type: 'prerequisite', weight: 1 },
    { fromId: 'en:word:would', toId: 'en:chunk:used-to', type: 'prerequisite', weight: 1 },
    { fromId: 'a', toId: 'b', type: 'related', weight: 1 }, // non-prerequisite ignored
  ]

  it('strong success emits low-weight positive evidence ONLY for weak prereqs', () => {
    const prereqStates = new Map<string, NodeSkillState | null>([
      ['en:grammar:past-simple', learningState('en:grammar:past-simple', { displayState: 'fading' })],
      ['en:word:would', learningState('en:word:would', { displayState: 'mastered', masteredAt: NOW })], // healthy → skipped
    ])
    const emits = propagateFromSuccess({
      node: node('en:chunk:used-to'),
      skill: 'writing',
      items: [{ nodeId: 'en:chunk:used-to', skill: 'writing', outcome: 'correct', confidence: 0.9 }],
      agg: 1.0,
      edges,
      prereqStates,
      sessionId: 's1',
      turnId: 't1',
      userId: 'u1',
    })
    expect(emits).toHaveLength(1)
    expect(emits[0].nodeId).toBe('en:grammar:past-simple')
    expect(emits[0].propagated).toBe(true)
    expect(emits[0].confidence).toBeCloseTo(0.35 * 0.9, 5) // factor × confidence
    expect(emits[0].outcome).toBe('correct')
  })

  it('never fires below PROPAGATION_MIN_AGG or with unconfident items', () => {
    const prereqStates = new Map<string, NodeSkillState | null>([
      ['en:grammar:past-simple', learningState('en:grammar:past-simple', { displayState: 'fading' })],
    ])
    const base = {
      node: node('en:chunk:used-to'),
      skill: 'writing' as const,
      edges,
      prereqStates,
      sessionId: 's1',
      turnId: 't1',
      userId: 'u1',
    }
    expect(
      propagateFromSuccess({ ...base, agg: 0.6, items: [{ nodeId: 'x', skill: 'writing', outcome: 'correct', confidence: 0.9 }] }),
    ).toHaveLength(0)
    expect(
      propagateFromSuccess({ ...base, agg: 1.0, items: [{ nodeId: 'x', skill: 'writing', outcome: 'correct', confidence: 0.5 }] }),
    ).toHaveLength(0)
    expect(
      propagateFromSuccess({
        ...base,
        agg: 1.0,
        items: [
          { nodeId: 'x', skill: 'writing', outcome: 'correct', confidence: 0.9 },
          { nodeId: 'x', skill: 'writing', outcome: 'error', confidence: 0.9 },
        ],
      }),
    ).toHaveLength(0)
  })
})

// ── root cause ──

describe('rootCauseAttribution (docs A4 upward)', () => {
  it('routes a confirmed gap to the weakest prerequisite with reduced confidence', () => {
    const edges: EngineEdge[] = [
      { fromId: 'weak', toId: 'target', type: 'prerequisite', weight: 1 },
      { fromId: 'strong', toId: 'target', type: 'prerequisite', weight: 1 },
    ]
    const prereqStates = new Map<string, NodeSkillState | null>([
      ['weak', learningState('weak', { strength: 0.2 })],
      ['strong', learningState('strong', { strength: 0.9 })],
    ])
    const r = rootCauseAttribution({
      node: node('target'),
      gapConfirmed: true,
      items: [
        { nodeId: 'target', skill: 'writing', outcome: 'error', confidence: 0.9, produced: 'x', expected: 'y' },
      ],
      edges,
      prereqStates,
    })
    expect(r).not.toBeNull()
    expect(r!.routeToNodeId).toBe('weak')
    expect(r!.evidence.nodeId).toBe('weak')
    expect(r!.evidence.confidence).toBeCloseTo(0.9 * 0.7, 5)
  })

  it('no re-attribution when all prerequisites are strong', () => {
    const edges: EngineEdge[] = [{ fromId: 'strong', toId: 'target', type: 'prerequisite', weight: 1 }]
    const r = rootCauseAttribution({
      node: node('target'),
      gapConfirmed: true,
      items: [{ nodeId: 'target', skill: 'writing', outcome: 'error', confidence: 0.9 }],
      edges,
      prereqStates: new Map([['strong', learningState('strong', { strength: 0.9 })]]),
    })
    expect(r).toBeNull()
  })
})

// ── mastery ──

describe('mastery & delayed tests (docs A6)', () => {
  it('eligibility gate: reps ≥ 4, S ≥ 21d, age ≥ 3d', () => {
    const young = learningState('n1', { reps: 2, stability: 30 })
    expect(masteryEligibility(young, NOW)).toBe(false)
    const weak = learningState('n2', { reps: 5, stability: 10 })
    expect(masteryEligibility(weak, NOW)).toBe(false)
    const fresh = learningState('n3', { reps: 5, stability: 30, lastReviewAt: NOW })
    expect(masteryEligibility(fresh, NOW)).toBe(false)
    const ready = learningState('n4', { reps: 5, stability: 30, lastReviewAt: day(-4) })
    expect(masteryEligibility(ready, NOW)).toBe(true)
  })

  it('pass → mastered; fail → Again + retry window; double fail post-mastery → revoked', () => {
    const ready = learningState('n', { reps: 5, stability: 30, lastReviewAt: day(-4), pendingDelayTest: true })

    const pass = applyDelayedTestOutcome(ready, { correct: 2, total: 3, minConfidence: 0.85, failedProbesSinceMastery: 0 }, NOW)
    expect(pass.mastered).toBe(true)
    expect(pass.updated.masteredAt).toBe(NOW)
    expect(pass.updated.displayState).toBe('mastered')

    // first failed probe after mastery: warning, mastery kept but flagged visually
    const fail1 = applyDelayedTestOutcome(pass.updated, { correct: 1, total: 3, minConfidence: 0.85, failedProbesSinceMastery: 0 }, day(10))
    expect(fail1.revoked).toBe(false)

    // second failed probe → revocation
    const fail2 = applyDelayedTestOutcome(pass.updated, { correct: 0, total: 3, minConfidence: 0.85, failedProbesSinceMastery: 1 }, day(20))
    expect(fail2.revoked).toBe(true)
    expect(fail2.updated.masteredAt).toBeNull()
    expect(fail2.updated.displayState).toBe('learning')

    // pre-mastery failure: no mastery granted, retry in 7d
    const preFail = applyDelayedTestOutcome(ready, { correct: 1, total: 3, minConfidence: 0.85, failedProbesSinceMastery: 0 }, NOW)
    expect(preFail.mastered).toBe(false)
    expect(preFail.updated.pendingDelayTest).toBe(false)
    expect(preFail.updated.delayTestEligibleAt?.getTime()).toBe(day(7).getTime())
  })

  it('pass requires 2/3 AND minConfidence ≥ 0.8', () => {
    const ready = learningState('n', { reps: 5, stability: 30, lastReviewAt: day(-4) })
    const lowConf = applyDelayedTestOutcome(ready, { correct: 3, total: 3, minConfidence: 0.6, failedProbesSinceMastery: 0 }, NOW)
    expect(lowConf.mastered).toBe(false)
  })
})

// ── fading ──

describe('fading (docs A5)', () => {
  it('R < 0.75 → fading (young S=2.31 card: probe numbers +7d→0.808, +14d→0.742)', () => {
    const young = learningState('n', {
      reps: 1,
      stability: 2.31,
      difficulty: 2.12,
      lastReviewAt: NOW,
      due: day(1),
      displayState: 'learning',
    })
    expect(retrievability(young, day(7))).toBeCloseTo(0.808, 2)
    expect(retrievability(young, day(14))).toBeLessThan(0.75)
    expect(isFading(young, day(14))).toBe(true)
    expect(computeDisplayState(young, day(14))).toBe('fading') // both rules agree
    expect(computeDisplayState(young, day(2))).toBe('learning') // 1d overdue: neither rule fires
    expect(isFading(young, day(7))).toBe(true) // overdue 6d > 2×1d interval → fading even at R=0.808
  })

  it('healthy S=10.96 card does NOT fade at +14d (R=0.882) — overdue rule is what catches missed reviews', () => {
    const s = learningState('n2', {
      reps: 2,
      stability: 10.96,
      difficulty: 2.11,
      lastReviewAt: NOW,
      due: day(11),
      displayState: 'learning',
    })
    expect(retrievability(s, day(14))).toBeCloseTo(0.882, 2)
    expect(isFading(s, day(14))).toBe(false)
    // interval 11d → overdue > 22d → fading around day 33+ even though R≈0.79
    expect(isFading(s, day(30))).toBe(false)
    expect(isFading(s, day(35))).toBe(true)
  })

  it('overdue by > 2× interval (and > 3 days) → fading even if R is high', () => {
    // interval 2d, due at +2, now +8 → overdue 6d > 2×2d and > 3d
    const s = learningState('n', { stability: 50, lastReviewAt: NOW, due: day(2), displayState: 'learning', reps: 3 })
    expect(isFading(s, day(8))).toBe(true)
  })

  it('mastered + fading → fading display; mastered healthy stays mastered', () => {
    const mastered = learningState('m', { reps: 6, stability: 40, lastReviewAt: NOW, due: day(30), displayState: 'mastered', masteredAt: NOW })
    expect(computeDisplayState(mastered, day(5))).toBe('mastered')
    const stale = learningState('m2', { reps: 6, stability: 3, lastReviewAt: day(-40), due: day(-20), displayState: 'mastered', masteredAt: day(-40) })
    expect(computeDisplayState(stale, NOW)).toBe('fading')
  })

  it('assumed_known survives until first review (C1 resolution)', () => {
    const ak = newState('u1', 'en:word:go', 'writing', 'assumed_known')
    expect(computeDisplayState(ak, NOW)).toBe('assumed_known')
    const practiced = { ...ak, reps: 1, lastReviewAt: NOW, stability: 2, fsrsState: 'Learning' as const, displayState: 'learning' as const }
    expect(computeDisplayState(practiced, NOW)).toBe('learning')
  })
})
