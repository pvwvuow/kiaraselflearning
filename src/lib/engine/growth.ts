/**
 * Growth engine — trigger → seed → score → cap (docs/03 §B).
 * MVP trigger: repeated_error only. Planting itself is a DB operation done by
 * the API layer from the SeedDraft; this module stays pure.
 */
import { ENGINE_CONFIG } from './config'
import type {
  DisplayState,
  EngineNode,
  ErrorGroup,
  EvidenceItem,
  NodeType,
  SeedDraft,
  SeedScoreBreakdown,
  TriggerCandidate,
} from './types'

// ── B2: trigger scan (repeated_error) ──

/**
 * Group confident, non-disputed error evidence by (nodeId, errorType) and
 * surface candidates with errors in ≥ GAP_SESSION_THRESHOLD distinct sessions.
 */
export function scanRepeatedErrors(
  errorEvidence: EvidenceItem[],
  opts: {
    /** node ids the user already has an ACTIVE (non-locked) state for */
    activeNodeIds: Set<string>
    /** existing error_pattern node ids (global + user) */
    existingErrorPatternIds: Set<string>
    gapThreshold?: number
  },
): TriggerCandidate[] {
  const threshold = opts.gapThreshold ?? ENGINE_CONFIG.GAP_SESSION_THRESHOLD
  const groups = new Map<string, ErrorGroup>()
  for (const ev of errorEvidence) {
    if (ev.disputed || ev.outcome !== 'error') continue
    if (ev.confidence < ENGINE_CONFIG.CONFIDENT_EVIDENCE) continue
    const key = `${ev.nodeId}::${ev.errorType ?? ''}`
    let g = groups.get(key)
    if (!g) {
      g = { nodeId: ev.nodeId, errorType: ev.errorType ?? null, sessionIds: [], samples: [] }
      groups.set(key, g)
    }
    const sid = String((ev as EvidenceItem & { sessionId?: string }).sessionId ?? '')
    if (sid && !g.sessionIds.includes(sid)) g.sessionIds.push(sid)
    if (g.samples.length < 3) {
      g.samples.push({ produced: ev.produced ?? null, expected: ev.expected ?? null, confidence: ev.confidence })
    }
  }

  const candidates: TriggerCandidate[] = []
  for (const g of groups.values()) {
    if (g.sessionIds.length < threshold) continue
    const planted = opts.activeNodeIds.has(g.nodeId)
    if (!planted) {
      // (a) the node exists in the graph but was never planted for this user
      candidates.push({ kind: 'plant_existing', nodeId: g.nodeId, group: g, requiresNodeCreation: false })
    } else if (!opts.existingErrorPatternIds.has(g.nodeId)) {
      // (b) repeated errors ON a planted node → track the error pattern itself
      candidates.push({ kind: 'track_pattern', nodeId: g.nodeId, group: g, requiresNodeCreation: true })
    }
  }
  return candidates
}

// ── B3: scoring ──

export function goalRelevance(node: EngineNode, goal: string): number {
  if (node.type === 'error_pattern') return ENGINE_CONFIG.ERROR_PATTERN_RELEVANCE
  const tags = new Set(node.tags.map((t) => t.toLowerCase()))
  const goalTags = ENGINE_CONFIG.GOAL_TAG_MAP[goal] ?? []
  if (goalTags.length === 0) return ENGINE_CONFIG.GOAL_DEFAULT_RELEVANCE
  return goalTags.some((t) => tags.has(t)) ? 1.0 : ENGINE_CONFIG.GOAL_DEFAULT_RELEVANCE
}

export function frequencyFactor(node: EngineNode): number {
  if (node.type === 'error_pattern') return ENGINE_CONFIG.ERROR_PATTERN_FREQUENCY
  const rank = node.frequencyRank ?? Infinity
  for (const band of ENGINE_CONFIG.FREQ_BANDS) if (rank <= band.maxRank) return band.factor
  return 0.4
}

const READY_STATES: readonly DisplayState[] = ['available', 'learning', 'mastered', 'fading', 'assumed_known']

/** fraction of prerequisites in a ready state (no prereqs → 1.0) */
export function readinessFactor(prereqStates: readonly DisplayState[]): number {
  if (prereqStates.length === 0) return 1.0
  const ready = prereqStates.filter((s) => READY_STATES.includes(s)).length
  return ready / prereqStates.length
}

