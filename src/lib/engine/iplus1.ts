/**
 * i+1 checker (docs/03 §C, docs/04 §4) — PURE.
 * After each tutor turn: tokenize the reply, lightly lemmatize it, and measure
 * the unknown CONTENT-word rate against the learner's known lexicon.
 * rate > IPLUS1_MAX_UNKNOWN_RATE (0.1) ⇒ violation ⇒ one rewrite pass.
 *
 * Exempt from the "unknown" bucket (docs/03 §C):
 *   function words, numbers, proper nouns. Cognates are handled by the caller
 *   (it can add them to the known set).
 * This file must stay pure: no imports from prisma/next/llm (purity test).
 */
import { ENGINE_CONFIG } from './config'

/** English function words — always allowed, never counted as content words. */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'because', 'as', 'so', 'than', 'that', 'this',
  'these', 'those', 'there', 'here', 'of', 'at', 'by', 'for', 'with', 'about', 'against',
  'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from',
  'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'doing', 'done',
  'have', 'has', 'had', 'having', 'will', 'would', 'shall', 'should', 'can', 'could', 'may',
  'might', 'must', 'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his', 'she',
  'her', 'hers', 'it', 'its', 'we', 'us', 'our', 'ours', 'they', 'them', 'their', 'theirs',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'all', 'any', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'too', 'very', 'just', 'also', 'well', 'yes', 'okay', 'ok', 'oh', 'um', 'uh',
  'please', 'thanks', 'thank', 'welcome', 'hi', 'hello', 'let', 'lets', "let's", 'right',
  // tutor discourse / praise / transitions — always available to the tutor
  'great', 'nice', 'good', 'perfect', 'excellent', 'awesome', 'cool', 'wow', 'alright',
  'exactly', 'sure', 'really', 'quite', 'maybe', 'perhaps', 'now', 'today', 'tomorrow',
  'yesterday', 'always', 'never', 'sometimes', 'usually', 'often', 'soon', 'later', 'first',
  'next', 'last', 'much', 'many', 'lot', 'lots', 'kind', 'sort', 'thing', 'things', 'stuff',
  'one', 'two', 'three', 'four', 'five', 'ten', 'hundred', 'thousand', 'something', 'anything',
  'everything', 'nothing', 'someone', 'anyone', 'everyone', 'no', 'yeah', 'yep', 'hmm',
])

/** Top irregular inflections (lowercase) → lemma. Small by design; the graph
 *  already stores lemmas as titles, so we only need forms a tutor plausibly writes. */
export const IRREGULAR_LEMMAS: Readonly<Record<string, string>> = {
  was: 'be', were: 'be', been: 'be', being: 'be',
  went: 'go', goes: 'go', gone: 'go',
  had: 'have', has: 'have',
  did: 'do', does: 'do',
  said: 'say', says: 'say',
  made: 'make', makes: 'make',
  got: 'get', gets: 'get', gotten: 'get',
  took: 'take', takes: 'take', taken: 'take',
  came: 'come', comes: 'come',
  saw: 'see', sees: 'see', seen: 'see',
  knew: 'know', knows: 'know', known: 'know',
  thought: 'think', thinks: 'think',
  told: 'tell', tells: 'tell',
  found: 'find', finds: 'find',
  gave: 'give', gives: 'give', given: 'give',
  bought: 'buy', buys: 'buy',
  brought: 'bring', brings: 'bring',
  children: 'child', men: 'man', women: 'woman', people: 'person',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad',
  feet: 'foot', teeth: 'tooth',
  ate: 'eat', eaten: 'eat', eats: 'eat',
  drank: 'drink', drunk: 'drink',
  ran: 'run', runs: 'run',
  met: 'meet', meets: 'meet',
  paid: 'pay', pays: 'pay',
  flew: 'fly', flies: 'fly',
  drove: 'drive', drives: 'drive',
  wrote: 'write', writes: 'write', written: 'write',
  spoke: 'speak', speaks: 'speak', spoken: 'speak',
  sat: 'sit', sits: 'sit',
  stood: 'stand', stands: 'stand',
  heard: 'hear', hears: 'hear',
  felt: 'feel', feels: 'feel',
  kept: 'keep', keeps: 'keep',
  sent: 'send', sends: 'send',
  built: 'build', builds: 'build',
  sold: 'sell', sells: 'sell',
  wore: 'wear', wears: 'wear',
  woke: 'wake', wakes: 'wake',
  chose: 'choose', chooses: 'choose', chosen: 'choose',
  began: 'begin', begins: 'begin', begun: 'begin',
  grew: 'grow', grows: 'grow', grown: 'grow',
  held: 'hold', holds: 'hold',
  lost: 'lose', loses: 'lose',
  won: 'win', wins: 'win',
  understood: 'understand', understands: 'understand',
}

