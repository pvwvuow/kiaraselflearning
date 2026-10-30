/**
 * Placement engine (docs/00 C1 + R10, docs/05 M1) — PURE, deterministic.
 *
 * C1: placement lights up the core as `assumed_known` — it counts for
 * prerequisite readiness and i+1 vocabulary, it is NEVER mastery, and it gets
 * priority delayed-test sampling (pendingDelayTest=true, eligible now) because
 * it is the cheapest place to catch placement errors.
 * R10: adaptive band quiz — start at the self-reported band, 2-up/1-down
 * ladder over mixed word micro-probes, ~12 items.
 *
 * Everything is data-in/data-out: nodes are passed in, `now` is injected,
 * randomness comes from a seeded PRNG (mulberry32) so runs are reproducible.
 * The writer returns state DRAFTS — persistence belongs to the API layer.
 */
import { ENGINE_CONFIG } from './config'
import { CEFR_BANDS } from './types'
import type {
  CefrBand,
  EngineNode,
  NodeSkillState,
  PlacementAnswer,
  PlacementItem,
  PlacementLadderResult,
  PlacementQuiz,
  Skill,
} from './types'

// ── deterministic PRNG (no Math.random anywhere — tests must be reproducible) ──

/** mulberry32 — small, fast, deterministic 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ── band helpers ──

export function isCefrBand(v: string | null | undefined): v is CefrBand {
  return v === 'A1' || v === 'A2' || v === 'B1'
}

export function bandIndex(b: CefrBand): number {
  return CEFR_BANDS.indexOf(b)
}

export function clampBand(i: number): CefrBand {
  const idx = Math.max(0, Math.min(CEFR_BANDS.length - 1, i))
  return CEFR_BANDS[idx]
}

// ── quiz construction ──

interface Candidate {
  node: EngineNode
  gloss: string
}

/**
 * Build the placement quiz: a pool of word micro-probes per band.
 * Candidates = the top-frequency slice of each band's glossed words, shuffled
 * by the seed; distractors = same-band glosses (calibrated difficulty).
 * Self-report only sets the starting band — the ladder does the rest (R10).
 */
export function buildPlacementQuiz(
  nodes: EngineNode[],
  selfBand: CefrBand,
  seed: number,
): PlacementQuiz {
  const rng = mulberry32(seed)
  const pools: Record<CefrBand, PlacementItem[]> = { A1: [], A2: [], B1: [] }

  for (const band of CEFR_BANDS) {
    const candidates: Candidate[] = nodes
      .filter(
        (n) =>
          n.type === 'word' &&
          n.cefr === band &&
          typeof n.glossFa === 'string' &&
          n.glossFa.length > 0,
      )
      .sort((a, b) => {
        // top-frequency first (nulls last), id as final tiebreaker for stability
        const ra = a.frequencyRank ?? Number.MAX_SAFE_INTEGER
        const rb = b.frequencyRank ?? Number.MAX_SAFE_INTEGER
        return ra - rb || (a.id < b.id ? -1 : 1)
      })
      .slice(0, ENGINE_CONFIG.PLACEMENT_CANDIDATES_PER_BAND)
      .map((n) => ({ node: n, gloss: n.glossFa as string }))

    const picked = shuffle(rng, candidates).slice(0, ENGINE_CONFIG.PLACEMENT_POOL_PER_BAND)

    for (const c of picked) {
      // distractors: distinct same-band glosses ≠ correct, seeded order
      const glossPool = shuffle(
        rng,
        [...new Set(candidates.map((x) => x.gloss))].filter((g) => g !== c.gloss),
      )
      const distractors = glossPool
        .slice(0, ENGINE_CONFIG.PLACEMENT_OPTIONS - 1)
        // top up from other bands if this band is tiny (synthetic/test graphs)
        .concat(
          shuffle(
            rng,
            [...new Set(nodes.filter((n) => n.type === 'word').map((n) => n.glossFa ?? ''))].filter(
              (g) => g && g !== c.gloss && !glossPool.includes(g),
            ),
          ),
        )
        .slice(0, ENGINE_CONFIG.PLACEMENT_OPTIONS - 1)

      const options = shuffle(rng, [c.gloss, ...distractors])
      const correctIndex = options.indexOf(c.gloss)
      pools[band].push({
        nodeId: c.node.id,
        band,
        word: c.node.title,
        options,
        correctIndex,
      })
    }
  }

  return { startBand: selfBand, pools }
}

/**
 * Pick the next unused item for the ladder's current band; when the band pool
 * is exhausted, borrow from the nearest band below (easier) then above.
 * Returns null only when every pool is empty.
 */
