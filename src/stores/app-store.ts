/**
 * Kiara app store (M5) — the single source of truth for client-side view
 * switching on the `/` route (sandbox constraint: only one route, no client
 * router). Also owns the chat session state so views can unmount/remount
 * without losing the conversation.
 */
'use client'

import { create } from 'zustand'
import type { PublicUser, PickedScenarioLite, SessionEndSummary, TurnMeta } from '@/lib/client/api'

export type AppView = 'landing' | 'auth' | 'onboarding' | 'home' | 'chat' | 'tree' | 'seeds'

export interface ChatMessage {
  id: string
  role: 'tutor' | 'user'
  /** English conversation text (rendered LTR inside the RTL layout) */
  content: string
  meta?: TurnMeta
}

export type SessionStatus = 'idle' | 'starting' | 'active' | 'ending' | 'ended'

export interface ChatState {
  sessionId: string | null
  scenario: PickedScenarioLite | null
  briefKnownLexicon: { A1: number; A2: number; B1: number } | null
  messages: ChatMessage[]
  status: SessionStatus
  startedAt: number | null
  /** ms timestamp when the last tutor call began (typing indicator) */
  typingSince: number | null
  turnCount: number
  summary: SessionEndSummary | null
  endStats: { applied: number; seeds: number } | null
}

interface AppState {
  /** auth check finished at least once (guards against flash-of-landing) */
  booted: boolean
  user: PublicUser | null
  view: AppView
  chat: ChatState

  setBooted: (b: boolean) => void
  setUser: (u: PublicUser | null) => void
  setView: (v: AppView) => void

  setChatStatus: (s: SessionStatus) => void
  beginChat: (args: {
    sessionId: string
    scenario: PickedScenarioLite
    knownLexicon: { A1: number; A2: number; B1: number }
    opener: string
    openerMeta: TurnMeta
  }) => void
  /** user message appended instantly; tutor reply arrives later */
  appendUserMessage: (content: string) => string
  appendTutorMessage: (content: string, meta: TurnMeta) => void
  setTyping: (since: number | null) => void
  setChatEnded: (args: { summary: SessionEndSummary; applied: number }) => void
  resetChat: () => void
}

const initialChat: ChatState = {
  sessionId: null,
  scenario: null,
  briefKnownLexicon: null,
  messages: [],
  status: 'idle',
  startedAt: null,
  typingSince: null,
  turnCount: 0,
  summary: null,
  endStats: null,
}

let msgSeq = 0
const nextMsgId = () => `m${++msgSeq}-${Date.now()}`

export const useAppStore = create<AppState>((set) => ({
  booted: false,
  user: null,
  view: 'landing',
  chat: initialChat,

  setBooted: (booted) => set({ booted }),
  setUser: (user) => set({ user }),
  setView: (view) => set({ view }),

  setChatStatus: (status) => set((s) => ({ chat: { ...s.chat, status } })),
  beginChat: ({ sessionId, scenario, knownLexicon, opener, openerMeta }) =>
    set((s) => ({
      chat: {
        ...initialChat,
        sessionId,
        scenario,
        briefKnownLexicon: knownLexicon,
        status: 'active',
        startedAt: Date.now(),
        messages: [
          { id: nextMsgId(), role: 'tutor' as const, content: opener, meta: openerMeta },
        ],
      },
    })),
  appendUserMessage: (content) => {
    const id = nextMsgId()
    set((s) => ({
      chat: { ...s.chat, messages: [...s.chat.messages, { id, role: 'user' as const, content }] },
    }))
    return id
  },
  appendTutorMessage: (content, meta) =>
    set((s) => ({
      chat: {
        ...s.chat,
        messages: [...s.chat.messages, { id: nextMsgId(), role: 'tutor' as const, content, meta }],
        typingSince: null,
        turnCount: s.chat.turnCount + 1,
      },
    })),
  setTyping: (typingSince) => set((s) => ({ chat: { ...s.chat, typingSince } })),
  setChatEnded: ({ summary, applied }) =>
    set((s) => ({
      chat: {
        ...s.chat,
        status: 'ended',
        typingSince: null,
        summary,
        endStats: {
          applied,
          seeds: summary.seeds?.length ?? 0,
        },
      },
    })),
  resetChat: () => set({ chat: initialChat }),
}))

/** where a freshly authenticated user should land (docs/05 M2/M5 flow) */
export function landingViewFor(user: PublicUser | null): AppView {
  if (!user) return 'landing'
  return user.onboardingComplete ? 'home' : 'onboarding'
}

// Dev/browser-test affordance: lets agent-browser scripts drive the store
// (inject messages, verify UI paths). No state, no secrets — just the hook.
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__kiaraStore = useAppStore
}
