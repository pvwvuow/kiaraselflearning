/**
 * FSRS wrapper — the ONLY file that touches ts-fsrs.
 * Pure: `now` is always injected by callers.
 * Card ↔ NodeSkillState mapping keeps UserNodeState a complete, rebuildable
 * materialization of the FSRS card (docs/02 §4.3).
 */
import { FSRS, generatorParameters, createEmptyCard, Rating, State, type Card } from 'ts-fsrs'
import { ENGINE_CONFIG } from './config'
import type { FsrsRating, FsrsStateName, NodeSkillState, Skill } from './types'

const fsrs = new FSRS(
  generatorParameters({ request_retention: ENGINE_CONFIG.REQUEST_RETENTION }),
)

export const RATING_TO_TSFSRS: Record<FsrsRating, Rating> = {
  Again: Rating.Again,
  Hard: Rating.Hard,
  Good: Rating.Good,
  Easy: Rating.Easy,
}

const STATE_NAMES: FsrsStateName[] = ['New', 'Learning', 'Review', 'Relearning']
const STATE_VALUES: Record<FsrsStateName, State> = {
  New: State.New,
  Learning: State.Learning,
  Review: State.Review,
  Relearning: State.Relearning,
}

/** Build a ts-fsrs Card from a persisted (or null) NodeSkillState. */
export function stateToCard(state: NodeSkillState | null, now: Date): Card {
  if (!state || state.reps === 0) return createEmptyCard(now)
  return {
    due: state.due ?? now,
    stability: state.stability,
    difficulty: state.difficulty,
    scheduled_days: state.due
      ? Math.max(0, Math.round((state.due.getTime() - (state.lastReviewAt ?? now).getTime()) / 86_400_000))
      : 0,
    reps: state.reps,
    lapses: state.lapses,
    learning_steps: state.learningSteps,
    state: STATE_VALUES[state.fsrsState] ?? State.New,
    last_review: state.lastReviewAt ?? undefined,
  }
}

/** Apply one rating; returns the new FSRS card fields to persist. */
export function applyRating(
  state: NodeSkillState | null,
  rating: FsrsRating,
  now: Date,
): Card {
  const card = stateToCard(state, now)
  const next = fsrs.repeat(card, now)[RATING_TO_TSFSRS[rating]].card
  return next
}

/** Retrievability right now; null when the card has never been reviewed. */
export function retrievability(state: NodeSkillState | null, now: Date): number | null {
  if (!state || !state.lastReviewAt || state.reps === 0) return null
  const card = stateToCard(state, now)
  const r = fsrs.retrievability(card, now)
  return r === null ? null : Number(r)
}

export function cardToStateFields(card: Card): Pick<
  NodeSkillState,
  'stability' | 'difficulty' | 'due' | 'lastReviewAt' | 'reps' | 'lapses' | 'learningSteps' | 'fsrsState'
> {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.due,
    lastReviewAt: card.last_review ?? null,
    reps: card.reps,
    lapses: card.lapses,
    learningSteps: card.learning_steps,
    fsrsState: STATE_NAMES[card.state] ?? 'New',
  }
}

export { createEmptyCard }
export type { Card }
export type { Skill }
