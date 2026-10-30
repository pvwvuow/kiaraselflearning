/**
 * M3 acceptance — i+1 checker math (docs/05 M3):
 * "known-list input → rate; violation triggers rewrite path (tested at API level
 * in tests/api/session-flow.test.ts with a mocked LLM)".
 * Exemptions per docs/03 §C: function words, numbers, proper nouns.
 */
import { describe, expect, it } from 'vitest'
import { checkIPlus1, lemmaCandidates, tokenize } from '@/lib/engine/iplus1'

const KNOWN = [
  'airport', 'hotel', 'room', 'want', 'book', 'time', 'go', 'eat', 'food',
  'price', 'night', 'have', 'near', 'tell', 'bag',
]

describe('tokenizer & lemmatizer', () => {
  it('strips punctuation and lowercases', () => {
    expect(tokenize('Hello, world! How are you?')).toEqual(['hello', 'world', 'how', 'are', 'you'])
  })

  it('maps irregular forms and guarded suffixes', () => {
    expect(lemmaCandidates('went')).toContain('go')
    expect(lemmaCandidates('rooms')).toContain('room')
    expect(lemmaCandidates('booking')).toContain('book')
    expect(lemmaCandidates('wanted')).toContain('want')
    expect(lemmaCandidates('goes')).toContain('go')
    // guards: short words are not over-stemmed
    expect(lemmaCandidates('is')).toEqual(['is'])
  })
})

describe('checkIPlus1 math', () => {
  it('all-known reply → rate 0, no violation', () => {
    const r = checkIPlus1({
      reply: 'I want to book a room at the hotel by the airport.',
      knownLemmas: KNOWN,
    })
    expect(r.unknown).toEqual([])
    expect(r.rate).toBe(0)
    expect(r.violation).toBe(false)
  })

  it('counts inflected known words as known (rooms, booked, bags)', () => {
    const r = checkIPlus1({
      reply: 'The rooms are good. I booked your food for the night.',
      knownLemmas: KNOWN,
    })
    expect(r.unknown).toEqual([])
    expect(r.rate).toBe(0)
  })

  it('unknown content words raise the rate (rate = unknown/content)', () => {
    // content: recommendation, hotel, time → 3 ("excellent" is tutor-discourse, exempt)
    // unknown: recommendation only (hotel/time ∈ KNOWN) → 1/3
    const r = checkIPlus1({
      reply: 'The recommendation was excellent for your hotel time.',
      knownLemmas: KNOWN,
    })
    expect(r.unknown).toEqual(['recommendation'])
    expect(r.contentWords).toBe(3)
    expect(r.rate).toBeCloseTo(1 / 3, 5)
    // 3 content words → tiny-reply guard keeps violation false; the 10% rule
    // bites once the reply is long enough — see the maxRate test below
    expect(r.violation).toBe(false)
  })

  it('exempts numbers, prices and proper nouns', () => {
    const r = checkIPlus1({
      reply: 'Room 214 costs 450000 each night. Ali books at 7:30.',
      knownLemmas: KNOWN,
    })
    // exempt: Room (capitalized), 214, 450000, Ali, 7:30 · known: night, books
    expect(r.unknown).toEqual(['costs'])
    expect(r.contentWords).toBe(3) // costs, night, books
    expect(r.violation).toBe(false) // tiny-reply guard: ≤3 content words
  })

  it('maxRate override and the tiny-reply guard behave as documented', () => {
    const reply = 'The zorblist quorblix near the hotel room.'
    // content: zorblist, quorblix, near(known), hotel, room → 5; unknown: 2 → 0.4
    const strict = checkIPlus1({ reply, knownLemmas: KNOWN })
    expect(strict.contentWords).toBe(5)
    expect(strict.rate).toBeCloseTo(0.4, 5)
    expect(strict.violation).toBe(true) // default max 0.1

    const loose = checkIPlus1({ reply, knownLemmas: KNOWN, maxRate: 0.8 })
    expect(loose.violation).toBe(false)

    // sentence-initial capitalized words are exempt (proper-noun heuristic),
    // so use lowercase to build a genuinely tiny unknown reply
    const tiny = checkIPlus1({ reply: 'zorblist quorblix.', knownLemmas: KNOWN })
    expect(tiny.contentWords).toBe(2)
    expect(tiny.violation).toBe(false) // ≤3 content words never violate
  })

  it('allowedTargets (frontier/mustElicit) do not count as unknown', () => {
    const reply = 'You can recommend a good hotel for the night.'
    const withoutTarget = checkIPlus1({ reply, knownLemmas: KNOWN })
    expect(withoutTarget.unknown).toContain('recommend')
    const withTarget = checkIPlus1({ reply, knownLemmas: KNOWN, allowedTargets: ['recommend'] })
    expect(withTarget.unknown).toEqual([])
  })
})
