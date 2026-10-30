/**
 * MetricEvent helper (docs/00 §4 metric plan, docs/02 MetricEvent) — the ONE
 * way to append a metric row. Write-only analytics: best-effort by design, a
 * metric failure must never break a user flow.
 *
 * Names emitted across the app (the documented set):
 *   session_start · session_end · evidence_created · evidence_disputed ·
 *   evidence_applied · delay_test_offered · delay_test_result ·
 *   seed_proposed · seed_approved · seed_rejected · iplus1_violation ·
 *   analyst_parse_fail · placement_applied · llm_call · safety_blocked
 */
import { db } from '@/lib/db'

export type MetricName =
  | 'session_start'
  | 'session_end'
  | 'evidence_created'
  | 'evidence_disputed'
  | 'evidence_applied'
  | 'delay_test_offered'
  | 'delay_test_result'
  | 'seed_proposed'
  | 'seed_approved'
  | 'seed_rejected'
  | 'iplus1_violation'
  | 'analyst_parse_fail'
  | 'placement_applied'
  | 'llm_call'
  | 'safety_blocked'

/** Append one metric event — never throws (metrics are write-only, docs/02). */
export async function recordMetric(
  userId: string | null,
  name: MetricName,
  props: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.metricEvent.create({
      data: { userId, name, props: JSON.stringify(props) },
    })
  } catch {
    // analytics must never break a user flow
  }
}
