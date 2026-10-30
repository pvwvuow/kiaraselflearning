/**
 * Roleplay scenario catalog (docs/02 §3.2 scenario + docs/04 THE SCENARIO).
 * Must-elicit targets reference REAL graph node ids — they are whitelist-
 * filtered again at brief-build time so a renamed node can never break a session.
 *
 * `pickScenario` is deterministic for (goal, seed): stable per user+day so the
 * same user isn't bounced between scenarios, while still rotating over time.
 */
import type { BriefNodeRef, CefrBand } from '@/lib/engine/types'

export interface ScenarioSpec {
  id: string
  /** Persian title shown to the learner in the UI */
  titleFa: string
  /** who the tutor plays — injected into {{scenario.role}} (English) */
  role: string
  goals: readonly string[]
  /** graph node ids the scenario tries to elicit */
  mustElicit: readonly string[]
}

export const SCENARIOS: readonly ScenarioSpec[] = [
  {
    id: 'hotel-checkin',
    titleFa: 'چک‌این در هتل فرودگاه',
    role: 'the front-desk receptionist at the airport hotel',
    goals: ['travel', 'general'],
    mustElicit: ['en:chunk:there-is-there-are', 'en:chunk:im-afraid', 'en:chunk:make-sure'],
  },
  {
    id: 'lost-luggage',
    titleFa: 'چمدان گم‌شده در فرودگاه',
    role: 'the airline ground-staff agent at the lost-luggage desk',
    goals: ['travel'],
    mustElicit: ['en:chunk:how-many', 'en:chunk:at-least', 'en:grammar:prepositions-time-place'],
  },
  {
    id: 'asking-directions',
    titleFa: 'پرسیدن آدرس در شهر',
    role: 'a friendly passerby who knows the neighborhood well',
    goals: ['travel', 'daily'],
    mustElicit: ['en:chunk:on-the-left', 'en:pragmatic:giving-directions'],
  },
  {
    id: 'restaurant-reservation',
    titleFa: 'رزرو میز در رستوران',
    role: 'the host of a busy restaurant taking a phone reservation',
    goals: ['daily', 'travel', 'general'],
    mustElicit: ['en:pragmatic:restaurant-reservation', 'en:chunk:can-i-have'],
  },
  {
    id: 'weekend-plans',
    titleFa: 'برنامه‌ی آخر هفته',
    role: 'a close friend planning the weekend with the learner',
    goals: ['daily', 'general'],
    mustElicit: ['en:chunk:how-about', 'en:pragmatic:making-plans', 'en:chunk:going-to'],
  },
  {
    id: 'gift-shopping',
    titleFa: 'خرید کادو',
    role: 'the shop assistant in a small gift shop',
    goals: ['daily', 'travel'],
    mustElicit: ['en:pragmatic:shopping-paying', 'en:grammar:comparatives', 'en:chunk:how-many'],
  },
  {
    id: 'pharmacy',
    titleFa: 'داروخانه',
    role: 'the pharmacist behind the counter',
    goals: ['daily', 'travel'],
    mustElicit: ['en:pragmatic:at-the-pharmacy', 'en:grammar:modals-advice-should'],
  },
  {
    id: 'job-interview',
    titleFa: 'مصاحبه‌ی کاری',
    role: 'the hiring manager doing a first interview',
    goals: ['work'],
    mustElicit: ['en:pragmatic:job-interview-basics', 'en:chunk:i-was-wondering', 'en:grammar:modals-obligation'],
  },
  {
    id: 'office-email',
    titleFa: 'ایمیل کاری فوری',
    role: 'a colleague co-writing an important work email',
    goals: ['work'],
    mustElicit: ['en:pragmatic:email-writing-basics', 'en:chunk:look-forward-to', 'en:chunk:on-time'],
  },
  {
    id: 'weather-smalltalk',
    titleFa: 'گپ درباره‌ی هوا با همسایه',
    role: 'a chatty neighbor you meet in the courtyard',
    goals: ['daily', 'general'],
    mustElicit: ['en:pragmatic:small-talk-weather', 'en:chunk:by-the-way', 'en:grammar:present-continuous'],
  },
  {
    id: 'exam-study',
    titleFa: 'آمادگی آزمون زبان',
    role: 'a study partner preparing for the same English exam',
    goals: ['exam'],
    mustElicit: ['en:pragmatic:email-writing-basics', 'en:grammar:quantifiers', 'en:chunk:it-depends'],
  },
  {
    id: 'doctor-visit',
    titleFa: 'وقت دکتر',
    role: 'the receptionist at a medical clinic booking an appointment',
    goals: ['daily', 'travel'],
    mustElicit: ['en:pragmatic:doctor-appointment', 'en:chunk:have-to'],
  },
]

export interface PickedScenario {
  id: string
  title: string
  role: string
  /** mustElicit resolved to BriefNodeRefs against the graph (whitelist-filtered) */
  mustElicit: BriefNodeRef[]
}

/** tiny deterministic string hash (FNV-1a) — stable across runs */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Pick a scenario deterministically for (goal, seed), resolve mustElicit to
 * BriefNodeRefs via the whitelist predicate, and drop unknown node ids.
 */
export function pickScenario(
  goal: string,
  seed: string,
  resolve: (nodeId: string) => BriefNodeRef | null,
): PickedScenario {
  const pool = SCENARIOS.filter((s) => s.goals.includes(goal))
  const list = pool.length > 0 ? pool : SCENARIOS
  const spec = list[hashSeed(seed) % list.length]

  const mustElicit = spec.mustElicit
    .map(resolve)
    .filter((n): n is BriefNodeRef => n !== null)

  return { id: spec.id, title: spec.titleFa, role: spec.role, mustElicit }
}

/** CEFR sort helper for frontier ordering */
export const CEFR_ORDER: Record<CefrBand, number> = { A1: 0, A2: 1, B1: 2 }
