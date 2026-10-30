'use client'

/**
 * SettingsView (M9) — «تنظیمات»: the user-control milestone (docs/00 P5
 * "the user always owns the controls"):
 *   - profile: display name, self level hint, goal, daily minutes,
 *     correction style (PATCH /api/settings — partial update, cefrComputed
 *     keeps driving the engine)
 *   - LLM consent toggle (timestamped consentLlmAt on the server)
 *   - data: one-click JSON export (GET /api/settings/export) and account
 *     deletion with an explicit confirm step (DELETE /api/settings — cascade,
 *     cookie cleared, back to landing). User-generated tree nodes stay in the
 *     world by design (docs/03 §B5); everything user-owned is removed.
 */
import { useState } from 'react'
import { ArrowRight, Download, Loader2, Save, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { api, ApiError, type PublicUser } from '@/lib/client/api'
import { useAppStore } from '@/stores/app-store'

const LEVEL_OPTIONS = [
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

const CORRECTION_OPTIONS = [
  { value: 'immediate', label: 'همان لحظه اصلاح کن' },
  { value: 'end_of_session', label: 'آخر جلسه جمع‌بندی کن' },
] as const

export default function SettingsView() {
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const setView = useAppStore((s) => s.setView)
  const resetChat = useAppStore((s) => s.resetChat)

  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [cefrSelf, setCefrSelf] = useState(user?.cefrSelf ?? 'A2')
  const [goal, setGoal] = useState(user?.goal ?? 'general')
  const [dailyMinutes, setDailyMinutes] = useState(user?.dailyMinutes ?? 15)
  const [correctionStyle, setCorrectionStyle] = useState(user?.correctionStyle ?? 'immediate')
  const [consentLlm, setConsentLlm] = useState(Boolean(user?.consentLlmAt))

  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!user) return null

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await api.patchSettings({
        displayName: displayName.trim() || undefined,
        cefrSelf,
        goal,
        dailyMinutes,
        correctionStyle,
        consentLlm,
      })
      setUser(res.user)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2500)
    } catch (e) {
      setError(e instanceof ApiError ? (e.errorFa ?? e.message) : 'خطای غیرمنتظره — دوباره تلاش کن.')
    } finally {
      setSaving(false)
    }
  }

  async function doExport() {
    setExporting(true)
    setError(null)
    try {
      await api.exportData()
    } catch (e) {
      setError(e instanceof ApiError ? (e.errorFa ?? e.message) : 'خروجی داده ناموفق بود — دوباره تلاش کن.')
    } finally {
      setExporting(false)
    }
  }

  async function doDelete() {
    setError(null)
    try {
      await api.deleteAccount()
      setUser(null)
      resetChat()
      setView('landing')
    } catch (e) {
      setError(e instanceof ApiError ? (e.errorFa ?? e.message) : 'حذف حساب ناموفق بود — دوباره تلاش کن.')
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6" data-testid="settings-view">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="بازگشت به خانه" onClick={() => setView('home')}>
          <ArrowRight className="size-5" aria-hidden />
        </Button>
        <h1 className="text-xl font-bold">تنظیمات</h1>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="font-semibold">پروفایل یادگیری</h2>

          <div className="space-y-2">
            <Label htmlFor="displayName">نام نمایشی</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={60}
              dir="auto"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cefrSelf">سطح خودت را چطور می‌بینی؟ (حدس اولیه)</Label>
              <select
                id="cefrSelf"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={cefrSelf}
                onChange={(e) => setCefrSelf(e.target.value)}
              >
                {LEVEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {user.cefrComputed && (
                <p className="text-xs text-muted-foreground">سطح محاسبه‌شده از آزمون: {user.cefrComputed}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="goal">هدف یادگیری</Label>
              <select
                id="goal"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              >
                {GOAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dailyMinutes">روزی چند دقیقه؟</Label>
            <select
              id="dailyMinutes"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={dailyMinutes}
              onChange={(e) => setDailyMinutes(Number(e.target.value))}
            >
              {MINUTES_OPTIONS.map((m) => (
                <option key={m} value={m}>{m} دقیقه</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>اصلاح اشتباه‌ها چطور باشد؟</Label>
            <div className="grid gap-2" role="radiogroup" aria-label="سبک اصلاح">
              {CORRECTION_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={correctionStyle === o.value}
                  onClick={() => setCorrectionStyle(o.value)}
                  className={`rounded-md border px-3 py-2 text-start text-sm transition-colors ${
                    correctionStyle === o.value
                      ? 'border-primary bg-primary/10 font-medium'
                      : 'hover:bg-muted/60'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-md border p-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div className="flex-1 space-y-2">
              <Label htmlFor="consentLlm">اجازه‌ی استفاده از هوش مصنوعی (xAI)</Label>
              <p className="text-xs leading-5 text-muted-foreground">
                بدون این اجازه، مربی و تحلیل‌گر هوشمند کار نمی‌کنند؛ درخت و برنامه‌ریز قطعی همچنان کار می‌کنند.
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  id="consentLlm"
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={consentLlm}
                  onChange={(e) => setConsentLlm(e.target.checked)}
                />
                می‌پذیرم که گفتگوهایم برای تحلیل یادگیری به مدل زبانی فرستاده شود.
              </label>
            </div>
          </div>

          <Button onClick={save} disabled={saving} className="w-full" data-testid="settings-save">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
            {savedFlash ? 'ذخیره شد ✓' : 'ذخیره‌ی تغییرات'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="font-semibold">داده‌های من</h2>
          <p className="text-xs leading-5 text-muted-foreground">
            خروجی شامل همه‌ی داده‌های توست: نشست‌ها، پیام‌ها، شواهد، وضعیت گره‌ها، بذرها و رخدادهای متریک — در یک فایل JSON.
          </p>
          <Button variant="outline" onClick={doExport} disabled={exporting} className="w-full" data-testid="settings-export">
            {exporting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            دانلود خروجی JSON
          </Button>

          <div className="rounded-md border border-destructive/40 p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium text-destructive">
              <TriangleAlert className="size-4" aria-hidden />
              حذف حساب
            </p>
            <p className="mb-3 text-xs leading-5 text-muted-foreground">
              حذف کامل و برگشت‌ناپذیر: همه‌ی نشست‌ها، شواهد، وضعیت درخت و بذرها پاک می‌شوند. گره‌هایی که خودت کاشتی به‌عنوان محتوای دنیا می‌مانند.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="w-full" data-testid="settings-delete">
                  <Trash2 className="size-4" aria-hidden />
                  حذف حساب و همه‌ی داده‌ها
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent dir="rtl">
                <AlertDialogHeader>
                  <AlertDialogTitle>مطمئنی؟ این کار برگشت‌ناپذیر است.</AlertDialogTitle>
                  <AlertDialogDescription>
                    کل داده‌های یادگیری تو برای همیشه حذف می‌شود. اگر پشیمونی، «انصراف» را بزن — هیچ اتفاقی نمی‌افتد.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>انصراف</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={doDelete}
                    className="bg-destructive text-white hover:bg-destructive/90"
                    data-testid="settings-delete-confirm"
                  >
                    بله، حذف کن
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
