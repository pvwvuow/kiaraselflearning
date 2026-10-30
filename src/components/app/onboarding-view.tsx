'use client'

/**
 * Onboarding wizard (M5) — profile → preferences → xAI consent → adaptive
 * placement quiz (M1 engine, wired live via POST /api/placement). The ladder
 * is server-graded; the client never sees correctIndex. On finish the
 * placement writes `assumed_known` states + cefrComputed and we go home.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Sprout, CheckCircle2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { api, ApiError, type PlacementItemLite, type PlacementAnswerInput } from '@/lib/client/api'
import { faDigits } from '@/lib/client/format'
import { useAppStore } from '@/stores/app-store'

const CEFR_OPTIONS = [
  { value: 'A1', label: 'A1 — تازه‌کار' },
  { value: 'A2', label: 'A2 — پایه' },
  { value: 'B1', label: 'B1 — متوسط' },
  { value: 'B2', label: 'B2 — متوسط رو به بالا' },
  { value: 'C1', label: 'C1 — پیشرفته' },
  { value: 'C2', label: 'C2 — خیلی پیشرفته' },
] as const

const GOAL_OPTIONS = [
  { value: 'travel', label: 'سفر' },
  { value: 'work', label: 'کار و شغل' },
  { value: 'exam', label: 'آزمون (آیلتس/تافل)' },
  { value: 'daily', label: 'زندگی روزمره' },
  { value: 'general', label: 'عمومی' },
] as const

const MINUTES_OPTIONS = [5, 10, 15, 20, 30, 45, 60] as const

const BAND_FA: Record<string, string> = {
  A1: 'A1 (تازه‌کار)',
  A2: 'A2 (پایه)',
  B1: 'B1 (متوسط)',
}

type Step = 'profile' | 'prefs' | 'consent' | 'placement' | 'done'

export default function OnboardingView() {
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const setView = useAppStore((s) => s.setView)

  const [step, setStep] = useState<Step>('profile')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // profile
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [cefrSelf, setCefrSelf] = useState(user?.cefrSelf ?? 'A1')
  const [goal, setGoal] = useState(user?.goal ?? 'general')
  // prefs
  const [interests, setInterests] = useState<string[]>(user?.interests ?? [])
  const [interestDraft, setInterestDraft] = useState('')
  const [dailyMinutes, setDailyMinutes] = useState(user?.dailyMinutes ?? 15)
  const [correctionStyle, setCorrectionStyle] = useState(user?.correctionStyle ?? 'immediate')
  // consent
  const [consent, setConsent] = useState(false)
  // placement
  const [answers, setAnswers] = useState<PlacementAnswerInput[]>([])
  const [item, setItem] = useState<PlacementItemLite | null>(null)
  const [pickedIndex, setPickedIndex] = useState<number | null>(null)
  const [finalBand, setFinalBand] = useState<string | null>(null)
  const [litCount, setLitCount] = useState(0)
  const placementBooted = useRef(false)

  const addInterest = () => {
    const v = interestDraft.trim().slice(0, 40)
    if (!v || interests.includes(v) || interests.length >= 12) return
    setInterests([...interests, v])
    setInterestDraft('')
  }

  // ── placement ladder (server-graded) ──
  const advancePlacement = useCallback(
    async (allAnswers: PlacementAnswerInput[]) => {
      setBusy(true)
      setError(null)
      try {
        const r = await api.placementNext(cefrSelf, allAnswers)
        if (r.next) {
          setItem(r.next)
          setPickedIndex(null)
        } else {
          setItem(null)
          const fin = await api.placementFinish(cefrSelf, allAnswers)
          setFinalBand(fin.finalBand ?? null)
          setLitCount(fin.litCount ?? 0)
          setStep('done')
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'تعیین سطح ناموفق بود — دوباره تلاش کن.')
      } finally {
        setBusy(false)
      }
    },
    [cefrSelf],
  )

  useEffect(() => {
    if (step === 'placement' && !placementBooted.current) {
      placementBooted.current = true
      void advancePlacement([])
    }
  }, [step, advancePlacement])

  const answerItem = (optionIndex: number) => {
    if (!item || busy || pickedIndex !== null) return
    setPickedIndex(optionIndex)
    const next = [...answers, { nodeId: item.nodeId, optionIndex }]
    setAnswers(next)
    window.setTimeout(() => void advancePlacement(next), 350)
  }

  const saveProfile = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.patchOnboarding({
        cefrSelf,
        goal,
        interests,
        dailyMinutes,
        correctionStyle,
        consentLlm: consent,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      })
      setUser(r.user)
      setStep('placement')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ذخیره‌ی پروفایل ناموفق بود.')
    } finally {
      setBusy(false)
    }
  }

  const totalPool = 12 // PLACEMENT_POOL_PER_BAND(4) × 3 bands

  return (
    <div className="min-h-dvh flex flex-col bg-gradient-to-b from-background to-muted/40">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-lg px-4 py-3 flex items-center gap-2">
          <Sprout className="size-5 text-primary" aria-hidden />
          <h1 className="font-bold">راه‌اندازی کیارا</h1>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-6">
        <Card className="w-full max-w-lg" aria-live="polite">
          {/* ── step 0: profile ── */}
          {step === 'profile' && (
            <>
              <CardHeader>
                <CardTitle>درباره‌ی تو</CardTitle>
                <CardDescription>
                  این‌ها فقط نقطه‌ی شروع‌اند؛ سطح واقعی‌ات را آزمون تطبیقی همین الان مشخص می‌کند.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="ob-name">نام نمایشی (اختیاری)</Label>
                  <Input
                    id="ob-name"
                    value={displayName}
                    maxLength={60}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-cefr">سطح خودت را چطور می‌بینی؟</Label>
                  <select
                    id="ob-cefr"
                    value={cefrSelf}
                    onChange={(e) => setCefrSelf(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {CEFR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>هدف اصلی‌ات چیه؟</Label>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="هدف یادگیری">
                    {GOAL_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={goal === o.value}
                        onClick={() => setGoal(o.value)}
                        className={`rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                          goal === o.value
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background hover:bg-muted'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => setStep('prefs')}
                  disabled={busy}
                >
                  بعدی
                </Button>
              </CardContent>
            </>
          )}

          {/* ── step 1: preferences ── */}
          {step === 'prefs' && (
            <>
              <CardHeader>
                <CardTitle>علاقه‌ها و زمان تو</CardTitle>
                <CardDescription>
                  گفتگوها سراغ موضوع‌هایی می‌روند که برایت جذاب‌اند.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="ob-interest">علاقه‌ها (Enter بزن تا اضافه شود)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="ob-interest"
                      value={interestDraft}
                      maxLength={40}
                      placeholder="مثلاً: آشپزی، فوتبال، سینما"
                      onChange={(e) => setInterestDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addInterest()
                        }
                      }}
                    />
                    <Button type="button" variant="outline" size="icon" onClick={addInterest} aria-label="افزودن علاقه">
                      <Plus className="size-4" aria-hidden />
                    </Button>
                  </div>
                  {interests.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {interests.map((it) => (
                        <Badge key={it} variant="secondary" className="gap-1">
                          {it}
                          <button
                            type="button"
                            onClick={() => setInterests(interests.filter((x) => x !== it))}
                            aria-label={`حذف ${it}`}
                            className="rounded focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <X className="size-3" aria-hidden />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-minutes">روزی چقدر وقت داری؟</Label>
                  <select
                    id="ob-minutes"
                    value={dailyMinutes}
                    onChange={(e) => setDailyMinutes(Number(e.target.value))}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {MINUTES_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {faDigits(m)} دقیقه
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>اصلاح اشتباه‌ها چطور باشد؟</Label>
                  <div className="grid gap-2" role="radiogroup" aria-label="سبک اصلاح">
                    {[
                      { value: 'immediate', label: 'همان لحظه اصلاح کن (مربی وسط حرفت می‌پیچد)' },
                      { value: 'end_of_session', label: 'آخر جلسه جمع‌بندی کن' },
                    ].map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={correctionStyle === o.value}
                        onClick={() => setCorrectionStyle(o.value)}
                        className={`rounded-lg border px-3 py-2 text-sm text-right transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                          correctionStyle === o.value
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background hover:bg-muted'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setStep('profile')}>
                    قبلی
                  </Button>
                  <Button className="flex-1" onClick={() => setStep('consent')} disabled={busy}>
                    بعدی
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {/* ── step 2: consent ── */}
          {step === 'consent' && (
            <>
              <CardHeader>
                <CardTitle>درباره‌ی هوش مصنوعی</CardTitle>
                <CardDescription className="leading-7">
                  گفتگوهای تو توسط مدل زبانی xAI (Grok) پردازش می‌شود تا مربی جواب بدهد و شواهد
                  یادگیری استخراج شود. تصمیم‌های درخت مهارت همیشه با موتور قطعی خود کیارا گرفته
                  می‌شود، نه مدل زبانی. هر وقت بخواهی می‌توانی این را خاموش کنی — آن لحظه چت متوقف
                  می‌شود ولی داده‌هایت دست‌نخورده می‌مانند.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-1 size-4 accent-[var(--primary)]"
                    aria-describedby="consent-desc"
                  />
                  <span id="consent-desc" className="text-sm leading-7">
                    می‌پذیرم گفتگوهایم برای مربی‌گری و استخراج شواهد به xAI ارسال شود.
                  </span>
                </label>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setStep('prefs')}>
                    قبلی
                  </Button>
                  <Button className="flex-1" onClick={() => void saveProfile()} disabled={busy || !consent}>
                    {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    ذخیره و شروع آزمون
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {/* ── step 3: adaptive placement quiz ── */}
          {step === 'placement' && (
            <>
              <CardHeader>
                <CardTitle>آزمون تعیین سطح</CardTitle>
                <CardDescription>
                  معنی هر واژه را حدس بزن؛ ترتیب سؤال‌ها بر اساس جواب‌هایت عوض می‌شود.
                  {' '}
                  {faDigits(Math.min(answers.length, totalPool))} سؤال از حدود {faDigits(totalPool)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <Progress
                  value={Math.min(100, (answers.length / totalPool) * 100)}
                  aria-label="پیشرفت آزمون تعیین سطح"
                />
                {item && (
                  <div className="rounded-xl border bg-card p-5 space-y-4">
                    <p className="text-xs text-muted-foreground">معنی این واژه چیست؟</p>
                    <p dir="ltr" lang="en" className="text-3xl font-bold text-left">
                      {item.word}
                    </p>
                    <div className="grid gap-2" role="radiogroup" aria-label={`گزینه‌های واژه ${item.word}`}>
                      {item.options.map((opt, i) => (
                        <button
                          key={`${item.nodeId}-${i}`}
                          type="button"
                          role="radio"
                          aria-checked={pickedIndex === i}
                          disabled={busy || pickedIndex !== null}
                          onClick={() => answerItem(i)}
                          className={`rounded-lg border px-4 py-2.5 text-right text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                            pickedIndex === i
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background hover:bg-muted'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {busy && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                    <Loader2 className="size-4 animate-spin" aria-hidden /> در حال آماده‌سازی سؤال بعدی…
                  </p>
                )}
              </CardContent>
            </>
          )}

          {/* ── step 4: done ── */}
          {step === 'done' && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
                  راه‌اندازی کامل شد
                </CardTitle>
                <CardDescription className="leading-7">
                  {finalBand
                    ? `سطح تو ${BAND_FA[finalBand] ?? finalBand} ارزیابی شد و ${faDigits(litCount)} گره‌ی واژه در درختت روشن شد.`
                    : 'هیچ گره‌ای روشن نشد — عالی! از صفر شروع می‌کنیم؛ مربی با واژه‌های خیلی ساده حرف می‌زند.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" onClick={() => setView('home')}>
                  برو به خانه
                </Button>
              </CardContent>
            </>
          )}

          {error && (
            <CardContent>
              <p role="alert" className="text-sm text-destructive leading-6">
                {error}
              </p>
            </CardContent>
          )}
        </Card>
      </main>
    </div>
  )
}
