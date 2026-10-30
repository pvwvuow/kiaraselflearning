/**
 * M8 acceptance (docs/05 M8) — delayed-test machinery unit tests:
 * "eligibility gate (reps≥4, S≥21d, ≥3d old) exactly per docs/03 §A6",
 * probe sampling bounds, fresh-context building (3 distinct families ≠
 * practice), and probe grading (2/3 @ ≥0.8 → pass; missing/low-conf → fail).
 */
import { describe, expect, it } from 'vitest'
import {
  buildConfirmatoryContexts,
  confirmationProbeDue,
  CONTEXT_FAMILIES,
  gradeProbe,
  maintenanceProbeDue,
  probeEligible,
  probeSlotFor,
  PROBEABLE_NODE_TYPES,
  selectProbeNodes,
} from '@/lib/engine/delayed-test'
import { applyDelayedTestOutcome, newState } from '@/lib/engine/state'
import { rngFromSeed } from '@/lib/engine/rng'
import type { EngineNode, EvidenceItem, NodeSkillState } from '@/lib/engine/types'

const NOW = new Date('2027-01-10T10:00:00Z')
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

function node(id: string, over: Partial<EngineNode> = {}): EngineNode {
  return {
    id,
    type: 'word',
    lang: 'en',
    cefr: 'A2',
    frequencyRank: 900,
    title: 'recommend',
    glossFa: 'توصیه کردن',
    tags: [],
    ...over,
  }
}

/** a state that passes the full §A6 base gate (reps≥4, S≥21, ≥3d old, pending) */
function eligibleState(nodeId: string, over: Partial<NodeSkillState> = {}): NodeSkillState {
  return {
    ...newState('u1', nodeId, 'writing'),
    reps: 5,
    stability: 30,
    difficulty: 4.5,
    fsrsState: 'Review',
    lastReviewAt: day(-6),
    due: day(24),
    pendingDelayTest: true,
    delayTestEligibleAt: day(-3),
    strength: 0.7,
    displayState: 'learning',
    ...over,
  }
}

const CLEAN = { openGap: false, hintAssistedRecent: false }

// ── eligibility gate (acceptance unit #1) ──

describe('probeEligible — docs/03 §A6 gate, full form', () => {
  it('base gate: reps ≥ 4 AND S ≥ 21d AND ≥3d old (exactly the documented gates)', () => {
    expect(probeEligible(eligibleState('n'), NOW, CLEAN)).toBe(true)
    // reps < 4
    expect(probeEligible(eligibleState('n', { reps: 3 }), NOW, CLEAN)).toBe(false)
    // stability < 21d
    expect(probeEligible(eligibleState('n', { stability: 20 }), NOW, CLEAN)).toBe(false)
    // younger than 3d since lastReviewAt
    expect(probeEligible(eligibleState('n', { lastReviewAt: day(-2), delayTestEligibleAt: day(1) }), NOW, CLEAN)).toBe(false)
  })

  it('an unresolved gap (Relearning card) blocks CONFIRMATION probes', () => {
    expect(probeEligible(eligibleState('n', { fsrsState: 'Relearning' }), NOW, { ...CLEAN, openGap: true })).toBe(false)
  })

  it('a Relearning card does NOT block MAINTENANCE probes (else revocation were unreachable — a failed probe always lands in Relearning)', () => {
    const masteredRelearning = eligibleState('n', {
      pendingDelayTest: false,
      delayTestEligibleAt: null,
      masteredAt: day(-40),
      lastReviewAt: day(-5),
      due: day(-1),
      fsrsState: 'Relearning',
    })
    expect(probeEligible(masteredRelearning, NOW, { ...CLEAN, openGap: true })).toBe(true)
  })

  it('hint-assisted in the last 2 sessions blocks the probe', () => {
    expect(probeEligible(eligibleState('n'), NOW, { ...CLEAN, hintAssistedRecent: true })).toBe(false)
  })

  it('pre-mastery probes also require pendingDelayTest + eligibleAt passed', () => {
    expect(probeEligible(eligibleState('n', { pendingDelayTest: false }), NOW, CLEAN)).toBe(false)
    expect(probeEligible(eligibleState('n', { delayTestEligibleAt: day(2) }), NOW, CLEAN)).toBe(false)
  })

  it('maintenance probes: a mastered node is re-probeable when the card is due (+3d age, +7d retry)', () => {
    const mastered = eligibleState('n', {
      pendingDelayTest: false,
      delayTestEligibleAt: null,
      masteredAt: day(-40),
      lastReviewAt: day(-40), // pass applied Good here → due ≈ day(-40) + interval
      due: day(-2),
    })
    expect(maintenanceProbeDue(mastered, NOW)).toBe(true)
    expect(probeEligible(mastered, NOW, CLEAN)).toBe(true)

    // not yet due
    const notDue = { ...mastered, due: day(9) }
    expect(probeEligible(notDue, NOW, CLEAN)).toBe(false)

    // 7d retry window after a failed probe
    const retrying = { ...mastered, delayTestEligibleAt: day(3) }
    expect(probeEligible(retrying, NOW, CLEAN)).toBe(false)
    expect(probeEligible(retrying, day(4), CLEAN)).toBe(true)

    // no masteredAt → never a maintenance probe
    expect(probeEligible({ ...mastered, masteredAt: null }, NOW, CLEAN)).toBe(false)
  })

  it('confirmationProbeDue vs maintenanceProbeDue are mutually exclusive paths', () => {
    const pending = eligibleState('n')
    expect(confirmationProbeDue(pending, NOW)).toBe(true)
    expect(maintenanceProbeDue(pending, NOW)).toBe(false)
    const mastered = eligibleState('n', { pendingDelayTest: false, masteredAt: day(-30), lastReviewAt: day(-30), due: day(-1) })
    expect(confirmationProbeDue(mastered, NOW)).toBe(false)
    expect(maintenanceProbeDue(mastered, NOW)).toBe(true)
  })
})

