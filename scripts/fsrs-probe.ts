/**
 * FSRS numeric probe — produces the REAL numbers used in docs/03-engines.md
 * Simulates the "Could you...?" chunk lifecycle across sessions.
 * Run: bun scripts/fsrs-probe.ts
 */
import { FSRS, generatorParameters, createEmptyCard, Rating, type Card } from 'ts-fsrs'
import { addDays } from './fsrs-probe-date'

const params = generatorParameters()
const f = new FSRS(params)
const STATE_NAMES = ['New', 'Learning', 'Review', 'Relearning'] as const
const RATING_NAMES = ['Manual', 'Again', 'Hard', 'Good', 'Easy'] as const

function show(label: string, card: Card, day: number) {
  const r = f.retrievability(card, new Date(addDays(card.last_review!, day)))
  console.log(
    `${label.padEnd(48)} S=${card.stability.toFixed(2)}d D=${card.difficulty.toFixed(2)} ` +
    `state=${STATE_NAMES[card.state]} reps=${card.reps} lapses=${card.lapses} ` +
    `due=+${((card.due.getTime() - card.last_review!.getTime()) / 86400000).toFixed(1)}d ` +
    `R(+${day}d)=${r === null ? '-' : (+r).toFixed(3)}`
  )
}

console.log('=== FSRS probe: node "en:chunk:could-you", skill=writing ===')
let card = createEmptyCard(new Date('2026-11-01T10:00:00Z'))

// Session 1 (day 0): evidence [correct c=0.9, correct c=0.85] -> aggregate 1.0, first exposure -> Good
let rec = f.repeat(card, new Date('2026-11-01T10:00:00Z'))
card = rec[Rating.Good].card
show('S1 d0  Good (first exposure, 2x correct)', card, 0)

// Session 2 (day +2): [correct c=0.95] -> Good
rec = f.repeat(card, new Date('2026-11-03T10:00:00Z'))
card = rec[Rating.Good].card
show('S2 d2  Good (correct)', card, 0)

// Session 3 (day +6): [error c=0.95] -> single error, count<2 across sessions -> Hard (no demotion)
rec = f.repeat(card, new Date('2026-11-07T10:00:00Z'))
card = rec[Rating.Hard].card
show('S3 d6  Hard (single error = observation only)', card, 0)

// Session 4 (day +13): [error c=0.9, error c=0.85] -> 3 errors across >=3 sessions -> gap confirmed -> Again
rec = f.repeat(card, new Date('2026-11-14T10:00:00Z'))
card = rec[Rating.Again].card
show('S4 d13 Again (gap confirmed, 3rd error)', card, 0)

// relearning step (day +14): [correct c=0.9] -> Good
rec = f.repeat(card, new Date('2026-11-15T10:00:00Z'))
card = rec[Rating.Good].card
show('S5 d14 Good (relearned)', card, 0)

// steady growth
for (const [d, rating, label] of [
  ['2026-11-20', Rating.Good, 'S6 d20 Good'],
  ['2026-12-01', Rating.Good, 'S7 d31 Good'],
  ['2026-12-20', Rating.Good, 'S8 d50 Good'],
] as const) {
  rec = f.repeat(card, new Date(d + 'T10:00:00Z'))
  card = rec[rating].card
  show(label, card, 0)
}
console.log(`\nmastery eligibility: stability ${card.stability.toFixed(1)}d >= 21d? ${card.stability >= 21}`)

// retrievability decay for a strong card — fading display threshold
console.log('\n=== retrievability decay after last review (fading threshold R<0.70) ===')
for (const d of [1, 3, 7, 14, 21, 30, 45, 60]) {
  const r = f.retrievability(card, new Date(addDays(card.last_review!, d)))
  console.log(`  +${String(d).padStart(2)}d  R=${(+r!).toFixed(3)}${+r! < 0.7 ? '   <- fading (display)' : ''}`)
}

// First-exposure comparison table for docs
console.log('\n=== first-review ratings from New (S0/D0/due0) ===')
for (const rating of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
  const c0 = createEmptyCard(new Date('2026-11-01T10:00:00Z'))
  const r0 = f.repeat(c0, new Date('2026-11-01T10:00:00Z'))[rating].card
  console.log(
    `  ${RATING_NAMES[rating].padEnd(5)} -> S=${r0.stability.toFixed(2)}d D=${r0.difficulty.toFixed(2)} ` +
    `due in ${((r0.due.getTime() - r0.last_review!.getTime()) / 3600000).toFixed(1)}h`
  )
}
