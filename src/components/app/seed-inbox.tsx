'use client'

/**
 * SeedInboxView (M7) — «صندوق بذرها»: the human approval step of the growth
 * engine (docs/03 §B1: … → cap → USER APPROVAL → plant). Each proposal shows
 * the full score breakdown («چرا این پیشنهاد شد؟») + Persian reason + a real
 * error sample. Approve = plant (celebration — the streak-positive moment,
 * docs/03 §B5.3) · Reject = the node sits out a 14-day cooldown. The weekly
 * cap (3 plants / 7 days) is enforced server-side; a held proposal stays in
 * queue and the UI explains why.
 */
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Loader2, Sprout, Sparkles, Info, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { api, ApiError } from '@/lib/client/api'
import type { SeedEntry, SeedsInboxResponse } from '@/lib/client/api'
import { faDigits } from '@/lib/client/format'
import { useAppStore } from '@/stores/app-store'

const KIND_FA: Record<SeedEntry['kind'], string> = {
  plant_existing: 'کاشت واژه',
  track_pattern: 'الگوی خطا',
}

const BREAKDOWN_FA: { key: keyof SeedEntry['breakdown']; label: string }[] = [
  { key: 'goalRelevance', label: 'ارتباط با هدف' },
  { key: 'frequency', label: 'فراوانی واژه' },
  { key: 'readiness', label: 'آمادگی پیش‌نیازها' },
  { key: 'novelty', label: 'تازگی برای تو' },
]

const STATUS_FA: Record<string, string> = {
  planted: 'کاشته شد',
  rejected: 'رد شد',
  expired: 'منقضی شد',
}

const CONFETTI = ['🌱', '✨', '🌿', '🎉', '🍀', '⭐', '🌱', '✨', '🌿', '🎉', '🍀', '⭐']

function faScore(score: number): string {
  return faDigits(score.toFixed(2).replace('.', '٫'))
}

function faPercent(v: number): string {
  return faDigits(`${Math.round(v * 100)}٪`)
}