// ── sampling ──

describe('selectProbeNodes — ≤ max, deterministic for a seed', () => {
  const candidates = ['a', 'b', 'c', 'd', 'e']
  it('caps at max and never returns unknown entries', () => {
    const picked = selectProbeNodes(candidates, 2, rngFromSeed('seed-1'))
    expect(picked.length).toBe(2)
    for (const p of picked) expect(candidates).toContain(p)
  })
  it('is deterministic for the same seed and varies across seeds', () => {
    expect(selectProbeNodes(candidates, 2, rngFromSeed('s'))).toEqual(selectProbeNodes(candidates, 2, rngFromSeed('s')))
    const picks = new Set(Array.from({ length: 12 }, (_, i) => selectProbeNodes(candidates, 1, rngFromSeed(`s${i}`))[0]))
    expect(picks.size).toBeGreaterThan(1)
  })
  it('does not mutate the input', () => {
    const before = [...candidates]
    selectProbeNodes(candidates, 3, rngFromSeed('x'))
    expect(candidates).toEqual(before)
  })
})

// ── fresh contexts ──

describe('buildConfirmatoryContexts — 3 fresh contexts, no practice family', () => {
  it('returns exactly 3 contexts, each from a distinct family ≠ practiceFamily', () => {
    const ctxs = buildConfirmatoryContexts({ node: node('en:word:recommend'), practiceFamily: 'travel', rng: rngFromSeed('u1:2027-01-10') })
    expect(ctxs.length).toBe(3)
    const families = new Set(ctxs.map((c) => c.family))
    expect(families.size).toBe(3)
    expect(families.has('travel')).toBe(false)
    expect(ctxs.map((c) => c.index)).toEqual([0, 1, 2])
  })

  it('cued recall: the item names the target + Persian gloss, but frames differ', () => {
    const ctxs = buildConfirmatoryContexts({ node: node('en:word:recommend'), practiceFamily: 'daily', rng: rngFromSeed('k') })
    for (const c of ctxs) {
      expect(c.text).toContain('«recommend»')
      expect(c.text).toContain('توصیه کردن')
      expect(c.text).toContain('ONE correct English sentence')
    }
    expect(new Set(ctxs.map((c) => c.text)).size).toBe(3)
  })

  it('works without a Persian gloss and for non-word probeable types', () => {
    const bare = node('en:chunk:could-you', { glossFa: null, title: 'Could you…?', type: 'chunk' })
    const ctxs = buildConfirmatoryContexts({ node: bare, practiceFamily: 'work', rng: rngFromSeed('k2') })
    expect(ctxs.length).toBe(3)
    expect(ctxs[0].text).toContain('«Could you…?»')
    expect(PROBEABLE_NODE_TYPES).toContain('chunk')
  })

  it('even when practice family excluded, enough families remain (6 total)', () => {
    expect(CONTEXT_FAMILIES.length).toBeGreaterThanOrEqual(4)
  })
})

// ── ride-along slot math ──

describe('probeSlotFor — warm-up honored, slots sequential', () => {
  const plan = {
    warmupTurns: 2,
    probes: [
      { nodeId: 'en:word:a', skill: 'writing' as const, postMastery: false, contexts: [] as never[] },
      { nodeId: 'en:word:b', skill: 'writing' as const, postMastery: true, contexts: [] as never[] },
    ],
  }
  it('first 2 user turns are pure practice (no warm-up effect)', () => {
    expect(probeSlotFor(plan, 1)).toBeNull()
    expect(probeSlotFor(plan, 2)).toBeNull()
  })
  it('turns 3–5 answer probe 0 (contexts 0–2), turns 6–8 probe 1', () => {
    expect(probeSlotFor(plan, 3)?.probeIndex).toBe(0)
    expect(probeSlotFor(plan, 4)?.contextIndex).toBe(1)
    expect(probeSlotFor(plan, 5)?.contextIndex).toBe(2)
    expect(probeSlotFor(plan, 6)?.probeIndex).toBe(1)
    expect(probeSlotFor(plan, 8)?.contextIndex).toBe(2)
  })
  it('beyond the plan → null; explicit confirmatory sessions have zero warm-up', () => {
    expect(probeSlotFor(plan, 9)).toBeNull()
    const explicit = { warmupTurns: 0, probes: plan.probes }
    expect(probeSlotFor(explicit, 1)?.contextIndex).toBe(0)
  })
  it('null plan → null', () => {
    expect(probeSlotFor(null, 3)).toBeNull()
  })
})

