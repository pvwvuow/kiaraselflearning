/**
 * Zod schemas for auth & onboarding payloads (docs/02 §User).
 * zod v4: top-level factories + string method chains are both available.
 */
import { z } from 'zod'

export const registerSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(8, 'password must be at least 8 characters').max(72), // bcrypt input limit
  displayName: z.string().min(1).max(60).optional(),
})

export const loginSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(72),
})

export const CEFR_SELF_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
export const GOALS = ['travel', 'work', 'exam', 'daily', 'general'] as const
export const CORRECTION_STYLES = ['immediate', 'end_of_session'] as const

export const onboardingSchema = z.object({
  cefrSelf: z.enum(CEFR_SELF_LEVELS),
  goal: z.enum(GOALS),
  interests: z.array(z.string().min(1).max(40)).max(12),
  dailyMinutes: z.number().int().min(5).max(120),
  correctionStyle: z.enum(CORRECTION_STYLES),
  /** explicit xAI consent — persisted as consentLlmAt = NOW when true */
  consentLlm: z.boolean(),
  displayName: z.string().min(1).max(60).optional(),
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type OnboardingInput = z.infer<typeof onboardingSchema>
