/**
 * Daily LLM token budget (docs/05 M9) — a per-user cost guardrail.
 *
 * Every successful xAI call is recorded as an `llm_call` MetricEvent with its
 * token usage; the day's spend is the sum over today's rows. When the user is
 * over the cap NO further LLM calls happen that day (tutor, analyst, summary —
 * everything), and the user gets a friendly Persian message. The tree keeps
 * working: deterministic flows (confirmatory context texts, fallback replies,
 * end-of-session pipeline) never needed the LLM in the first place.
 *
 * Budget source: env KIARA_DAILY_TOKEN_BUDGET (tokens/day/user). Default
 * 150,000 ≈ a very heavy practice day (~40+ tutor turns) — the cap exists to
 * stop runaway loops, not to limit normal learners.
 */
import { db } from '@/lib/db'
import { recordMetric } from '@/lib/metrics'

export const DEFAULT_DAILY_TOKEN_BUDGET = 150_000

export const BUDGET_MESSAGE_FA =
  'سهمیه‌ی تمرین امروز پر شد — درخت به همان اندازه رشد کرده! 🌱 فردا دوباره ادامه می‌دهیم.'

/** Friendly bilingual notice used as the tutor bubble when over budget (turn flow). */
export const BUDGET_TURN_NOTICE_EN =
  "That's all the practice I can check today — your growth is saved. See you tomorrow!"

export function dailyBudgetFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.KIARA_DAILY_TOKEN_BUDGET ?? '')
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_DAILY_TOKEN_BUDGET
  return Math.floor(raw)
}

/** UTC day start (the same day key the planner/scenario seeding uses). */
export function utcDayStart(now: Date): Date {
  const day = now.toISOString().slice(0, 10)
  return new Date(`${day}T00:00:00.000Z`)
}

/** Sum of tokens recorded for `userId` since `since` (tolerates malformed rows). */
export async function tokensUsedSince(userId: string, since: Date): Promise<number> {
  const rows = await db.metricEvent.findMany({
    where: { userId, name: 'llm_call', createdAt: { gte: since } },
    select: { props: true },
  })
  let total = 0
  for (const r of rows) {
    try {
      const p = JSON.parse(r.props ?? '{}') as { tokens?: unknown }
      const t = Number(p.tokens)
      if (Number.isFinite(t) && t > 0) total += t
    } catch {
      // corrupt row — skip
    }
  }
  return total
}

export interface BudgetState {
  used: number
  limit: number
  remaining: number
  over: boolean
}

/** Read the budget meter for `userId` at `now` (no side effects). */
export async function budgetState(userId: string, now: Date): Promise<BudgetState> {
  const limit = dailyBudgetFromEnv()
  const used = await tokensUsedSince(userId, utcDayStart(now))
  return { used, limit, remaining: Math.max(0, limit - used), over: used >= limit }
}

/** Record one LLM call's usage (call from the wiring layer after each xAI result). */
export async function recordLlmCall(
  userId: string,
  role: 'tutor' | 'analyst',
  promptTokens: number | null,
  completionTokens: number | null,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const p = promptTokens ?? 0
  const c = completionTokens ?? 0
  // usage missing (older providers) → still record the call so caps see *something*
  await recordMetric(userId, 'llm_call', {
    role,
    promptTokens: p,
    completionTokens: c,
    tokens: p + c,
    ...meta,
  })
}
