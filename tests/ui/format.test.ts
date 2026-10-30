import { describe, it, expect } from 'vitest'
import {
  faDigits,
  formatDuration,
  formatUnknownRate,
  wordQuestionTemplate,
} from '@/lib/client/format'

describe('faDigits', () => {
  it('converts ASCII digits to Persian digits', () => {
    expect(faDigits('12:05')).toBe('۱۲:۰۵')
    expect(faDigits(42)).toBe('۴۲')
  })

  it('leaves non-digit characters untouched', () => {
    expect(faDigits('word%')).toBe('word%')
  })
})

describe('formatDuration (session timer)', () => {
  it('formats mm:ss with Persian digits', () => {
    expect(formatDuration(0)).toBe('۰:۰۰')
    expect(formatDuration(65_000)).toBe('۱:۰۵')
    expect(formatDuration(600_000)).toBe('۱۰:۰۰')
  })

  it('never goes negative', () => {
    expect(formatDuration(-5000)).toBe('۰:۰۰')
  })
})

describe('formatUnknownRate (subtle i+1 hint)', () => {
  it('returns null for tiny/absent rates (no noise when 0)', () => {
    expect(formatUnknownRate(undefined)).toBeNull()
    expect(formatUnknownRate(0)).toBeNull()
    expect(formatUnknownRate(0.005)).toBeNull()
  })

  it('rounds to a Persian percentage, capped at ۱۰۰٪', () => {
    expect(formatUnknownRate(0.12)).toBe('۱۲٪')
    expect(formatUnknownRate(0.335)).toBe('۳۴٪')
    expect(formatUnknownRate(1.5)).toBe('۱۰۰٪')
  })
})

describe('wordQuestionTemplate (unknown-word chip tap)', () => {
  it('builds an English question for the composer', () => {
    expect(wordQuestionTemplate('luggage')).toBe('What does "luggage" mean?')
  })
})
