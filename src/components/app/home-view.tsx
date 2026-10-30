'use client'

/**
 * Home view (M5) — the signed-in hub: start a chat session, placeholders for
 * the tree (M6), seed inbox (M7) and settings (M9), plus logout. Kept light —
 * the product lives in the chat.
 */
import { useState, useEffect } from 'react'
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
  ClipboardCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, ApiError } from '@/lib/client/api'
import type { SeedsInboxResponse, DelayedTestStatusResponse } from '@/lib/client/api'
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
  // M7: pending seed proposals for the inbox card (fetched once, silently)
  const [inbox, setInbox] = useState<SeedsInboxResponse | null>(null)
  // M8: delayed-test readiness for the confirmatory card
  const [delayStatus, setDelayStatus] = useState<DelayedTestStatusResponse | null>(null)
  const [confirmatoryBusy, setConfirmatoryBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .seeds()
      .then((r) => {
        if (alive) setInbox(r)
      })
      .catch(() => {
        /* the inbox card just stays neutral on failure */
      })
    api
      .delayedTestStatus()
      .then((r) => {
        if (alive) setDelayStatus(r)
      })
      .catch(() => {
        /* the confirmatory card just stays neutral on failure */
      })
    return () => {
      alive = false
    }
  }, [])

  /** M8: start an explicit confirmatory (delayed-test) session and jump into it */
  const startConfirmatory = async () => {
    setConfirmatoryBusy(true)
    setError(null)
    try {
      const r = await api.startConfirmatory()
      if (!r.started || !r.sessionId || !r.opener) {
        setError(r.messageFa ?? 'الان گره‌ای برای آزمون تأییدی آماده نیست.')
        return
      }
      useAppStore.getState().beginChat({
        sessionId: r.sessionId,
        scenario: { id: 'confirmatory', title: 'آزمون تأییدی', role: 'examiner', mustElicit: [] },
        knownLexicon: { A1: 0, A2: 0, B1: 0 },
        opener: r.opener.content,
        openerMeta: r.opener.meta,
        mode: 'confirmatory',
        probePlan: r.plan ?? null,
      })
      setView('chat')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'شروع آزمون ناموفق بود.')
    } finally {
      setConfirmatoryBusy(false)
    }
  }

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

        {/* delayed tests (M8) — mastery is confirmed, never assumed */}
        <Card className="border-primary/30" data-testid="delayed-test-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="size-5 text-primary" aria-hidden />
              آزمون تأییدی
              {delayStatus && delayStatus.eligible > 0 && (
                <Badge data-testid="delay-eligible-count" className="gap-1">
                  {faDigits(delayStatus.eligible)} گره آماده
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              تسلط فقط با آزمون دیرهنگام تأیید می‌شود: سه موقعیت تازه، بدون راهنما. اگر جواب
              ندهی، گره صادقانه به حالت یادگیری برمی‌گردد.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => void startConfirmatory()}
              variant="outline"
              size="lg"
              className="w-full sm:w-auto gap-2"
              disabled={confirmatoryBusy || (delayStatus !== null && delayStatus.eligible === 0)}
              data-testid="start-confirmatory"
            >
              {confirmatoryBusy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <ClipboardCheck className="size-4" aria-hidden />
              {delayStatus === null
                ? 'آزمون تأییدی'
                : delayStatus.eligible > 0
                  ? `شروع آزمون (${faDigits(Math.min(delayStatus.eligible, delayStatus.maxPerSession))} گره)`
                  : delayStatus.pending > 0
                    ? `آماده نیست — ${faDigits(delayStatus.pending)} گره در آستانه‌ی تسلط`
                    : 'فعلاً گره‌ای در آستانه‌ی تسلط نیست'}
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

        {/* the seed inbox (M7) — growth proposals awaiting the user's verdict */}
        <Card className="border-primary/30" data-testid="seed-inbox-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Inbox className="size-5 text-primary" aria-hidden />
              صندوق بذرها
              {inbox && inbox.proposals.length > 0 && (
                <Badge data-testid="seed-pending-count" className="gap-1">
                  <Sprout className="size-3" aria-hidden />
                  {faDigits(inbox.proposals.length)} پیشنهاد تازه
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              خطاهایی که دو جلسه‌ی مستقل تکرار می‌شوند، به پیشنهاد رشد تبدیل می‌شوند — تو تصمیم
              می‌گیری چه چیزی به درختت اضافه شود.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => setView('seeds')}
              variant="outline"
              size="lg"
              className="w-full sm:w-auto gap-2"
            >
              <Inbox className="size-4" aria-hidden />
              {inbox && inbox.proposals.length > 0
                ? 'دیدن پیشنهادها'
                : inbox
                  ? `صندوق خالی — رشد این هفته: ${faDigits(inbox.cap.planted)} از ${faDigits(inbox.cap.limit)}`
                  : 'صندوق بذرها'}
            </Button>
          </CardContent>
        </Card>

        {/* settings (M9) — the user owns the controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings className="size-5 text-primary" aria-hidden />
              تنظیمات
            </CardTitle>
            <CardDescription>
              سطح، هدف، سبک اصلاح، رضایت هوش مصنوعی — و مالکیت کامل داده‌ات: خروجی JSON یا حذف حساب.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setView('settings')} variant="outline" size="lg" className="w-full sm:w-auto gap-2" data-testid="open-settings">
              <Settings className="size-4" aria-hidden />
              باز کردن تنظیمات
            </Button>
          </CardContent>
        </Card>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </main>
    </div>
  )
}
