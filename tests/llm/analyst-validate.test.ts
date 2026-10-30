/**
 * M4 acceptance — analyst validation pipeline (docs/05 M4):
 * "validation: hallucinated node id → item dropped to new_unknown_words,
 * no state written" + zod shape + fence stripping + ONE repair retry.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  ANALYST_FEW_SHOT,
  ANALYST_SYSTEM_PROMPT,
  analyzeTurn,
  buildAnalystMessages,
  stripFences,
  validateAnalystOutput,
  type AnalystInput,
} from '@/lib/llm/analyst'

const WHITELIST = new Set(['en:word:time', 'en:word:flight', 'en:chunk:could-you', 'en:word:hotel'])

const VALID = JSON.stringify({
  turn_id: 't1',
  items: [
    { node_id: 'en:word:time', skill: 'writing', outcome: 'correct', error_type: null, produced: null, expected: null, l1_interference: false, hint_used: false, response_latency_ms: 100, confidence: 0.9 },
  ],
  new_unknown_words: [],
})

function input(over: Partial<AnalystInput> = {}): AnalystInput {
  return {
    turnId: 't1',
    tutorContext: 'hello',
    learnerText: 'test message',
    knownNodes: [...WHITELIST].map((id) => ({ id, title: id, type: 'word', glossFa: null })),
    targetNodeIds: [],
    ...over,
  }
}

describe('analyst output validation', () => {
  it('accepts a clean output and maps to EvidenceItems', () => {
    const v = validateAnalystOutput(VALID, WHITELIST)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.items).toHaveLength(1)
      expect(v.items[0]).toMatchObject({ nodeId: 'en:word:time', outcome: 'correct', confidence: 0.9, skill: 'writing' })
    }
  })

  it('hallucinated node id → item dropped into new_unknown_words (no state possible)', () => {
    const raw = JSON.stringify({
      turn_id: 't2',
      items: [
        { node_id: 'en:word:time', skill: 'writing', outcome: 'correct', confidence: 0.9 },
        { node_id: 'en:word:recommendation', skill: 'writing', outcome: 'error', confidence: 0.9 },
        { 'node_id': 'en:grammar:future-perfect', 'skill': 'writing', outcome: 'error', confidence: 0.8 },
      ],
      new_unknown_words: [],
    })
    const v = validateAnalystOutput(raw, WHITELIST)
    expect(v.ok).toBe(true)
    if (v.ok) {
      // only the whitelisted item survives — nothing else can reach the state engine
      expect(v.items.map((i) => i.nodeId)).toEqual(['en:word:time'])
      expect(v.newUnknownWords).toContain('recommendation')
      expect(v.newUnknownWords).toContain('future-perfect')
    }
  })

  it('clamps out-of-range confidence (docs/04 §3) instead of rejecting', () => {
    const raw = JSON.stringify({
      turn_id: 't3',
      items: [{ node_id: 'en:word:time', skill: 'writing', outcome: 'correct', confidence: 1.7 }],
      new_unknown_words: [],
    })
    const v = validateAnalystOutput(raw, WHITELIST)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.items[0].confidence).toBe(1)
  })

  it('rejects broken shapes (bad JSON, wrong outcome, missing turn_id)', () => {
    expect(validateAnalystOutput('not json at all', WHITELIST).ok).toBe(false)
    expect(
      validateAnalystOutput(JSON.stringify({ turn_id: 'x', items: [{ node_id: 'en:word:time', skill: 'writing', outcome: 'perfect', confidence: 0.5 }] }), WHITELIST).ok,
    ).toBe(false)
    expect(validateAnalystOutput(JSON.stringify({ items: [] }), WHITELIST).ok).toBe(false)
  })

  it('strips markdown fences (docs/04: no markdown — but tolerate it)', () => {
    expect(stripFences('```json\n[1]\n```')).toBe('[1]')
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}')
    const fenced = '```json\n' + VALID + '\n```'
    const v = validateAnalystOutput(fenced, WHITELIST)
    expect(v.ok).toBe(true)
  })

  it('prompt is docs/04 verbatim and carries the payload structure', () => {
    expect(ANALYST_SYSTEM_PROMPT).toContain('linguistic evidence extractor')
    expect(ANALYST_SYSTEM_PROMPT).toContain('NEVER invent node ids')
    expect(ANALYST_FEW_SHOT).toContain('en:grammar:past-simple-irregular')
    const msgs = buildAnalystMessages(input({ targetNodeIds: ['en:chunk:could-you'] }))
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].role).toBe('user')
    const payload = JSON.parse(msgs[1].content) as { turn_id: string; known_nodes: unknown[]; target_nodes: string[] }
    expect(payload.turn_id).toBe('t1')
    expect(payload.known_nodes).toHaveLength(4)
    expect(payload.target_nodes).toEqual(['en:chunk:could-you'])
  })
})

describe('analyzeTurn — one repair retry (docs/04 §3)', () => {
  it('repairs once after invalid JSON and succeeds', async () => {
    const calls: string[] = []
    const result = await analyzeTurn(input(), {
      chat: async ({ messages }) => {
        calls.push(messages.at(-1)!.content.slice(0, 40))
        if (calls.length === 1) return { ok: true, content: 'oops not json', model: 'm', latencyMs: 1, promptTokens: 1, completionTokens: 1 }
        return { ok: true, content: VALID, model: 'm', latencyMs: 2, promptTokens: 1, completionTokens: 1 }
      },
    })
    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(2)
    expect(result.items).toHaveLength(1)
    // the retry carries the documented repair instruction
    expect(calls[1]).toContain('Your previous output failed validation')
  })

  it('gives up after the second failure — chat is never blocked', async () => {
    let calls = 0
    const result = await analyzeTurn(input(), {
      chat: async () => {
        calls++
        return { ok: true, content: 'still not json', model: 'm', latencyMs: 1, promptTokens: 1, completionTokens: 1 }
      },
    })
    expect(calls).toBe(2)
    expect(result.ok).toBe(false)
    expect(result.items).toEqual([])
    expect(result.error).toBeTruthy()
  })

  it('transport failure also uses the single retry', async () => {
    let calls = 0
    const result = await analyzeTurn(input(), {
      chat: async () => {
        calls++
        return { ok: false, error: 'HTTP 503', status: 503, latencyMs: 1 }
      },
    })
    expect(calls).toBe(2)
    expect(result.ok).toBe(false)
  })

  it('uses the injected whitelist when provided', async () => {
    const spy = vi.fn()
    const result = await analyzeTurn(input(), {
      whitelist: new Set(['en:word:flight']),
      chat: async ({ messages }) => {
        spy(JSON.parse(messages[1].content))
        return {
          ok: true,
          content: JSON.stringify({ turn_id: 't1', items: [{ node_id: 'en:word:flight', skill: 'writing', outcome: 'correct', confidence: 0.9 }], new_unknown_words: [] }),
          model: 'm',
          latencyMs: 1,
          promptTokens: 1,
          completionTokens: 1,
        }
      },
    })
    expect(result.ok).toBe(true)
    expect(result.items.map((i) => i.nodeId)).toEqual(['en:word:flight'])
  })
})
