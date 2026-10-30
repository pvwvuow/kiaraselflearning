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
  /** M8: this tutor turn asks the given delayed-test context (no node ids — C2) */
  probe?: { probeIndex: number; contextIndex: number }
  probeTurn?: boolean
  probesDone?: boolean
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
  reinforced: { nodeId: string; skill: string; grade: string; title: string | null; glossFa: string | null }[]
  fading: { nodeId: string; skill: string; title: string | null; glossFa: string | null }[]
  delayTestResults: {
    nodeId: string
    skill: string
    passed: boolean
    mastered: boolean
    revoked: boolean
    title: string | null
    glossFa: string | null
    correct: number
    total: number
    skipped?: 'incomplete'
  }[]
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

// ── delayed tests (M8) ──

export interface DelayedTestStatusResponse {
  ok: true
  eligible: number
  pending: number
  maxPerSession: number
  contextsPerProbe: number
}

export interface ConfirmatoryStartResponse {
  ok: true
  started: boolean
  sessionId: string | null
  opener: { content: string; meta: TurnMeta } | null
  plan: { probeCount: number; contextsPerProbe: number } | null
  messageFa: string | null
  eligible: number | null
  pendingCount: number | null
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
  /** derived server-side from the stored quiz; optional on the wire */
  band?: string
  optionIndex: number
}

// ── tree (M6) ──

export type TreeDisplayState =
  | 'locked'
  | 'available'
  | 'learning'
  | 'mastered'
  | 'fading'
  | 'assumed_known'

export interface TreeSkillView {
  state: TreeDisplayState
  strength: number
  reps: number
  due: string | null
}

export interface TreeNodeView {
  id: string
  type: string
  cefr: string | null
  rank: number | null
  title: string
  glossFa: string | null
  x: number
  y: number
  tier: number
  state: TreeDisplayState
  /** MVP: listening/speaking always null (UI renders "—") */
  skills: {
    listening: TreeSkillView | null
    speaking: TreeSkillView | null
    reading: TreeSkillView | null
    writing: TreeSkillView | null
  }
  pinned: boolean
  hidden: boolean
  why: string
  userGenerated: boolean
}

export interface TreeResponse {
  ok: true
  lang: string
  nodes: TreeNodeView[]
  edges: { from: string; to: string }[]
  stats: { total: number; hidden: number; byState: Record<string, number> }
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

export interface TreeNodeFlags {
  id: string
  pinned: boolean
  hidden: boolean
}

// ── seeds (M7 — growth inbox) ──

export type SeedStatus = 'proposed' | 'planted' | 'rejected' | 'expired'
export type SeedKind = 'plant_existing' | 'track_pattern'

export interface SeedBreakdown {
  goalRelevance: number
  frequency: number
  readiness: number
  novelty: number
}

export interface SeedEntry {
  id: string
  status: SeedStatus
  kind: SeedKind
  title: string
  glossFa: string | null
  score: number
  breakdown: SeedBreakdown
  reasonFa: string | null
  sample: { produced: string | null; expected: string | null } | null
  errorCount: number
  createdAt: string
  expiresAt: string | null
  decidedAt: string | null
  plantedNodeId: string | null
}

export interface SeedsInboxResponse {
  ok: true
  proposals: SeedEntry[]
  recent: SeedEntry[]
  cap: { planted: number; limit: number }
}

export interface ApproveSeedResponse {
  ok: true
  held: boolean
  cap: { planted: number; limit: number }
  plantedNodeId: string | null
  entry: SeedEntry | null
}

// ── settings (M9) ──

export interface SettingsPatch {
  displayName?: string
  cefrSelf?: string
  goal?: string
  interests?: string[]
  dailyMinutes?: number
  correctionStyle?: string
  consentLlm?: boolean
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

  /** explicit confirmatory (delayed-test) session — docs/05 M8 */
  startConfirmatory: () =>
    post<ConfirmatoryStartResponse>('/api/session/start', { type: 'confirmatory' }),

  /** delayed-test readiness counters for the home card */
  delayedTestStatus: () => jsonFetch<DelayedTestStatusResponse>('/api/delayed-test/status'),

  sendTurn: (sessionId: string, content: string) =>
    post<TurnResponse>('/api/session/turn', { sessionId, content }),

  endSession: (sessionId: string) => post<SessionEndResponse>('/api/session/end', { sessionId }),

  /** stateless adaptive placement: send answers so far, get the next item */
  placementNext: (selfBand: string, answers: PlacementAnswerInput[]) =>
    post<PlacementNextResponse>('/api/placement', { selfBand, answers }),

  /** persist the result: writes assumed_known states + cefrComputed */
  placementFinish: (selfBand: string, answers: PlacementAnswerInput[]) =>
    post<PlacementNextResponse>('/api/placement', { selfBand, answers, finish: true }),

  /** the personal skill tree (semi-fixed layout, persistent positions) */
  tree: () => jsonFetch<TreeResponse>('/api/tree'),

  /** pin/hide a tree node (docs/05 M6 node card actions) */
  treeNodeFlags: (nodeId: string, flags: { pinned?: boolean; hidden?: boolean }) =>
    jsonFetch<TreeNodeFlags>(`/api/tree/${encodeURIComponent(nodeId)}`, {
      method: 'PATCH',
      body: JSON.stringify(flags),
    }),

  /** the seed inbox (docs/05 M7): ranked proposals + weekly-cap meter */
  seeds: () => jsonFetch<SeedsInboxResponse>('/api/seeds'),

  /** approve a proposal — held:true means the weekly cap kept it in queue */
  approveSeed: (seedId: string) =>
    post<ApproveSeedResponse>(`/api/seeds/${encodeURIComponent(seedId)}/approve`),

  /** reject a proposal — the node sits out a 14-day cooldown */
  rejectSeed: (seedId: string) =>
    post<{ ok: true }>(`/api/seeds/${encodeURIComponent(seedId)}/reject`),

  // ── settings (M9) ──

  /** partial profile update (correction style, level, goal, minutes…) */
  patchSettings: (data: SettingsPatch) =>
    jsonFetch<{ ok: true; user: PublicUser }>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  /** download the user's full data as one JSON file */
  exportData: async (): Promise<void> => {
    let res: Response
    try {
      res = await fetch('/api/settings/export', { credentials: 'same-origin' })
    } catch {
      throw new ApiError(0, 'network_error', 'خطای شبکه — اتصال را بررسی کن.')
    }
    if (!res.ok) throw new ApiError(res.status, `http_${res.status}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kiara-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },

  /** delete the account + all user data (cascade) — the cookie is cleared */
  deleteAccount: () =>
    jsonFetch<{ ok: true; deleted: true }>('/api/settings', { method: 'DELETE' }),
}