export default function SeedInboxView() {
  const setView = useAppStore((s) => s.setView)
  const [data, setData] = useState<SeedsInboxResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [heldId, setHeldId] = useState<string | null>(null)
  const [rejectedFlash, setRejectedFlash] = useState(false)
  const [celebrating, setCelebrating] = useState<SeedEntry | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.seeds())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'بارگذاری صندوق ناموفق بود.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const removeProposal = (id: string) => {
    setData((d) => (d ? { ...d, proposals: d.proposals.filter((p) => p.id !== id) } : d))
  }

  const approve = async (entry: SeedEntry) => {
    setBusyId(entry.id)
    setError(null)
    try {
      const r = await api.approveSeed(entry.id)
      if (r.held) {
        setHeldId(entry.id)
        setData((d) => (d ? { ...d, cap: r.cap } : d))
      } else {
        setHeldId(null)
        removeProposal(entry.id)
        if (r.cap) setData((d) => (d ? { ...d, cap: r.cap! } : d))
        setCelebrating(r.entry ?? entry)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'کاشت ناموفق بود.')
    } finally {
      setBusyId(null)
    }
  }

  const reject = async (entry: SeedEntry) => {
    setBusyId(entry.id)
    setError(null)
    try {
      await api.rejectSeed(entry.id)
      removeProposal(entry.id)
      setRejectedFlash(true)
      window.setTimeout(() => setRejectedFlash(false), 6000)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'رد ناموفق بود.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-dvh flex flex-col bg-gradient-to-b from-background to-muted/40">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => setView('home')} aria-label="بازگشت">
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            <Sprout className="size-5 text-primary shrink-0" aria-hidden />
            <h1 className="font-bold truncate">صندوق بذرها</h1>
          </div>
          {data && (
            <Badge variant={data.cap.planted >= data.cap.limit ? 'secondary' : 'outline'} data-testid="cap-meter">
              رشد این هفته: {faDigits(data.cap.planted)} از {faDigits(data.cap.limit)}
            </Badge>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 space-y-4" dir="rtl">
        {loading && (
          <div role="status" className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            <span className="text-sm">در حال آوردن پیشنهادها…</span>
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-lg p-3">
            <Info className="size-4 mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => void load()} className="ms-auto gap-1">
              <RefreshCw className="size-3.5" aria-hidden /> دوباره
            </Button>
          </div>
        )}

        {!loading && data && data.proposals.length === 0 && !celebrating && (
          <Card>
            <CardContent className="py-12 text-center space-y-2">
              <Sprout className="size-8 mx-auto text-muted-foreground/60" aria-hidden />
              <p className="text-sm font-medium">فعلاً پیشنهاد تازه‌ای نداری</p>
              <p className="text-xs text-muted-foreground leading-6 max-w-sm mx-auto">
                با گفتگو ادامه بده — وقتی خطایی دو جلسه‌ی مستقل تکرار شود، خودش اینجا به‌عنوان
                پیشنهاد رشد سبز می‌شود.
              </p>
              <Button onClick={() => setView('chat')} size="sm" className="mt-2">
                شروع گفتگو
              </Button>
            </CardContent>
          </Card>
        )}

        {rejectedFlash && (
          <p
            role="status"
            data-testid="rejected-note"
            className="text-xs text-muted-foreground bg-muted/60 border rounded-lg px-3 py-2"
          >
            پیشنهاد رد شد — تا {faDigits(14)} روز برای همین گره پیشنهاد تازه‌ای نمی‌آید.
          </p>
        )}

        {data?.proposals.map((entry) => (
          <Card key={entry.id} data-testid={`seed-card`} className="border-primary/25">
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">{KIND_FA[entry.kind]}</Badge>
                    <Badge variant="outline">{faDigits(entry.errorCount)} جلسه با خطا</Badge>
                  </div>
                  <p className="font-bold text-lg truncate" dir="ltr" lang="en">
                    {entry.title}
                  </p>
                  {entry.glossFa && <p className="text-xs text-muted-foreground">{entry.glossFa}</p>}
                </div>
                <div className="text-center shrink-0 bg-primary/10 text-primary rounded-lg px-2.5 py-1.5">
                  <p className="text-[10px] leading-4">امتیاز</p>
                  <p className="text-sm font-bold leading-5" data-testid="seed-score">
                    {faScore(entry.score)}
                  </p>
                </div>
              </div>

              {/* score breakdown — «چرا این پیشنهاد شد؟» */}
              <div className="space-y-1.5" data-testid="seed-breakdown">
                {BREAKDOWN_FA.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
                    <div
                      className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden"
                      role="meter"
                      aria-label={label}
                      aria-valuenow={Math.round(entry.breakdown[key] * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${Math.round(entry.breakdown[key] * 100)}%` }}
                      />
                    </div>
                    <span className="w-9 text-left tabular-nums text-muted-foreground">
                      {faPercent(entry.breakdown[key])}
                    </span>
                  </div>
                ))}
              </div>

              {entry.reasonFa && (
                <p className="text-xs leading-6 text-foreground/80 bg-muted/50 rounded-lg px-3 py-2">
                  <Sparkles className="inline size-3.5 me-1 text-primary" aria-hidden />
                  {entry.reasonFa}
                </p>
              )}

              {entry.sample?.produced && (
                <p className="text-xs leading-6 text-muted-foreground" dir="ltr" lang="en">
                  <span className="text-destructive line-through">{entry.sample.produced}</span>
                  {' → '}
                  <span className="text-emerald-600">{entry.sample.expected ?? '…'}</span>
                </p>
              )}

              {heldId === entry.id ? (
                <p
                  role="status"
                  data-testid="held-note"
                  className="text-xs leading-6 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
                >
                  سقف رشد هفتگی ({faDigits(data.cap.limit)} کاشت) پر شده — این پیشنهاد در صف
                  می‌ماند و بعد از باز شدن جا کاشته می‌شود. هیچ‌چیز از دست نمی‌رود.
                </p>
              ) : (
                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={() => void approve(entry)}
                    disabled={busyId === entry.id}
                    className="flex-1 gap-1.5"
                    data-testid="seed-approve"
                  >
                    {busyId === entry.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Sprout className="size-4" aria-hidden />
                    )}
                    بکارش در درخت
                  </Button>
                  <Button
                    onClick={() => void reject(entry)}
                    disabled={busyId === entry.id}
                    variant="ghost"
                    data-testid="seed-reject"
                  >
                    نه، فعلاً
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {data && data.recent.length > 0 && (
          <section aria-labelledby="recent-seeds" className="pt-2">
            <h2 id="recent-seeds" className="text-sm font-semibold text-muted-foreground mb-2">
              تصمیم‌های اخیر
            </h2>
            <ul className="space-y-1.5">
              {data.recent.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 text-xs bg-card border rounded-lg px-3 py-2"
                >
                  <span className="truncate" dir="ltr" lang="en">
                    {r.title}
                  </span>
                  <Badge variant="outline">{STATUS_FA[r.status] ?? r.status}</Badge>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {/* celebration — planting a branch is the streak-positive moment (§B5.3) */}
      {celebrating && (
        <div
          data-testid="celebration"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4"
          role="alertdialog"
          aria-label="درختت رشد کرد"
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            {CONFETTI.map((emoji, i) => {
              const angle = (i / CONFETTI.length) * Math.PI * 2
              const style = {
                '--tx': `${Math.cos(angle) * (90 + (i % 3) * 34)}px`,
                '--ty': `${Math.sin(angle) * (70 + (i % 4) * 26)}px`,
                animationDelay: `${(i % 6) * 90}ms`,
                left: '50%',
                top: '50%',
              } as React.CSSProperties
              return (
                <span key={i} className="kiara-confetti absolute text-2xl" style={style}>
                  {emoji}
                </span>
              )
            })}
          </div>
          <Card className="relative z-10 w-full max-w-sm text-center border-primary/40">
            <CardContent className="pt-6 pb-5 space-y-3">
              <Sprout className="size-10 mx-auto text-emerald-600 kiara-pop" aria-hidden />
              <p className="text-lg font-bold">درختت رشد کرد! 🌱</p>
              <p className="text-sm text-muted-foreground leading-7">
                <span dir="ltr" lang="en" className="font-semibold">
                  {celebrating.title}
                </span>{' '}
                حالا بخشی از مهارت‌های توست — با تمرین، شاخه‌هایش سبز می‌شود.
              </p>
              <div className="flex gap-2 justify-center pt-1">
                <Button onClick={() => setView('tree')} className="gap-1.5">
                  دیدن درخت
                </Button>
                <Button variant="ghost" onClick={() => setCelebrating(null)}>
                  ادامه
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
