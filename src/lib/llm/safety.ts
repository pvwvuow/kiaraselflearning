/**
 * Content-safety screen (docs/00 #7, docs/05 M9) — the deterministic FIRST
 * line of defense on learner input, before any LLM call:
 *
 *   flagged message → NO tutor call, NO analyst call — the turn gets a warm,
 *   non-accusatory redirect (docs/00 #6: downweight & redirect, never accuse,
 *   never lock out) + a `safety_blocked` metric. The tutor's system prompt is
 *   the second line (docs/04 TONE & SAFETY, hardened in M9).
 *
 * MVP scope is deliberately narrow: the worst categories only, matched with
 * conservative patterns to keep the false-positive rate near zero for genuine
 * language practice (the tutor prompt handles everything subtler).
 * No free-form scenario input exists (pre-vetted bank), so this is the only
 * user-text surface.
 */

export type SafetyCategory =
  | 'sexual_minors'
  | 'sexual_explicit'
  | 'self_harm'
  | 'violence'
  | 'hate'
  | 'illegal'

export interface SafetyVerdict {
  flagged: boolean
  category?: SafetyCategory
}

/** Warm, bilingual redirect used as the tutor bubble for a blocked turn. */
export const SAFETY_REDIRECT_FA =
  'بیا تمرین زبان را سر جای خودش نگه داریم 🌱 — من برای کمک به یادگیری انگلیسی اینجا هستم.'
export const SAFETY_REDIRECT_EN = "Let's keep our practice friendly — tell me about your day instead!"

/**
 * Conservative pattern list (English surface forms; learners write English).
 * Word boundaries + a few spaced variants keep e.g. "classwork" safe while
 * catching the plain forms. This is a floor, not a classifier.
 */
const PATTERNS: { category: SafetyCategory; re: RegExp }[] = [
  // sexual content involving minors — highest severity, widest net on intent words
  { category: 'sexual_minors', re: /\b(child|kid|minor|teen|underage|12[- ]?year|13[- ]?year|14[- ]?year|15[- ]?year|16[- ]?year)\b[^.?!]{0,40}\b(sex|sexual|nude|naked|porn|erotic|fuck)\b/i },
  { category: 'sexual_minors', re: /\b(sex|sexual|nude|naked|porn|erotic|fuck)\b[^.?!]{0,40}\b(child|kid|minor|teen|underage)\b/i },
  // explicit sexual content requests
  { category: 'sexual_explicit', re: /\b(write|describe|roleplay|tell)\b[^.?!]{0,30}\b(sex scene|erotic|porn|nude)\b/i },
  { category: 'sexual_explicit', re: /\b(sex scene|erotic story|porn)\b/i },
  // self-harm encouragement
  { category: 'self_harm', re: /\b(how (to|can i|do i)|help me|tell me)\b[^.?!]{0,30}\b(kill (myself|my self)|commit suicide|cut myself|self[- ]harm|hurt myself)\b/i },
  { category: 'self_harm', re: /\b(suicide|kill myself|end my life)\b/i },
  // violence / weapons against people
  { category: 'violence', re: /\b(how (to|can i|do i))\b[^.?!]{0,30}\b(make (a )?(bomb|explosive|weapon)|build (a )?(bomb|explosive))\b/i },
  { category: 'violence', re: /\b(kill|murder|stab|shoot)\b[^.?!]{0,25}\b(my (wife|husband|mom|mother|dad|father|teacher|boss|friend|neighbor))\b/i },
  // hate / harassment
  { category: 'hate', re: /\b(all (muslims|jews|christians|gays|immigrants|blacks|whites)|every (muslim|jew|gay))\b[^.?!]{0,30}\b(should (die|be killed|burn)|are (animals|vermin|subhuman))\b/i },
  // hard illegal how-tos
  { category: 'illegal', re: /\b(how (to|can i|do i)|help me|tell me how)\b[^.?!]{0,30}\b(launder money|hack( into| in to)? ?(a |the |my |his |her |their )?(bank|account|computer|email|wifi|phone)|steal (a |the |my |his |her |their )?(credit card|car|wallet|password|identity)|make (meth|cocaine|drugs)|buy (guns?|drugs) (illegally|online))\b/i },
]

/** Screen one learner message. Pure — no db, no clock, injectable for tests. */
export function screenUserText(text: string): SafetyVerdict {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return { flagged: false }
  for (const { category, re } of PATTERNS) {
    if (re.test(normalized)) return { flagged: true, category }
  }
  return { flagged: false }
}

/** The deterministic tutor bubble for a blocked turn. */
export function safetyRedirectMessage(): string {
  return `${SAFETY_REDIRECT_EN}\n${SAFETY_REDIRECT_FA}`
}
