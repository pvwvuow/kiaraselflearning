/**
 * Typed fetch client for the Kiara UI (M5). One place that knows every API
 * contract; views never call fetch directly. Errors surface as ApiError with
 * the server's Persian message (`errorFa`) when present.
 *
 * Cookie sessions: `credentials: 'same-origin'` (default) keeps the httpOnly
 * session cookie flowing on every request.
 */

export interface PublicUser {
  id: string
  email: string
  displayName: string | null
  l1: string
  targetLang: string
  cefrSelf: string | null
  cefrComputed: string | null
  goal: string
  interests: string[]
  dailyMinutes: number
  correctionStyle: string
  consentLlmAt: string | null
  onboardingComplete: boolean
}

export interface TurnMeta {
  latencyMs?: number
  model?: string | null
  unknownRate?: number
  unknownWords?: string[]
  rewritten?: boolean
  fallback?: boolean
  opener?: boolean
}

export interface BriefNodeRefLite {
  nodeId: string
  title: string
  cefr: string | null
}

export interface SessionBriefLite {
  knownLexicon: { A1: number; A2: number; B1: number; sampleLemmas: string[] }
  weakNodes: BriefNodeRefLite[]
  frontierNodes: BriefNodeRefLite[]
  activeErrorPatterns: { id: string; desc: string }[]
  scenario: { title: string; role: string; mustElicit: BriefNodeRefLite[] }
}

export interface PickedScenarioLite {
  id: string
  title: string
  role: string
  mustElicit: BriefNodeRefLite[]
}

export interface StartSessionResponse {
  ok: true
  sessionId: string
  brief: SessionBriefLite
  scenario: PickedScenarioLite
  opener: { content: string; meta: TurnMeta }
}

export interface TurnResponse {
  ok: true
  tutor: string
  meta: TurnMeta
  userTurnCount: number
  summaryUpdated: boolean
}

export interface SessionEndSummary {
  reinforced: { nodeId: string; skill: string; grade: string }[]
  fading: { nodeId: string; skill: string }[]
  delayTestResults: unknown[]
  seeds: { seedId: string; nodeId: string | null; score: number; reasonFa: string }[]
  tomorrow: { reviewsDue: number; newCandidates: string[]; remedial: string[] }
}

export interface SessionEndResponse {
  ok: true
  sessionId: string
  /** per-group FSRS applications (count = .length) */
  applied: { nodeId: string; skill: string; rating: string }[]
  propagationEmitted: number
  rootCaused: string[]
  seeds: { seedId: string; nodeId: string | null; score: number; reasonFa: string }[]
  summary: SessionEndSummary
}

// ── placement ──

export interface PlacementItemLite {
  nodeId: string
  band: string
  word: string
  options: string[]
}

export interface PlacementNextResponse {
  ok: true
  next: PlacementItemLite | null
  askedCount: number
  done: boolean
  finalBand?: string | null
  litCount?: number
}

export interface PlacementAnswerInput {
  nodeId: string
  band: string
  optionIndex: number
}

// ── errors ──

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public errorFa?: string,
  ) {
    super(errorFa ?? code)
    this.name = 'ApiError'
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError(0, 'network_error', 'خطای شبکه — اتصال را بررسی کن.')
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  const b = (body ?? {}) as { ok?: boolean; error?: string; errorFa?: string }
  if (!res.ok || b.ok === false) {
    throw new ApiError(res.status, b.error ?? `http_${res.status}`, b.errorFa)
  }
  return body as T
}

function post<T>(url: string, data?: unknown): Promise<T> {
  return jsonFetch<T>(url, { method: 'POST', body: JSON.stringify(data ?? {}) })
}

// ── endpoint wrappers ──

export const api = {
  me: () => jsonFetch<{ ok: true; user: PublicUser }>('/api/auth/me'),

  register: (email: string, password: string, displayName?: string) =>
    post<{ ok: true; user: PublicUser }>('/api/auth/register', {
      email,
      password,
      ...(displayName ? { displayName } : {}),
    }),

  login: (email: string, password: string) =>
    post<{ ok: true; user: PublicUser }>('/api/auth/login', { email, password }),

  logout: () => post<{ ok: true }>('/api/auth/logout'),

  patchOnboarding: (data: {
    cefrSelf: string
    goal: string
    interests: string[]
    dailyMinutes: number
    correctionStyle: string
    consentLlm: boolean
    displayName?: string
  }) =>
    jsonFetch<{ ok: true; user: PublicUser }>('/api/onboarding', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  startSession: () => post<StartSessionResponse>('/api/session/start'),

  sendTurn: (sessionId: string, content: string) =>
    post<TurnResponse>('/api/session/turn', { sessionId, content }),

  endSession: (sessionId: string) => post<SessionEndResponse>('/api/session/end', { sessionId }),

  /** stateless adaptive placement: send answers so far, get the next item */
  placementNext: (selfBand: string, answers: PlacementAnswerInput[]) =>
    post<PlacementNextResponse>('/api/placement', { selfBand, answers }),

  /** persist the result: writes assumed_known states + cefrComputed */
  placementFinish: (selfBand: string, answers: PlacementAnswerInput[]) =>
    post<PlacementNextResponse>('/api/placement', { selfBand, answers, finish: true }),
}
