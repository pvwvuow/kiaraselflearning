/**
 * Growth engine tests (docs/03 §B) + graph availability + purity guard.
 */
import { describe, expect, it } from 'vitest'
import {
  buildSeedDraft,
  capAllows,
  scanRepeatedErrors,
  scoreCandidate,
} from '@/lib/engine/growth'
import { computeAvailability, frontierNodes, nodeTier, prerequisitesOf } from '@/lib/engine/graph'
import type {
  EngineEdge,
  EngineNode,
  EvidenceItem,
} from '@/lib/engine/types'

const NOW = new Date('2026-11-01T10:00:00Z')

function node(id: string, over: Partial<EngineNode> = {}): EngineNode {
  return {
    id,
    type: 'word',
    lang: 'en',
    cefr: 'A2',
    frequencyRank: 1987,
    title: id,
    glossFa: null,
    tags: [],
    ...over,
  }
}

function err(nodeId: string, sessionId: string, confidence = 0.9, over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    nodeId,
    skill: 'writing',
    outcome: 'error',
    confidence,
    sessionId,
    errorType: 'form',
    produced: 'a x',
    expected: 'the x',
    ...over,
  }
}

describe('scanRepeatedErrors (docs B2)', () => {
  it('needs errors in ≥2 distinct sessions', () => {
    const one = scanRepeatedErrors([err('w', 's1'), err('w', 's1')], {
      activeNodeIds: new Set(),
      existingErrorPatternIds: new Set(),
    })
    expect(one).toHaveLength(0)
    const two = scanRepeatedErrors([err('w', 's1'), err('w', 's2')], {
      activeNodeIds: new Set(),
      existingErrorPatternIds: new Set(),
    })
    expect(two).toHaveLength(1)
    expect(two[0].kind).toBe('plant_existing')
  })

  it('planted node → track_pattern candidate', () => {
    const c = scanRepeatedErrors([err('w', 's1'), err('w', 's2')], {
      activeNodeIds: new Set(['w']),
      existingErrorPatternIds: new Set(),
    })
    expect(c).toHaveLength(1)
    expect(c[0].kind).toBe('track_pattern')
    expect(c[0].requiresNodeCreation).toBe(true)
  })

  it('low-confidence and disputed errors never count', () => {
    const c = scanRepeatedErrors([err('w', 's1', 0.4), err('w', 's2', 0.9, { disputed: true })], {
      activeNodeIds: new Set(),
      existingErrorPatternIds: new Set(),
    })
    expect(c).toHaveLength(0)
  })
})

describe('scoring (docs B3 numeric examples)', () => {
  const recommend = node('en:word:recommend', { frequencyRank: 1987, tags: ['work', 'meeting'] })
  const itinerary = node('en:word:itinerary', { frequencyRank: 24000, tags: ['travel'] })
  const errPattern = node('en:err:l1-3rd-s', { type: 'error_pattern', frequencyRank: null })

  it('recommend (goal=work, prereqs ok, novel) → 0.80 → propose', () => {
    const { score, breakdown } = scoreCandidate(
      { kind: 'plant_existing', nodeId: recommend.id, group: {} as never, requiresNodeCreation: false },
      { node: recommend, goal: 'work', prereqStates: [], userHasActiveState: false },
    )
    expect(breakdown).toEqual({ goalRelevance: 1, frequency: 0.8, readiness: 1, novelty: 1 })
    expect(score).toBeCloseTo(0.8, 5)
  })

  it('itinerary (rank 24k, no goal-tag match) → 0.6×0.4 = 0.24 → below the 0.45 bar', () => {
    const { score, breakdown } = scoreCandidate(
      { kind: 'plant_existing', nodeId: itinerary.id, group: {} as never, requiresNodeCreation: false },
      { node: itinerary, goal: 'work', prereqStates: [], userHasActiveState: false },
    )
    expect(breakdown.goalRelevance).toBe(0.6) // travel tag ≠ work goal → default
    expect(breakdown.frequency).toBe(0.4)
    expect(score).toBeCloseTo(0.24, 5)
  })

  it('error_pattern nodes get flat 0.9 × 0.8 → 0.72', () => {
    const { score } = scoreCandidate(
      { kind: 'track_pattern', nodeId: errPattern.id, group: {} as never, requiresNodeCreation: true },
      { node: errPattern, goal: 'travel', prereqStates: [], userHasActiveState: false },
    )
    expect(score).toBeCloseTo(0.72, 5)
  })

  it('already-planted node → novelty 0 → skip', () => {
    const { score } = scoreCandidate(
      { kind: 'plant_existing', nodeId: recommend.id, group: {} as never, requiresNodeCreation: false },
      { node: recommend, goal: 'work', prereqStates: [], userHasActiveState: true },
    )
    expect(score).toBe(0)
  })

  it('unready prerequisites scale the score down', () => {
    const { score } = scoreCandidate(
      { kind: 'plant_existing', nodeId: recommend.id, group: {} as never, requiresNodeCreation: false },
      { node: recommend, goal: 'work', prereqStates: ['locked', 'locked', 'learning', 'available'], userHasActiveState: false },
    )
    expect(score).toBeCloseTo(0.8 * 0.5, 5) // readiness 2/4
  })
})

