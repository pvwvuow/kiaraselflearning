'use client'

/**
 * Home view (M5) — the signed-in hub: start a chat session, placeholders for
 * the tree (M6), seed inbox (M7) and settings (M9), plus logout. Kept light —
 * the product lives in the chat.
 */
import { useState } from 'react'
import {
  Sprout,
  MessageCircle,
  GitBranch,
  Inbox,
  Settings,
  LogOut,
  Loader2,
  Clock,
  Target,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, ApiError } from '@/lib/client/api'
import { faDigits } from '@/lib/client/format'
import { useAppStore } from '@/stores/app-store'

const GOAL_FA: Record<string, string> = {
  travel: 'سفر',
  work: 'کار',
  exam: 'آزمون',
  daily: 'زندگی روزمره',
  general: 'عمومی',
}

export default function HomeView() {
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const setView = useAppStore((s) => s.setView)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // the chat store keeps an in-flight session; ChatView owns reset semantics
  const goChat = () => setView('chat')

  const logout = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.logout()
      setUser(null)
      setView('landing')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'خروج ناموفق بود.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-gradient-to-b from-background to-muted/40">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sprout className="size-5 text-primary" aria-hidden />
            <h1 className="font-bold">کیارا</h1>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void logout()}
            disabled={busy}
            className="gap-1.5"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            <LogOut className="size-4" aria-hidden />
            خروج
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 space-y-5">
        <section aria-labelledby="greeting" className="space-y-1">
          <h2 id="greeting" className="text-xl font-bold">
            سلام {user?.displayName || 'دوست من'} 👋
          </h2>
          <p className="text-sm text-muted-foreground leading-7">
            درخت مهارتت منتظر نیست؛ با هر جمله‌ای که می‌نویسی رشد می‌کند.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {user?.cefrComputed && <Badge variant="secondary">سطح: {user.cefrComputed}</Badge>}
            <Badge variant="outline" className="gap-1">
              <Target className="size-3" aria-hidden />
              هدف: {GOAL_FA[user?.goal ?? 'general'] ?? user?.goal}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Clock className="size-3" aria-hidden />
              روزی {faDigits(user?.dailyMinutes ?? 15)} دقیقه
            </Badge>
          </div>
        </section>

        {/* chat — the MVP core */}
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="size-5 text-primary" aria-hidden />
              گفتگو با مربی
            </CardTitle>
            <CardDescription>
              یک موقعیت واقعی (هتل، رستوران، کار…) باز می‌شود؛ انگلیسی بنویس، مربی جواب می‌دهد و
              درختت از همین حرف‌ها تغذیه می‌شود.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={goChat} size="lg" className="w-full sm:w-auto gap-2">
              <MessageCircle className="size-4" aria-hidden />
              شروع گفتگو
            </Button>
          </CardContent>
        </Card>

        {/* the personal skill tree (M6) */}
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="size-5 text-primary" aria-hidden />
              درخت مهارت
            </CardTitle>
            <CardDescription>
              نقشه‌ی زنده‌ی یادگیریت: گره‌های روشن، مرزِ رشد و گره‌هایی که در حال فراموشی‌اند —
              همه در یک نگاه.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setView('tree')} variant="outline" size="lg" className="w-full sm:w-auto gap-2">
              <GitBranch className="size-4" aria-hidden />
              دیدن درخت
            </Button>
          </CardContent>
        </Card>

        {/* future views (M7/M9) — honest placeholders, not fake features */}
        <section aria-labelledby="soon" className="space-y-3">
          <h3 id="soon" className="text-sm font-semibold text-muted-foreground">
            به‌زودی
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="opacity-70" aria-disabled>
              <CardContent className="pt-5 space-y-1.5">
                <Inbox className="size-5 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium">صندوق بذرها</p>
                <p className="text-xs text-muted-foreground leading-6">مایل‌استون M7 — پیشنهادهای رشد</p>
              </CardContent>
            </Card>
            <Card className="opacity-70" aria-disabled>
              <CardContent className="pt-5 space-y-1.5">
                <Settings className="size-5 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium">تنظیمات</p>
                <p className="text-xs text-muted-foreground leading-6">مایل‌استون M9 — تنظیمات و خروجی داده</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </main>
    </div>
  )
}
