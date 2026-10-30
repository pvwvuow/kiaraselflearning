'use client'

/**
 * AppRoot (M5) — the single-route shell. Boots the session (`/api/auth/me`)
 * once, then switches between client-side views (zustand store). The sandbox
 * exposes only the `/` route, so chat / onboarding / auth all live here.
 */
import { useEffect } from 'react'
import { Sprout } from 'lucide-react'
import { useAppStore, landingViewFor } from '@/stores/app-store'
import { api } from '@/lib/client/api'
import LandingView from './landing-view'
import AuthView from './auth-view'
import OnboardingView from './onboarding-view'
import HomeView from './home-view'
import ChatView from './chat-view'

export default function AppRoot() {
  const booted = useAppStore((s) => s.booted)
  const view = useAppStore((s) => s.view)
  const setBooted = useAppStore((s) => s.setBooted)
  const setUser = useAppStore((s) => s.setUser)
  const setView = useAppStore((s) => s.setView)

  useEffect(() => {
    let alive = true
    api
      .me()
      .then((r) => {
        if (!alive) return
        setUser(r.user)
        setView(landingViewFor(r.user))
      })
      .catch(() => {
        if (!alive) return
        setUser(null)
        setView('landing')
      })
      .finally(() => {
        if (alive) setBooted(true)
      })
    return () => {
      alive = false
    }
  }, [setUser, setView, setBooted])

  if (!booted) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="min-h-dvh flex flex-col items-center justify-center gap-3 text-muted-foreground"
      >
        <Sprout className="size-8 animate-pulse text-primary" aria-hidden />
        <p className="text-sm">کیارا در حال آماده‌سازی…</p>
      </div>
    )
  }

  switch (view) {
    case 'auth':
      return <AuthView />
    case 'onboarding':
      return <OnboardingView />
    case 'home':
      return <HomeView />
    case 'chat':
      return <ChatView />
    case 'landing':
    default:
      return <LandingView />
  }
}
