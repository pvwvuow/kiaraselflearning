/**
 * Small pure formatting helpers for the Kiara UI (M5). Kept framework-free
 * so they are trivially unit-testable (tests/ui/format.test.ts).
 */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const

/** Convert ASCII digits to Persian digits (UI copy rule: Persian numerals) */
export function faDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)])
}

/** mm:ss wall-clock timer for the session header (Persian digits) */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return faDigits(`${m}:${String(s).padStart(2, '0')}`)
}

/** subtle unknown-rate label, e.g. 0.12 → «۱۲٪ واژه‌های تازه» (null below 1%) */
export function formatUnknownRate(rate: number | undefined): string | null {
  if (rate === undefined || Number.isNaN(rate) || rate < 0.01) return null
  return faDigits(`${Math.min(100, Math.round(rate * 100))}٪`)
}

/** composer template when a learner taps an unknown-word chip */
export function wordQuestionTemplate(word: string): string {
  return `What does "${word}" mean?`
}
