'use client'

/**
 * Chat view (M5) — the MVP product surface. Persian RTL chrome around English
 * (LTR) conversation bubbles. Owns: session start, scenario card, message
 * list, typing state, ✏️ unknown-word chips, subtle unknown-rate hint,
 * session timer, end-session (docs/03 §A7 pipeline via /api/session/end) and
 * a compact summary card. Mobile-first; fully keyboard navigable.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  Loader2,
  MessageCircle,
  Pencil,
  Send,
  Sparkles,
  Timer,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { api, ApiError } from '@/lib/client/api'
import {
  faDigits,
  formatDuration,
  formatUnknownRate,
  wordQuestionTemplate,
} from '@/lib/client/format'
import { useAppStore } from '@/stores/app-store'

export default function ChatView() {
  const setView = useAppStore((s) => s.setView)
  const chat = useAppStore((s) => s.chat)
  const beginChat = useAppStore((s) => s.beginChat)
  const appendUserMessage = useAppStore((s) => s.appendUserMessage)
  const appendTutorMessage = useAppStore((s) => s.appendTutorMessage)
  const setTyping = useAppStore((s) => s.setTyping)
  const setChatStatus = useAppStore((s) => s.setChatStatus)
  const setChatEnded = useAppStore((s) => s.setChatEnded)

  const [composer, setComposer] = useState('')
  const [busy, setBusy] = useState(false) // start/turn/end in flight
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [endedAtMs, setEndedAtMs] = useState<number | null>(null)

  const endRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  // ── session timer (stops when the session ends) ──
  useEffect(() => {
    if (chat.status === 'ended') return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [chat.status])

  // ── keep the newest message visible ──
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chat.messages.length, chat.typingSince !== null, chat.status])

  const startSession = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.startSession()
      beginChat({
        sessionId: r.sessionId,
        scenario: r.scenario,
        knownLexicon: r.brief.knownLexicon,
        opener: r.opener.content,
        openerMeta: r.opener.meta,
      })
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError('برای گفتگو باید با پردازش xAI موافقت کنی — از آنبوردینگ ادامه بده.')
      } else {
        setError(e instanceof ApiError ? e.message : 'شروع جلسه ناموفق بود.')
      }
    } finally {
      setBusy(false)
    }
  }, [beginChat])

  const send = async () => {
    const content = composer.trim()
    if (!content || !chat.sessionId || busy || chat.status !== 'active') return
    appendUserMessage(content)
    setComposer('')
    setBusy(true)
    setError(null)
    setTyping(Date.now())
    try {
      const r = await api.sendTurn(chat.sessionId, content)
      appendTutorMessage(r.tutor, r.meta)
    } catch (e) {
      setTyping(null)
      setError(e instanceof ApiError ? e.message : 'ارسال پیام ناموفق بود.')
    } finally {
      setBusy(false)
      composerRef.current?.focus()
    }
  }

  const endSession = async () => {
    if (!chat.sessionId || chat.status === 'ending' || chat.status === 'ended') return
    setBusy(true)
    setError(null)
    setChatStatus('ending')
    try {
      const r = await api.endSession(chat.sessionId)
      setEndedAtMs(Date.now())
      setChatEnded({ summary: r.summary, applied: r.applied.length })
    } catch (e) {
      setChatStatus('active')
      setError(e instanceof ApiError ? e.message : 'پایان جلسه ناموفق بود.')
    } finally {
      setBusy(false)
    }
  }

  const insertWordQuestion = (word: string) => {
    setComposer(wordQuestionTemplate(word))
    composerRef.current?.focus()
  }

  const elapsed = chat.startedAt
    ? (chat.status === 'ended' && endedAtMs ? endedAtMs : now) - chat.startedAt
    : 0

  const canStart = chat.status === 'idle' || chat.status === 'ended'
  const isConfirmatory = chat.mode === 'confirmatory'

  // current probe position from the LAST tutor turn that asked a context
  const lastProbe = [...chat.messages].reverse().find((m) => m.role === 'tutor' && m.meta?.probe)?.meta
    ?.probe ?? null
  const probeProgress =
    isConfirmatory && chat.probePlan && lastProbe
      ? `گره ${faDigits(lastProbe.probeIndex + 1)} از ${faDigits(chat.probePlan.probeCount)} · سؤال ${faDigits(
          lastProbe.contextIndex + 1,
        )} از ${faDigits(chat.probePlan.contextsPerProbe)}`
      : null

  return (
    <div className="min-h-dvh flex flex-col bg-gradient-to-b from-background to-muted/40">
      {/* ── header: back, scenario, timer, end ── */}
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto max-w-2xl px-3 py-2.5 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="بازگشت به خانه"
            onClick={() => setView('home')}
          >
            <ArrowRight className="size-4" aria-hidden />
          </Button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">
              {isConfirmatory
                ? 'آزمون تأییدی'
                : chat.scenario
                  ? chat.scenario.title
                  : 'گفتگو با مربی'}
            </p>
            {isConfirmatory ? (
              <p className="text-xs text-muted-foreground truncate">{probeProgress ?? 'سه سؤال برای هر گره — بدون راهنما'}</p>
            ) : (
              chat.scenario && (
                <p className="text-xs text-muted-foreground truncate" dir="ltr">
                  {chat.scenario.role}
                </p>
              )
            )}
          </div>
          {chat.status === 'active' && chat.startedAt && (
            <Badge variant="secondary" className="gap-1 tabular-nums shrink-0" dir="ltr">
              <Timer className="size-3" aria-hidden />
              {formatDuration(elapsed)}
            </Badge>
          )}
          {chat.status === 'active' && chat.sessionId && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1 shrink-0">
                  <X className="size-3.5" aria-hidden />
                  پایان جلسه
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent dir="rtl">
                <AlertDialogHeader>
                  <AlertDialogTitle>جلسه را تمام می‌کنی؟</AlertDialogTitle>
                  <AlertDialogDescription>
                    شواهد همین حالا پردازش می‌شود: گره‌ها در درختت تقویت یا کم‌رنگ می‌شوند و
                    خلاصه‌ی جلسه ساخته می‌شود.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>ادامه‌ی گفتگو</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void endSession()} disabled={busy}>
                    {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    پردازش و پایان
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </header>

      {/* ── body ── */}
      <main className="mx-auto w-full max-w-2xl flex-1 flex flex-col px-3 py-4 min-h-0">
        {/* start card */}
        {canStart && (
          <Card className="mt-6">
            <CardHeader className="items-center text-center gap-2">
              <MessageCircle className="size-8 text-primary mx-auto" aria-hidden />
              <CardTitle className="text-lg">
                {chat.status === 'ended'
                  ? isConfirmatory
                    ? 'آزمون تأییدی تمام شد'
                    : 'جلسه‌ی تمام‌شده'
                  : isConfirmatory
                    ? 'آزمون تأییدی'
                    : 'گفتگو با مربی'}
              </CardTitle>
              <CardDescription className="leading-7">
                {chat.status === 'ended'
                  ? 'این جلسه پردازش و بسته شد. یک جلسه‌ی تازه شروع کن تا درختت دوباره تغذیه شود.'
                  : isConfirmatory
                    ? 'برای هر گره‌ی در آستانه‌ی تسلط سه موقعیت تازه می‌پرسیم — بدون راهنما و بدون تمرین قبلی. پاسخ درست یعنی تسلط واقعی.'
                    : 'مربی در یک موقعیت واقعی با تو انگلیسی حرف می‌زند. هر جمله‌ی تو برای درخت مهارتت شاهد است.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3">
              <Button
                size="lg"
                onClick={() => void startSession()}
                disabled={busy}
                className="gap-2"
              >
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {chat.status === 'ended' ? 'جلسه‌ی جدید' : 'شروع گفتگو'}
              </Button>
              {chat.status === 'ended' && chat.summary && (
                <SessionSummary compact />
              )}
            </CardContent>
          </Card>
        )}

        {/* conversation */}
        {chat.status !== 'idle' && chat.status !== 'ended' && (
          <>
            <ol
              className="flex-1 min-h-0 overflow-y-auto space-y-3 py-2"
              role="log"
              aria-live="polite"
              aria-label="گفتگو با مربی"
            >
              {chat.messages.map((m) =>
                m.role === 'tutor' ? (
                  <li key={m.id} className="flex flex-col items-start gap-1">
                    <div
                      dir="ltr"
                      lang="en"
                      className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-ss-sm bg-card border px-4 py-2.5 text-sm leading-7 shadow-sm"
                    >
                      <span className="whitespace-pre-wrap block text-left">{m.content}</span>
                    </div>
                    {/* subtle i+1 signal: unknown rate + tappable new words */}
                    {(m.meta?.unknownRate !== undefined || (m.meta?.unknownWords?.length ?? 0) > 0) && (
                      <div className="max-w-[90%] space-y-1">
                        {formatUnknownRate(m.meta?.unknownRate) && (
                          <p className="text-[11px] text-muted-foreground">
                            {formatUnknownRate(m.meta?.unknownRate)} واژه‌های تازه — طبیعیه، از مربی بپرس
                          </p>
                        )}
                        {(m.meta?.unknownWords?.length ?? 0) > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {m.meta?.unknownWords?.slice(0, 6).map((w) => (
                              <button
                                key={w}
                                type="button"
                                dir="ltr"
                                onClick={() => insertWordQuestion(w)}
                                className="inline-flex items-center gap-1 rounded-full border bg-muted/60 hover:bg-muted px-2.5 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={`سؤال درباره‌ی واژه ${w}`}
                              >
                                <Pencil className="size-3" aria-hidden />
                                <span>{w}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {m.meta?.rewritten && (
                      <p className="text-[11px] text-muted-foreground">
                        <Sparkles className="inline size-3" aria-hidden /> این جمله برای سطح تو ساده‌سازی شد
                      </p>
                    )}
                    {m.meta?.fallback && (
                      <p className="text-[11px] text-muted-foreground">پاسخ آفلاین — مدل در دسترس نبود</p>
                    )}
                  </li>
                ) : (
                  <li key={m.id} className="flex flex-col items-end gap-1">
                    <div
                      dir="ltr"
                      lang="en"
                      className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-se-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-7 shadow-sm"
                    >
                      <span className="whitespace-pre-wrap block text-left">{m.content}</span>
                    </div>
                  </li>
                ),
              )}

              {/* typing state */}
              {chat.typingSince !== null && (
                <li className="flex flex-col items-start gap-1" role="status" aria-live="polite">
                  <div
                    dir="ltr"
                    className="rounded-2xl rounded-ss-sm bg-card border px-4 py-3 shadow-sm"
                    aria-label="مربی در حال نوشتن"
                  >
                    <span className="flex gap-1" aria-hidden>
                      <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                      <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                      <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">مربی در حال نوشتن…</span>
                </li>
              )}
              <div ref={endRef} aria-hidden />
            </ol>

            {/* composer */}
            <form
              className="sticky bottom-2 mt-2 flex items-end gap-2 rounded-2xl border bg-background/95 backdrop-blur p-2 shadow-lg"
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <label htmlFor="composer" className="sr-only">
                پیام انگلیسی‌ات را بنویس
              </label>
              <textarea
                id="composer"
                ref={composerRef}
                dir="ltr"
                rows={1}
                maxLength={2000}
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                disabled={busy || chat.status !== 'active'}
                placeholder="Type in English… (Enter = send)"
                className="flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground min-h-[2.5rem] max-h-32 disabled:opacity-50"
              />
              <Button
                type="submit"
                size="icon"
                disabled={busy || !composer.trim() || chat.status !== 'active'}
                aria-label="ارسال پیام"
                className="shrink-0"
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
              </Button>
            </form>
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive leading-6">
            {error}
            {error.includes('xAI') && (
              <>
                {' '}
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={() => setView('onboarding')}
                >
                  رفتن به آنبوردینگ
                </button>
              </>
            )}
          </p>
        )}
      </main>
    </div>
  )

  /** full/compact session summary (docs/02 §3.3) — M8 adds delayed results */
  function SessionSummary({ compact = false }: { compact?: boolean }) {
    const s = chat.summary
    if (!s) return null
    return (
      <Card className="w-full" aria-labelledby="summary-title">
        <CardHeader className={compact ? 'pb-2' : ''}>
          <CardTitle id="summary-title" className="text-base">
            خلاصه‌ی جلسه
          </CardTitle>
          <CardDescription>
            {faDigits(chat.turnCount)} پیام تو · {formatDuration(elapsed)} ·{' '}
            {faDigits(chat.endStats?.applied ?? 0)} گره به‌روز شد
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-7">
          {s.delayTestResults.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-medium">نتیجه‌ی آزمون تأییدی:</p>
              <ul className="space-y-1">
                {s.delayTestResults.map((d) => (
                  <li key={`${d.nodeId}:${d.skill}`}>
                    {d.skipped === 'incomplete' ? (
                      <>
                        ⏭️ «<span dir="ltr">{d.title ?? d.nodeId}</span>» — ناتمام، بعداً دوباره
                      </>
                    ) : d.revoked ? (
                      <>
                        ⚠️ «<span dir="ltr">{d.title ?? d.nodeId}</span>» — تسلط لغو شد؛ به حالت یادگیری برگشت
                      </>
                    ) : d.mastered ? (
                      <>
                        ✅ «<span dir="ltr">{d.title ?? d.nodeId}</span>» — تسلط تأیید شد!
                      </>
                    ) : (
                      <>
                        ❌ «<span dir="ltr">{d.title ?? d.nodeId}</span>» — تأیید نشد؛ ۷ روز دیگر دوباره
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="space-y-1.5">
            <li>
              تقویت‌شده: <b>{faDigits(s.reinforced.length)}</b> گره
              {!compact && s.reinforced.length > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  ({s.reinforced
                    .slice(0, 4)
                    .map((r) => r.title ?? r.nodeId)
                    .join('، ')})
                </span>
              )}
            </li>
            <li>
              کم‌رنگ‌شده: <b>{faDigits(s.fading.length)}</b> گره
              {!compact && s.fading.length > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  ({s.fading
                    .slice(0, 4)
                    .map((f) => f.title ?? f.nodeId)
                    .join('، ')})
                </span>
              )}
            </li>
            <li>
              مرورهای سررسید فردا: <b>{faDigits(s.tomorrow.reviewsDue)}</b>
            </li>
          </ul>
          {s.seeds.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-medium">بذرهای پیشنهادی ({faDigits(s.seeds.length)}):</p>
              <ul className="space-y-1 text-muted-foreground">
                {s.seeds.slice(0, 3).map((seed) => (
                  <li key={seed.seedId} className="truncate">
                    🌱 {seed.reasonFa}
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" onClick={() => setView('seeds')}>
                دیدن صندوق بذرها
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }
}
