/**
 * Engine configuration — the single source of every constant.
 * All values are documented; env overrides are applied ONLY at the API layer
 * (never inside the pure core) so tests stay deterministic.
 */

export const ENGINE_CONFIG = {
  // ── FSRS ──
  /** desired retention — aligns the scheduler with the 85% desirable-difficulty target (docs/00 C6) */
  REQUEST_RETENTION: 0.85,

  // ── evidence & grading (docs/03 §A1–A2) ──
  /** min confidence for an item to count as an "observation" (errors, hints) */
  CONFIDENT_EVIDENCE: 0.6,
  /** Σ confidence below this => no FSRS update this session (log only) */
  MIN_AGG_WEIGHT: 0.5,
  /** distinct sessions with confident errors needed to confirm a GAP (error_pattern nodes: 3) */
  GAP_SESSION_THRESHOLD: 2,
  GAP_SESSION_THRESHOLD_ERROR_PATTERN: 3,

  // ── propagation (docs/03 §A4) ──
  /** downstream success must reach this agg to propagate */
  PROPAGATION_MIN_AGG: 0.8,
  /** every evidence item must be at least this confident to allow propagation */
  PROPAGATION_MIN_ITEM_CONFIDENCE: 0.8,
  /** emitted prerequisite-evidence confidence = this × item confidence */
  PROPAGATION_FACTOR: 0.35,
  /** root-cause re-attribution applies when a prerequisite's strength is below this */
  ROOT_CAUSE_MAX_STRENGTH: 0.35,
  /** re-attributed evidence confidence multiplier */
  ROOT_CAUSE_CONFIDENCE_FACTOR: 0.7,

  // ── mastery & delayed tests (docs/03 §A6) ──
  MASTERY_MIN_REPS: 4,
  MASTERY_MIN_STABILITY: 21, // days
  MASTERY_MIN_AGE_DAYS: 3, // since lastReviewAt
  DELAY_TEST_CONTEXTS: 3,
  /** pass = correct/total ≥ this AND minConfidence ≥ 0.8 */
  DELAY_TEST_PASS_RATIO: 2 / 3,
  DELAY_TEST_MIN_CONFIDENCE: 0.8,
  /** planner inserts probes with this probability per session */
  DELAY_TEST_PROBE_PROB: 0.3,
  DELAY_TEST_MAX_PER_SESSION: 2,
  /** after a failed probe, node is re-eligible after this many days */
  DELAY_TEST_RETRY_DAYS: 7,
  /** failed probes since mastery before revocation */
  MASTERY_REVOKE_FAILS: 2,

  // ── fading (docs/03 §A5) ──
  /** display fades when retrievability drops below this … */
  FADING_R: 0.75,
  /** … or when overdue by more than this factor of the scheduled interval … */
  FADING_OVERDUE_FACTOR: 2,
  /** … and at least this many days late */
  FADING_OVERDUE_MIN_DAYS: 3,

  // ── growth (docs/03 §B) ──
  SEED_SCORE_THRESHOLD: 0.45,
  /** max seeds PLANTED in a trailing 7-day window */
  WEEKLY_SEED_CAP: 3,
  SEED_EXPIRY_DAYS: 14,
  /** after rejection, same node is not re-proposed for this many days */
  SEED_REJECT_COOLDOWN_DAYS: 14,

  // ── planner mix (docs/03 §C) — reviews:new:remedial:interest ──
  PLANNER_MIX: { reviews: 0.4, new: 0.25, remedial: 0.2, interest: 0.15 },

  // ── i+1 (docs/03 §C) ──
  /** max unknown content-word rate in tutor replies */
  IPLUS1_MAX_UNKNOWN_RATE: 0.1,

  // ── session brief bounds ──
  BRIEF_MAX_SAMPLE_LEMMAS: 24,
  BRIEF_MAX_WEAK_NODES: 3,
  BRIEF_MAX_FRONTIER_NODES: 3,

  // ── scoring ──
  /** frequency rank bands → factor */
  FREQ_BANDS: [
    { maxRank: 1000, factor: 1.0 },
    { maxRank: 5000, factor: 0.8 },
    { maxRank: 20000, factor: 0.6 },
    { maxRank: Infinity, factor: 0.4 },
  ] as const,
  /** goalRelevance defaults */
  GOAL_DEFAULT_RELEVANCE: 0.6,
  ERROR_PATTERN_RELEVANCE: 0.9,
  ERROR_PATTERN_FREQUENCY: 0.8,
  /** goal → node tags that mark relevance */
  GOAL_TAG_MAP: {
    travel: ['travel', 'airport', 'hotel', 'food', 'restaurant', 'directions', 'shopping', 'smalltalk'],
    work: ['business', 'work', 'meeting', 'email', 'formal', 'office', 'interview', 'phone'],
    exam: ['academic', 'exam', 'essay', 'formal', 'writing'],
    daily: ['daily', 'smalltalk', 'family', 'food', 'home', 'friends'],
    general: [],
  } as Record<string, readonly string[]>,

  // ── placement (docs/00 C1 + R10, docs/05 M1) ──
  /** items drawn per band → 3 bands × 4 = 12 items (the documented ~12) */
  PLACEMENT_POOL_PER_BAND: 4,
  /** multiple-choice options per item (1 correct + 3 distractors) */
  PLACEMENT_OPTIONS: 4,
  /** consecutive correct answers needed before the ladder steps UP one band */
  PLACEMENT_LADDER_UP_STREAK: 2,
  /** one wrong answer steps the ladder DOWN this many bands (1-down) */
  PLACEMENT_LADDER_DOWN_STEPS: 1,
  /** candidate words per band considered before the seeded shuffle (top-frequency slice) */
  PLACEMENT_CANDIDATES_PER_BAND: 12,
  /** strength of a placement-created state (soft, unverified — delayed test will verify) */
  PLACEMENT_STRENGTH: 0.5,
  /** placement writes states for these skills (MVP: written evidence only) */
  PLACEMENT_SKILLS: ['reading', 'writing'] as const,
} as const

export type EngineConfig = typeof ENGINE_CONFIG