export function scoreCandidate(
  candidate: TriggerCandidate,
  ctx: {
    node: EngineNode // the node to plant / the error source node
    goal: string
    prereqStates: readonly DisplayState[]
    userHasActiveState: boolean
  },
): { score: number; breakdown: SeedScoreBreakdown } {
  // BUGFIX (M4, found while wiring the pipeline): track_pattern candidates
  // propose a NEW error_pattern node — the docs/03 §B3 example (en:err:l1-3rd-s
  // → 0.9 × 0.8 × 1 × 1 = 0.72) scores the PATTERN, not the source node, and
  // the pattern node never has a state yet. The previous code scored the source
  // node with novelty=0 (it always has a state), so pattern proposals could
  // never reach the 0.45 bar.
  const trackPattern = candidate.kind === 'track_pattern'
  const goalRel = trackPattern ? ENGINE_CONFIG.ERROR_PATTERN_RELEVANCE : goalRelevance(ctx.node, ctx.goal)
  const freq = trackPattern ? ENGINE_CONFIG.ERROR_PATTERN_FREQUENCY : frequencyFactor(ctx.node)
  const ready = readinessFactor(ctx.prereqStates)
  const novelty = trackPattern ? 1.0 : ctx.userHasActiveState ? 0.0 : 1.0
  const score = goalRel * freq * ready * novelty
  return { score, breakdown: { goalRelevance: goalRel, frequency: freq, readiness: ready, novelty } }
}

// ── seed draft assembly (Persian reason included) ──

export function buildSeedDraft(
  candidate: TriggerCandidate,
  ctx: {
    node: EngineNode
    goal: string
    prereqStates: readonly DisplayState[]
    userHasActiveState: boolean
  },
  now: Date,
): SeedDraft | null {
  const { score, breakdown } = scoreCandidate(candidate, ctx)
  if (score < ENGINE_CONFIG.SEED_SCORE_THRESHOLD) return null

  const g = candidate.group
  const sample = g.samples[0]
  const errorCount = g.sessionIds.length
  const parts: string[] = []
  parts.push(`${toFa(errorCount)} خطای مستقل در ${toFa(g.sessionIds.length)} جلسه`)
  if (sample?.produced) parts.push(`نمونه: «${sample.produced}» به‌جای «${sample.expected ?? '…'}»`)
  if (breakdown.goalRelevance >= 1) parts.push('مرتبط با هدف شما')
  if (breakdown.readiness === 1) parts.push('پیش‌نیازها آماده است')
  const reasonFa = parts.join(' + ')

  return {
    triggerType: 'repeated_error',
    triggerRef: {
      errorCount,
      sessionIds: g.sessionIds,
      sampleProduced: sample?.produced ?? null,
      sampleExpected: sample?.expected ?? null,
      nodeId: g.nodeId,
      dedupeKey: `${g.nodeId}::${g.errorType ?? ''}`,
    },
    candidateNodeId: candidate.kind === 'plant_existing' ? candidate.nodeId : null,
    candidatePayload:
      candidate.kind === 'track_pattern'
        ? {
            type: 'error_pattern' as NodeType,
            title: errorPatternTitle(ctx.node, g.errorType),
            cefr: ctx.node.cefr,
          }
        : null,
    score,
    scoreBreakdown: breakdown,
    reasonFa,
  }
}

function errorPatternTitle(node: EngineNode, errorType: string | null): string {
  const t = errorType ? ` (${errorType})` : ''
  return `${node.title}${t} — recurring error`
}

// ── B4: cap ──

/** true when planting one more seed stays within the weekly cap */
export function capAllows(plantedInWindow: number): boolean {
  return plantedInWindow < ENGINE_CONFIG.WEEKLY_SEED_CAP
}

export function seedExpiry(now: Date): Date {
  return new Date(now.getTime() + ENGINE_CONFIG.SEED_EXPIRY_DAYS * 86_400_000)
}

export function rejectCooldownEnd(now: Date): Date {
  return new Date(now.getTime() + ENGINE_CONFIG.SEED_REJECT_COOLDOWN_DAYS * 86_400_000)
}

// ── helpers ──

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']
function toFa(n: number): string {
  return String(n)
    .split('')
    .map((d) => FA_DIGITS[Number(d)] ?? d)
    .join('')
}