describe('seed draft & cap (docs B3–B5)', () => {
  it('draft below threshold is dropped; above threshold carries Persian reason', () => {
    const recommend = node('en:word:recommend', { tags: ['work'] })
    const candidate = {
      kind: 'plant_existing' as const,
      nodeId: recommend.id,
      group: {
        nodeId: recommend.id,
        errorType: 'usage',
        sessionIds: ['s1', 's2', 's3'],
        samples: [{ produced: 'I recommend you to go', expected: 'I recommend going', confidence: 0.9 }],
      },
      requiresNodeCreation: false,
    }
    const draft = buildSeedDraft(candidate, {
      node: recommend,
      goal: 'work',
      prereqStates: [],
      userHasActiveState: false,
    }, NOW)
    expect(draft).not.toBeNull()
    expect(draft!.score).toBeGreaterThanOrEqual(0.45)
    expect(draft!.candidateNodeId).toBe(recommend.id)
    expect(draft!.reasonFa).toContain('خطای مستقل')
    expect(draft!.reasonFa).toContain('نمونه')
  })

  it('weekly cap: 3 planted in window blocks the 4th', () => {
    expect(capAllows(0)).toBe(true)
    expect(capAllows(2)).toBe(true)
    expect(capAllows(3)).toBe(false)
  })
})

describe('graph availability (docs A5 graph level)', () => {
  const nodes = [
    node('en:word:go', { cefr: 'A1' }),
    node('en:word:went', { cefr: 'A1' }),
    node('en:grammar:past-simple', { cefr: 'A1', type: 'grammar_pattern' }),
    node('en:chunk:used-to', { cefr: 'B1', type: 'chunk' }),
  ]
  const edges: EngineEdge[] = [
    { fromId: 'en:word:go', toId: 'en:grammar:past-simple', type: 'prerequisite', weight: 1 },
    { fromId: 'en:grammar:past-simple', toId: 'en:chunk:used-to', type: 'prerequisite', weight: 1 },
  ]

  it('cold graph: roots available, dependents locked', () => {
    const avail = computeAvailability({ nodes, edges, states: new Map(), lang: 'en' })
    const byId = new Map(avail.map((a) => [a.node.id, a]))
    expect(byId.get('en:word:go')!.displayState).toBe('available') // root
    expect(byId.get('en:grammar:past-simple')!.displayState).toBe('locked')
    expect(byId.get('en:chunk:used-to')!.displayState).toBe('locked')
    expect(byId.get('en:grammar:past-simple')!.blocking).toEqual(['en:word:go'])
    expect(frontierNodes(avail).map((f) => f.node.id)).toEqual(['en:word:go', 'en:word:went'])
  })

  it('assumed_known prerequisite unlocks the frontier (placement semantics)', () => {
    const states = new Map([
      ['en:word:go', [{ ...newStateShim('en:word:go'), displayState: 'assumed_known' as const }]],
    ])
    const avail = computeAvailability({ nodes, edges, states, lang: 'en' })
    const byId = new Map(avail.map((a) => [a.node.id, a]))
    expect(byId.get('en:grammar:past-simple')!.displayState).toBe('available')
    expect(byId.get('en:chunk:used-to')!.displayState).toBe('locked')
  })

  it('tier = longest prerequisite chain (layout depth)', () => {
    expect(nodeTier('en:word:go', edges)).toBe(0)
    expect(nodeTier('en:grammar:past-simple', edges)).toBe(1)
    expect(nodeTier('en:chunk:used-to', edges)).toBe(2)
    expect(prerequisitesOf('en:chunk:used-to', edges)).toEqual(['en:grammar:past-simple'])
  })
})

/** minimal state shim for availability tests */
function newStateShim(nodeId: string) {
  return {
    userId: 'u1',
    nodeId,
    skill: 'writing' as const,
    stability: 0,
    difficulty: 0,
    due: null,
    lastReviewAt: null,
    reps: 0,
    lapses: 0,
    learningSteps: 0,
    fsrsState: 'New' as const,
    displayState: 'assumed_known' as const,
    strength: 0,
    pendingDelayTest: false,
    delayTestEligibleAt: null,
    masteredAt: null,
    lastAppliedEvidenceId: null,
  }
}