// ── grading ──

function item(outcome: EvidenceItem['outcome'], confidence: number, over: Partial<EvidenceItem> = {}): EvidenceItem {
  return { nodeId: 'en:word:a', skill: 'writing', outcome, confidence, ...over }
}

describe('gradeProbe — docs/03 §A6 pass rule', () => {
  it('2/3 correct @ ≥0.8 confidence → pass numbers', () => {
    const g = gradeProbe([[item('correct', 0.9)], [item('correct', 0.85)], [item('error', 0.9)]])
    expect(g).toEqual({ correct: 2, total: 3, minConfidence: 0.85 })
  })

  it('an error item’s confidence measures error-detection, NOT production quality — it never dilutes minConfidence', () => {
    // 2 confident-correct + 1 softly-detected error → the correct items decide
    const g = gradeProbe([[item('correct', 0.95)], [item('correct', 0.95)], [item('error', 0.65)]])
    expect(g).toEqual({ correct: 2, total: 3, minConfidence: 0.95 })
  })

  it('a confident error in the same context cancels a correct emission', () => {
    const g = gradeProbe([[item('correct', 0.9), item('error', 0.7)], [item('correct', 0.9)], [item('correct', 0.9)]])
    expect(g.correct).toBe(2) // first context contaminated
  })

  it('items below the 0.8 confidence floor are not "correct" at all (docs: correct WITH confidence ≥ 0.8)', () => {
    const g = gradeProbe([[item('correct', 0.6)], [item('correct', 0.6)], [item('correct', 0.6)]])
    expect(g.correct).toBe(0)
    const r = applyDelayedTestOutcome(eligibleState('n'), { ...g, failedProbesSinceMastery: 0 }, NOW)
    expect(r.mastered).toBe(false)
  })

  it('silent analyst on one context → that context is not correct, confidence untouched', () => {
    const g = gradeProbe([[item('correct', 0.9)], [], [item('correct', 0.95)]])
    expect(g.correct).toBe(2)
    expect(g.minConfidence).toBe(0.9)
  })

  it('all contexts silent → correct 0, minConfidence neutral 1 (fail via ratio)', () => {
    const g = gradeProbe([[], [], []])
    expect(g).toEqual({ correct: 0, total: 3, minConfidence: 1 })
  })

  it('slip_self_corrected does not count as correct but is a positive signal only', () => {
    const g = gradeProbe([[item('slip_self_corrected', 0.9)], [item('correct', 0.9)], [item('correct', 0.9)]])
    expect(g.correct).toBe(2)
  })
})

// ── mastery transition integration (with the M8 card-advance decision) ──

describe('applyDelayedTestOutcome — mastery schedules the maintenance probe', () => {
  it('pass stamps masteredAt AND advances the card (Good) so a due date exists', () => {
    const ready = eligibleState('n', { lastReviewAt: day(-6), due: day(24) })
    const r = applyDelayedTestOutcome(ready, { correct: 2, total: 3, minConfidence: 0.9, failedProbesSinceMastery: 0 }, NOW)
    expect(r.mastered).toBe(true)
    expect(r.updated.masteredAt).toEqual(NOW)
    expect(r.updated.displayState).toBe('mastered')
    expect(r.updated.pendingDelayTest).toBe(false)
    expect(r.updated.delayTestEligibleAt).toBeNull()
    expect(r.updated.lastReviewAt).toEqual(NOW) // Good applied
    expect(r.updated.reps).toBe(6)
    expect(r.updated.due!.getTime()).toBeGreaterThan(NOW.getTime()) // scheduled future
    // …which makes the node maintenance-probeable only after due + age
    expect(probeEligible(r.updated, NOW, CLEAN)).toBe(false)
  })

  it('fail applies Again + 7d retry; second post-mastery fail revokes to learning', () => {
    const ready = eligibleState('n')
    const fail = applyDelayedTestOutcome(ready, { correct: 1, total: 3, minConfidence: 0.9, failedProbesSinceMastery: 0 }, NOW)
    expect(fail.mastered).toBe(false)
    expect(fail.updated.delayTestEligibleAt).toEqual(day(7))
    expect(fail.updated.fsrsState).toBe('Relearning')

    const mastered = eligibleState('n', { masteredAt: day(-30), pendingDelayTest: false })
    const fail1 = applyDelayedTestOutcome(mastered, { correct: 1, total: 3, minConfidence: 0.9, failedProbesSinceMastery: 0 }, NOW)
    expect(fail1.revoked).toBe(false)
    const fail2 = applyDelayedTestOutcome(
      fail1.updated,
      { correct: 0, total: 3, minConfidence: 0.9, failedProbesSinceMastery: 1 },
      day(8),
    )
    expect(fail2.revoked).toBe(true)
    expect(fail2.updated.masteredAt).toBeNull()
    expect(fail2.updated.displayState).toBe('learning')
  })
})
