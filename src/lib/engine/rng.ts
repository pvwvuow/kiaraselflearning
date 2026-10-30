/**
 * Minimal deterministic RNG helpers (pure — no ambient randomness).
 * Used by the planner (probe p=0.3 flip), the probe sampler and any place
 * that needs reproducible "stochastic" behavior in tests.
 */

/** tiny deterministic string hash (FNV-1a) — stable across runs/processes */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — small, fast, deterministic PRNG in [0,1) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** seeded rng from a string seed — the only helper most call sites need */
export function rngFromSeed(seed: string): () => number {
  return mulberry32(hashString(seed))
}