export function pickItemForBand(
  quiz: PlacementQuiz,
  band: CefrBand,
  usedNodeIds: Set<string>,
): PlacementItem | null {
  const order: CefrBand[] = [band]
  for (let d = 1; d < CEFR_BANDS.length; d++) {
    const lo = clampBand(bandIndex(band) - d)
    if (!order.includes(lo)) order.push(lo)
    const hi = clampBand(bandIndex(band) + d)
    if (!order.includes(hi)) order.push(hi)
  }
  for (const b of order) {
    const item = quiz.pools[b].find((it) => !usedNodeIds.has(it.nodeId))
    if (item) return item
  }
  return null
}

// ── ladder (2-up / 1-down) ──

/**
 * Walk the classic staircase: 2 consecutive correct → step UP one band;
 * 1 wrong → step DOWN one band (floored at A1). The recorded answers carry
 * the band each item was issued at.
 *
 * Final band = the HIGHEST band whose correct/wrong balance is positive
 * (majority rule). Rationale: reaching a band through the ladder implies the
 * band below was passed twice consecutively, so a single lucky answer cannot
 * skip a whole band — but a majority-negative band must not be claimed.
 * No band with a positive balance → null (absolute beginner; C2a: the tutor
 * then uses the scripted ultra-light register and nothing is lit).
 */
export function runLadder(startBand: CefrBand, answers: PlacementAnswer[]): PlacementLadderResult {
  const perBand: Record<CefrBand, { correct: number; wrong: number }> = {
    A1: { correct: 0, wrong: 0 },
    A2: { correct: 0, wrong: 0 },
    B1: { correct: 0, wrong: 0 },
  }

  let bandIdx = bandIndex(startBand)
  let streak = 0
  let reachedIdx = bandIdx

  for (const a of answers) {
    const b = isCefrBand(a.band) ? a.band : CEFR_BANDS[0]
    if (a.correct) perBand[b].correct++
    else perBand[b].wrong++

    if (a.correct) {
      streak++
      if (streak >= ENGINE_CONFIG.PLACEMENT_LADDER_UP_STREAK && bandIdx < CEFR_BANDS.length - 1) {
        bandIdx += 1
        streak = 0
      }
    } else {
      bandIdx = Math.max(0, bandIdx - ENGINE_CONFIG.PLACEMENT_LADDER_DOWN_STEPS)
      streak = 0
    }
    reachedIdx = Math.max(reachedIdx, bandIdx)
  }

  let finalIdx: number | null = null
  for (let i = 0; i < CEFR_BANDS.length; i++) {
    const t = perBand[CEFR_BANDS[i]]
    if (t.correct > t.wrong) finalIdx = i
  }

  return {
    finalBand: finalIdx === null ? null : CEFR_BANDS[finalIdx],
    reachedBand: CEFR_BANDS[reachedIdx],
    perBand,
  }
}

// ── apply: light the core as assumed_known (NEVER mastered) ──

/**
 * Produce the UserNodeState drafts placement grants: every WORD node at or
 * below the final band, for both written skills. The graph curation guarantees
 * that set is the top-frequency core (C2a), so no extra rank filter is needed.
 *
 * Chunks/grammar/pragmatic nodes are deliberately NOT lit — they must be
 * reached through prerequisite learning, and lighting them would bypass the
 * tree. Non-word states carry `assumed_known`, fresh FSRS cards (New, reps=0)
 * and `pendingDelayTest=true` with `delayTestEligibleAt=now` (C1 priority
 * sampling). `masteredAt` stays null — always.
 */
export function applyPlacement(
  nodes: EngineNode[],
  ladder: PlacementLadderResult,
  userId: string,
  now: Date,
): NodeSkillState[] {
  if (!ladder.finalBand) return [] // absolute beginner: light nothing (C2a)

  const cutoff = bandIndex(ladder.finalBand)
  const skills = ENGINE_CONFIG.PLACEMENT_SKILLS as readonly Skill[]
  const drafts: NodeSkillState[] = []

  for (const node of nodes) {
    if (node.type !== 'word') continue
    if (!isCefrBand(node.cefr)) continue
    if (bandIndex(node.cefr) > cutoff) continue
    for (const skill of skills) {
      drafts.push({
        userId,
        nodeId: node.id,
        skill,
        stability: 0,
        difficulty: 0,
        due: null,
        lastReviewAt: null,
        reps: 0,
        lapses: 0,
        learningSteps: 0,
        fsrsState: 'New',
        displayState: 'assumed_known',
        strength: ENGINE_CONFIG.PLACEMENT_STRENGTH,
        pendingDelayTest: true,
        delayTestEligibleAt: new Date(now.getTime()),
        masteredAt: null,
        lastAppliedEvidenceId: null,
      })
    }
  }
  return drafts
}
