/**
 * Session brief & planner (docs/03 §C).
 * Brief = the bounded, high-signal context the tutor receives INSTEAD of the tree.
 * Planner = the "شروع جلسه" mix (reviews : new : remedial : interest) + delayed probes.
 */
import { ENGINE_CONFIG } from './config'
import { retrievability } from './fsrs'
import type {
  BriefNodeRef,
  NodeSkillState,
  SessionBrief,
  SessionPlan,
  Skill,
} from './types'

// ── brief ──

export interface BriefInput {
  user: SessionBrief['user']
  /** known lemma counts per CEFR band (from states) */
  knownBands: { A1: number; A2: number; B1: number }
  /** sample known lemmas for i+1 anchoring */
  sampleLemmas: string[]
  weakNodes: BriefNodeRef[]
  frontierNodes: BriefNodeRef[]
  activeErrorPatterns: { id: string; desc: string }[]
  scenario: SessionBrief['scenario']
}

export function buildBrief(input: BriefInput): SessionBrief {
  return {
    user: input.user,
    knownLexicon: {
      A1: input.knownBands.A1,
      A2: input.knownBands.A2,
      B1: input.knownBands.B1,
      sampleLemmas: input.sampleLemmas.slice(0, ENGINE_CONFIG.BRIEF_MAX_SAMPLE_LEMMAS),
    },
    weakNodes: input.weakNodes.slice(0, ENGINE_CONFIG.BRIEF_MAX_WEAK_NODES),
    frontierNodes: input.frontierNodes.slice(0, ENGINE_CONFIG.BRIEF_MAX_FRONTIER_NODES),
    activeErrorPatterns: input.activeErrorPatterns.slice(0, 3),
    scenario: input.scenario,
  }
}

/** rough token estimate to keep the brief bounded (~1.5k budget) */
export function estimateBriefTokens(brief: SessionBrief): number {
  const json = JSON.stringify(brief)
  return Math.ceil(json.length / 3.5)
}

/** weak-node ranking: fading & low strength & gaps first */
export function rankWeakNodes(
  states: NodeSkillState[],
  nodes: Map<string, { title: string; glossFa: string | null }>,
  now: Date,
): BriefNodeRef[] {
  return states
    .map((s) => {
      const r = retrievability(s, now) ?? 1
      const score =
        (s.displayState === 'fading' ? 2 : 0) +
        (1 - s.strength) +
        (1 - r) +
        s.lapses * 0.5
      const meta = nodes.get(s.nodeId)
      return {
        id: s.nodeId,
        title: meta?.title ?? s.nodeId,
        glossFa: meta?.glossFa ?? null,
        why:
          s.displayState === 'fading'
            ? 'در حال محو شدن'
            : s.lapses > 0
              ? `${s.lapses} لغزش`
              : 'نیازمند تقویت',
        _score: score,
      }
    })
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...rest }) => rest)
}

// ── planner ──

export interface PlannerInput {
  /** states whose due ≤ now, per skill */
  dueReviews: NodeSkillState[]
  /** frontier nodes (available, not yet practiced) */
  frontier: BriefNodeRef[]
  /** nodes with open gaps / recent Again */
  remedial: BriefNodeRef[]
  /** one interest-derived flavor line, if any */
  interestFlavor: string | null
  dailyMinutes: number
  /** eligible & due delayed-test probes */
  delayTestCandidates: NodeSkillState[]
  /** injected RNG for determinism in tests */
  rng: () => number
}

/** Convert daily minutes to an item budget (~2.5 min/item). */
export function planSession(input: PlannerInput): SessionPlan {
  const budget = Math.max(3, Math.round(input.dailyMinutes / 2.5))
  const mix = ENGINE_CONFIG.PLANNER_MIX

  const nReviews = Math.min(input.dueReviews.length, Math.round(budget * mix.reviews) || 1)
  const nNew = Math.min(input.frontier.length, Math.round(budget * mix.new))
  const nRemedial = Math.min(input.remedial.length, Math.round(budget * mix.remedial))

  // delayed-test probes ride along (docs/03 §A6): p per session, ≤ max
  const probes: NodeSkillState[] = []
  if (input.delayTestCandidates.length > 0 && input.rng() < ENGINE_CONFIG.DELAY_TEST_PROBE_PROB) {
    const shuffled = [...input.delayTestCandidates].sort(() => input.rng() - 0.5)
    probes.push(...shuffled.slice(0, ENGINE_CONFIG.DELAY_TEST_MAX_PER_SESSION))
  }

  return {
    reviews: input.dueReviews.slice(0, nReviews),
    newNodes: input.frontier.slice(0, Math.max(nNew, probes.length > 0 ? 1 : 0)),
    remedial: input.remedial.slice(0, nRemedial),
    interestFlavor: input.interestFlavor,
    delayedTestProbes: probes,
  }
}

/** pick due reviews across skills fairly (round-robin reading/writing) */
export function interleaveBySkill<T extends { skill: Skill }>(items: T[]): T[] {
  const bySkill = new Map<Skill, T[]>()
  for (const it of items) {
    const list = bySkill.get(it.skill) ?? []
    list.push(it)
    bySkill.set(it.skill, list)
  }
  const out: T[] = []
  let added = true
  while (added) {
    added = false
    for (const list of bySkill.values()) {
      const next = list.shift()
      if (next) {
        out.push(next)
        added = true
      }
    }
  }
  return out
}
