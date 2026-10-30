/**
 * Placement engine tests (docs/05 M1 acceptance):
 * - adaptive band quiz: deterministic pools, valid MCQs
 * - 2-up/1-down ladder math
 * - "answering A2-band correctly lights A1+A2 word band as assumed_known,
 *    never mastered" — the C1 invariant
 */
import { describe, expect, it } from 'vitest'
import {
  applyPlacement,
  buildPlacementQuiz,
  clampBand,
  pickItemForBand,
  runLadder,
} from '@/lib/engine/placement'
import type { EngineNode } from '@/lib/engine/types'

function word(id: string, cefr: string, gloss: string, rank: number): EngineNode {
  return {
    id,
    type: 'word',
    lang: 'en',
    cefr,
    frequencyRank: rank,
    title: id.split(':').pop() as string,
    glossFa: gloss,
    tags: [],
  }
}

const syntheticNodes = (): EngineNode[] => {
  const out: EngineNode[] = []
  let r = 1
  for (const [band, n] of [['A1', 16], ['A2', 6], ['B1', 6]] as const) {
    for (let i = 1; i <= n; i++) {
      out.push(word(`en:word:${band.toLowerCase()}${i}`, band, `معنی ${band}-${i}`, r++))
    }
  }
  out.push({
    id: 'en:grammar:present-simple',
    type: 'grammar_pattern',
    lang: 'en',
    cefr: 'A1',
    frequencyRank: null,
    title: 'Present Simple',
    glossFa: 'حال ساده',
    tags: [],
  })
  return out
}

describe('buildPlacementQuiz', () => {
  it('draws exactly POOL_PER_BAND items per band (12 total for 3 bands)', () => {
    const quiz = buildPlacementQuiz(syntheticNodes(), 'A2', 42)
    expect(quiz.pools.A1.length).toBe(4)
    expect(quiz.pools.A2.length).toBe(4)
    expect(quiz.pools.B1.length).toBe(4)
    expect(quiz.startBand).toBe('A2')
  })

  it('is deterministic for a given seed (same seed → identical quiz)', () => {
    const a = buildPlacementQuiz(syntheticNodes(), 'A1', 7)
    const b = buildPlacementQuiz(syntheticNodes(), 'A1', 7)
    expect(a).toEqual(b)
  })

  it('prefers top-frequency words (lowest ranks) for the candidates', () => {
    const quiz = buildPlacementQuiz(syntheticNodes(), 'A1', 1)
    const allIds = [...quiz.pools.A1, ...quiz.pools.A2, ...quiz.pools.B1].map((i) => i.nodeId)
    // A1 has 16 words ranked 1..16 (ids a11..a116); only the top-12 slice is
    // eligible → the 4 rarest (a113..a116) must never be drawn
    for (const rare of ['a113', 'a114', 'a115', 'a116']) {
      expect(allIds).not.toContain(`en:word:${rare}`)
    }
    // …and the most frequent word (rank 1) is always within the candidate slice
    const a1Picks = quiz.pools.A1.map((i) => i.nodeId)
    expect(a1Picks.every((id) => /^en:word:a1(1[0-2]?|[2-9])$/.test(id))).toBe(true)
  })

  it('every item is a valid MCQ: unique options, correct gloss included, 4 options', () => {
    const quiz = buildPlacementQuiz(syntheticNodes(), 'A2', 99)
    for (const band of ['A1', 'A2', 'B1'] as const) {
      for (const item of quiz.pools[band]) {
        expect(item.band).toBe(band)
        expect(item.options).toHaveLength(4)
        expect(new Set(item.options).size).toBe(4)
        expect(item.correctIndex).toBeGreaterThanOrEqual(0)
        expect(item.correctIndex).toBeLessThan(4)
        expect(item.options[item.correctIndex]).toMatch(/^معنی /)
      }
    }
  })
})

describe('pickItemForBand', () => {
  it('returns unused items from the requested band first', () => {
    const quiz = buildPlacementQuiz(syntheticNodes(), 'A1', 3)
    const used = new Set<string>()
    const first = pickItemForBand(quiz, 'A1', used)
    expect(first?.band).toBe('A1')
    used.add(first!.nodeId)
    const second = pickItemForBand(quiz, 'A1', used)
    expect(second?.band).toBe('A1')
    expect(second?.nodeId).not.toBe(first!.nodeId)
  })

  it('borrows from the nearest band when the pool is exhausted', () => {
    const quiz = buildPlacementQuiz(syntheticNodes(), 'A1', 3)
    const used = new Set(quiz.pools.A1.map((i) => i.nodeId))
    const item = pickItemForBand(quiz, 'A1', used)
    expect(item).not.toBeNull()
    expect(item?.band).toBe('A2') // nearest down-then-up
  })
})

