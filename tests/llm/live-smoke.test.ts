/**
 * M3 acceptance — LIVE smoke: one real grok-4.7 call returns an in-character
 * reply. Guarded by the KIARA_LIVE_SMOKE env flag (docs/05 M3):
 *
 *   KIARA_LIVE_SMOKE=1 bun run test tests/llm/live-smoke.test.ts
 *
 * Reads XAI_API_KEY from .env directly (vitest does not auto-load it).
 * Skipped silently in normal runs — CI never hits the network.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { xaiChat } from '@/lib/llm/xai'

function envFromFile(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const raw = readFileSync(path.resolve(process.cwd(), '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* no .env — the skipIf guard handles it */
  }
  return out
}

const env = { ...envFromFile(), ...process.env }

describe.skipIf(!env.KIARA_LIVE_SMOKE || !env.XAI_API_KEY)('live smoke (KIARA_LIVE_SMOKE=1)', () => {
  it('one real tutor call returns an in-character English reply', { timeout: 45_000 }, async () => {
    const res = await xaiChat({
      role: 'tutor',
      temperature: 0.8,
      maxTokens: 120,
      messages: [
        {
          role: 'system',
          content:
            'You are "Kiara", a warm English tutor for a Persian-speaking beginner (A1). ' +
            'You play the receptionist at the airport hotel. Chat IN ENGLISH. Keep it under 40 words.',
        },
        { role: 'user', content: 'hello, i need room for two nights' },
      ],
    }, { env })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.content.length).toBeGreaterThan(5)
      expect(res.model).toContain('grok')
      // in-character: English reply ending with an invitation/question
      expect(res.content).toMatch(/[?!.]$/)
    }
  })
})
