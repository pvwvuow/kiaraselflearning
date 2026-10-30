/**
 * Engine purity guard (docs/01 §"Non-negotiable invariants" #1):
 * src/lib/engine/** must not import prisma, next, or any LLM SDK.
 * Also: no Date.now()/new Date() without injection — enforced by a source scan.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ENGINE_DIR = path.resolve(__dirname, '../../src/lib/engine')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

describe('engine purity', () => {
  const files = walk(ENGINE_DIR)

  it('engine directory is non-empty', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('imports nothing from prisma / next / llm / z-ai', () => {
    const banned = /from\s+['"](@prisma\/client|prisma|next|@\/lib\/db|z-ai-web-dev-sdk|@\/lib\/llm)/
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src, `${f} imports a banned module`).not.toMatch(banned)
    }
  })

  it('no ambient clock (Date.now / new Date() with no args) inside engine', () => {
    const ambient = /Date\.now\(\)|new Date\(\)/
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src, `${f} uses an ambient clock`).not.toMatch(ambient)
    }
  })

  it('config exposes the documented constants (spot check)', async () => {
    const cfg = (await import('@/lib/engine/config')).ENGINE_CONFIG
    expect(cfg.REQUEST_RETENTION).toBe(0.85)
    expect(cfg.GAP_SESSION_THRESHOLD).toBe(2)
    expect(cfg.GAP_SESSION_THRESHOLD_ERROR_PATTERN).toBe(3)
    expect(cfg.WEEKLY_SEED_CAP).toBe(3)
    expect(cfg.SEED_SCORE_THRESHOLD).toBe(0.45)
    expect(cfg.MASTERY_MIN_STABILITY).toBe(21)
    expect(cfg.FADING_R).toBe(0.75)
  })
})
