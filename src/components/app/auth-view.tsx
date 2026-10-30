'use client'

/**
 * Auth view (M5) — login/register tabs, Persian RTL with LTR credential
 * inputs. Success hydrates the store and routes on: un-onboarded users go to
 * the wizard, everyone else home.
 */
import { useState, type FormEvent } from 'react'
import { Sprout, Loader2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError } from '@/lib/client/api'
import { landingViewFor, useAppStore } from '@/stores/app-store'

export default function AuthView() {
  const setUser = useAppStore((s) => s.setUser)
  const setView = useAppStore((s) => s.setView)

  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regName, setRegName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = (user: Parameters<typeof landingViewFor>[0]) => {
    setUser(user)
    setView(landingViewFor(user))
  }

  const run = async (fn: () => Promise<{ ok: true; user: Parameters<typeof go>[0] }>) => {
    setError(null)
    setBusy(true)
    try {
      const r = await fn()
      go(r.user)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'خطای نامشخص — دوباره تلاش کن.')
    } finally {
      setBusy(false)
    }
  }

  const submitLogin = (e: FormEvent) => {
    e.preventDefault()
    void run(() => api.login(loginEmail, loginPassword))
  }
  const submitRegister = (e: FormEvent) => {
    e.preventDefault()
    void run(() => api.register(regEmail, regPassword, regName || undefined))
  }

  const credInput =
    'dir-ltr text-left font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div className="min-h-dvh flex flex-col bg-gradient-to-b from-background to-muted/40">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-md px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sprout className="size-5 text-primary" aria-hidden />
            <h1 className="font-bold">کیارا</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setView('landing')}>
            <ArrowRight className="size-4" aria-hidden />
            بازگشت
          </Button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-lg">خوش آمدی</CardTitle>
            <CardDescription>
              برای رشد درخت مهارتت وارد شو یا یک حساب بساز. داده‌ها فقط مال خودت است.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">ورود</TabsTrigger>
                <TabsTrigger value="register">ثبت‌نام</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form onSubmit={submitLogin} className="space-y-4" aria-label="فرم ورود">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">ایمیل</Label>
                    <Input
                      id="login-email"
                      type="email"
                      required
                      autoComplete="email"
                      dir="ltr"
                      className={credInput}
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">گذرواژه</Label>
                    <Input
                      id="login-password"
                      type="password"
                      required
                      autoComplete="current-password"
                      dir="ltr"
                      className={credInput}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={busy} className="w-full gap-2">
                    {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    ورود
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register">
                <form onSubmit={submitRegister} className="space-y-4" aria-label="فرم ثبت‌نام">
                  <div className="space-y-2">
                    <Label htmlFor="reg-name">نام نمایشی (اختیاری)</Label>
                    <Input
                      id="reg-name"
                      autoComplete="nickname"
                      maxLength={60}
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-email">ایمیل</Label>
                    <Input
                      id="reg-email"
                      type="email"
                      required
                      autoComplete="email"
                      dir="ltr"
                      className={credInput}
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-password">گذرواژه (حداقل ۸ نویسه)</Label>
                    <Input
                      id="reg-password"
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      dir="ltr"
                      className={credInput}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={busy} className="w-full gap-2">
                    {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    ساخت حساب
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            {error && (
              <p role="alert" className="mt-4 text-sm text-destructive leading-6">
                {error}
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