describe('runLadder (2-up / 1-down)', () => {
  it('two consecutive correct answers step the ladder UP one band', () => {
    const r = runLadder('A1', [
      { band: 'A1', correct: true },
      { band: 'A1', correct: true },
    ])
    expect(r.reachedBand).toBe('A2')
  })

  it('one wrong answer steps the ladder DOWN one band (floored at A1)', () => {
    const r = runLadder('A2', [
      { band: 'A2', correct: true },
      { band: 'A2', correct: true },
      { band: 'B1', correct: false },
    ])
    // ladder: start A2 → 2 correct → B1 → wrong → back to A2; reached = B1
    expect(r.reachedBand).toBe('B1')
    expect(r.finalBand).toBe('A2') // A2 majority 2-0, B1 negative
  })

  it('ACCEPTANCE: answering A2-band correctly resolves the final band to A2', () => {
    const r = runLadder('A2', [
      { band: 'A2', correct: true },
      { band: 'A2', correct: true },
      { band: 'B1', correct: false },
    ])
    expect(r.finalBand).toBe('A2')
  })

  it('a later failed item flips a band majority negative', () => {
    // A2: 1 correct 2 wrong → negative; A1: 2 correct → positive → final A1
    const r = runLadder('A2', [
      { band: 'A2', correct: true },
      { band: 'A2', correct: false },
      { band: 'A1', correct: true },
      { band: 'A1', correct: true },
      { band: 'A1', correct: false },
      { band: 'A2', correct: false },
    ])
    expect(r.perBand.A2).toEqual({ correct: 1, wrong: 2 })
    expect(r.perBand.A1).toEqual({ correct: 2, wrong: 1 })
    expect(r.finalBand).toBe('A1')
  })

  it('all wrong → finalBand null (absolute beginner, nothing lit)', () => {
    const r = runLadder('A2', [{ band: 'A2', correct: false }, { band: 'A1', correct: false }])
    expect(r.finalBand).toBeNull()
  })

  it('clamps the ladder inside A1..B1', () => {
    expect(clampBand(-5)).toBe('A1')
    expect(clampBand(9)).toBe('B1')
  })

  it('currentBand tracks where the ladder stands for stateless continuation', () => {
    // M5: the API route rebuilds the ladder from all answers each call and
    // needs the standing band to pick the next item (server-side grading).
    const up = runLadder('A1', [
      { band: 'A1', correct: true },
      { band: 'A1', correct: true },
    ])
    expect(up.currentBand).toBe('A2')
    expect(up.reachedBand).toBe('A2')

    const down = runLadder('A2', [
      { band: 'A2', correct: true },
      { band: 'A2', correct: true },
      { band: 'B1', correct: false },
    ])
    expect(down.currentBand).toBe('A2') // stepped down after the wrong answer

    const floored = runLadder('A1', [{ band: 'A1', correct: false }])
    expect(floored.currentBand).toBe('A1') // floored, never below A1
  })
})

describe('applyPlacement (C1: assumed_known, NEVER mastered)', () => {
  const nodes = syntheticNodes()

  it('A2 final lights A1+A2 words for both skills, never B1', () => {
    const ladder = runLadder('A2', [{ band: 'A2', correct: true }, { band: 'A2', correct: true }])
    const now = new Date('2026-10-30T10:00:00Z')
    const drafts = applyPlacement(syntheticNodes(), ladder, 'user-1', now)

    const litIds = [...new Set(drafts.map((d) => d.nodeId))]
    expect(litIds).toHaveLength(22) // all 16 A1 + 6 A2 words (the whole curated band)
    for (const id of litIds) {
      expect(id).toMatch(/^en:word:a(1|2)\d+$/)
    }
    expect(drafts.every((d) => d.skill === 'reading' || d.skill === 'writing')).toBe(true)
    expect(drafts.filter((d) => d.skill === 'reading')).toHaveLength(22)
    expect(drafts.filter((d) => d.skill === 'writing')).toHaveLength(22)
  })

  it('every lit state is assumed_known with fresh FSRS card and priority delayed test', () => {
    const ladder = runLadder('B1', [{ band: 'B1', correct: true }])
    const now = new Date('2026-10-30T10:00:00Z')
    const drafts = applyPlacement(nodes, ladder, 'user-1', now)
    // B1 final → all 28 words lit (16 A1 + 6 A2 + 6 B1)
    expect(new Set(drafts.map((d) => d.nodeId)).size).toBe(28)

    for (const d of drafts) {
      expect(d.displayState).toBe('assumed_known')
      expect(d.masteredAt).toBeNull() // NEVER mastered (C1)
      expect(d.fsrsState).toBe('New')
      expect(d.reps).toBe(0)
      expect(d.stability).toBe(0)
      expect(d.strength).toBeGreaterThan(0)
      expect(d.pendingDelayTest).toBe(true)
      expect(d.delayTestEligibleAt).toEqual(now)
      expect(d.lastAppliedEvidenceId).toBeNull()
    }
  })

  it('non-word nodes (grammar/chunks) are never lit by placement', () => {
    const ladder = runLadder('B1', [{ band: 'B1', correct: true }])
    const drafts = applyPlacement(nodes, ladder, 'user-1', new Date('2026-10-30T10:00:00Z'))
    expect(drafts.some((d) => d.nodeId === 'en:grammar:present-simple')).toBe(false)
  })

  it('absolute beginner (finalBand null) lights nothing', () => {
    const ladder = runLadder('A1', [{ band: 'A1', correct: false }])
    expect(applyPlacement(nodes, ladder, 'user-1', new Date())).toEqual([])
  })
})