export interface IPlus1Input {
  /** tutor reply text (English) */
  reply: string
  /** the learner's known lemmas (graph word titles in known states) */
  knownLemmas: Iterable<string>
  /** this session's allowed NEW targets (frontier / mustElicit titles) */
  allowedTargets?: Iterable<string>
  /** max unknown content-word rate (default from config) */
  maxRate?: number
}

export interface IPlus1Result {
  /** content words after exemptions & lemmatization */
  contentWords: number
  /** unknown lemmas in document order, deduplicated */
  unknown: string[]
  /** unknown / contentWords */
  rate: number
  /** true when rate exceeds the configured maximum */
  violation: boolean
}

interface RawToken {
  raw: string
  clean: string
}

/** Split into whitespace tokens, keeping the raw surface for case/number checks. */
function rawTokens(text: string): RawToken[] {
  return text
    .split(/\s+/)
    .map((raw) => raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')) // trim outer punct
    .filter((raw) => raw.length > 0)
    .map((raw) => ({ raw, clean: raw.replace(/[’']/g, "'").toLowerCase() }))
}

/** Very light lemmatizer: irregular map + guarded -s/-es/-ed/-ing stripping.
 *  Returns ALL plausible stems — the caller matches any of them against the set. */
export function lemmaCandidates(token: string): string[] {
  const out = [token]
  if (IRREGULAR_LEMMAS[token]) out.push(IRREGULAR_LEMMAS[token])
  if (token.length <= 3) return out
  const push = (s: string | null) => {
    if (s) out.push(s)
  }
  const strip = (suffix: string, minStem: number): string | null =>
    token.endsWith(suffix) && token.length - suffix.length >= minStem
      ? token.slice(0, -suffix.length)
      : null
  const ing = strip('ing', 3) // booking → book, running → runn → run
  if (ing) {
    push(ing)
    push(ing.replace(/(.)\1$/, '$1'))
    push(`${ing}e`)
  }
  const ed = strip('ed', 3) // booked → book, stopped → stopp → stop
  if (ed) {
    push(ed)
    push(ed.replace(/(.)\1$/, '$1'))
    push(`${ed}e`)
  }
  const es = strip('es', 3) // boxes → box, goes → go
  if (es) push(es)
  const s = strip('s', 2) // books → book
  if (s) push(s)
  return out
}

/** Public tokenizer (clean, lowercase tokens) — used by tests & callers. */
export function tokenize(text: string): string[] {
  return rawTokens(text).map((t) => t.clean)
}

/** Numbers, times, prices and proper nouns are exempt (docs/03 §C). */
function isExempt(raw: string): boolean {
  if (/^\p{N}+([.,:/]\p{N}+)*$/u.test(raw)) return true
  if (/^\p{Lu}/u.test(raw)) return true // capitalized anywhere ⇒ proper noun
  return false
}

/**
 * The core check. `knownLemmas` holds the user's known word titles (graph);
 * function words are exempted separately so they don't need to be in the set.
 */
export function checkIPlus1(input: IPlus1Input): IPlus1Result {
  const known = new Set<string>()
  for (const w of input.knownLemmas) known.add(w.toLowerCase())
  const targets = new Set<string>()
  for (const w of input.allowedTargets ?? []) {
    targets.add(w.toLowerCase())
    for (const t of rawTokens(w)) targets.add(t.clean) // chunks like "How many…?"
  }

  const maxRate = input.maxRate ?? ENGINE_CONFIG.IPLUS1_MAX_UNKNOWN_RATE
  const tokens = rawTokens(input.reply)

  const unknown: string[] = []
  let contentWords = 0

  for (const t of tokens) {
    if (FUNCTION_WORDS.has(t.clean)) continue
    if (isExempt(t.raw)) continue
    contentWords++

    const stems = lemmaCandidates(t.clean)
    const hit =
      stems.some((f) => known.has(f)) ||
      stems.some((f) => targets.has(f)) ||
      // hyphenated compounds ("check-in") count as known if any part is known
      t.clean.includes('-') && t.clean.split('-').some((p) => known.has(p))
    if (!hit && !unknown.includes(t.clean)) unknown.push(t.clean)
  }

  const rate = contentWords === 0 ? 0 : unknown.length / contentWords
  // tiny replies (≤3 content words) can't meaningfully violate — a greeting
  // like "Hello Ali!" must not trigger rewrites
  const violation = contentWords > 3 && rate > maxRate
  return { contentWords, unknown, rate, violation }
}
