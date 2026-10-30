import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Sprout,
  MessageCircle,
  GitBranch,
  ShieldCheck,
  FlaskConical,
  Database,
  ArrowLeft,
  Github,
} from "lucide-react"

const milestones = [
  { id: "M0", title: "پایه: مستندات، مدل داده، موتورهای قطعی + تست", state: "done" },
  { id: "M1", title: "داده‌ی گراف (~۳۰۰ گره) و تعیین سطح تطبیقی", state: "next" },
  { id: "M2", title: "احراز هویت سبک و آنبوردینگ", state: "todo" },
  { id: "M3", title: "حلقه‌ی چت: برگه‌ی جلسه + مربی Grok + i+1", state: "todo" },
  { id: "M4", title: "تحلیل‌گر، اعتبارسنجی zod و اتصال شواهد", state: "todo" },
  { id: "M5", title: "رابط چت فارسی RTL", state: "todo" },
  { id: "M6", title: "نمای درخت SVG نیمه‌ثابت", state: "todo" },
  { id: "M7", title: "موتور رشد زنده + صندوق بذرها", state: "todo" },
  { id: "M8", title: "تست تأخیری، تسلط و خلاصه‌ی جلسه", state: "todo" },
  { id: "M9", title: "متریک‌ها، گاردریل‌ها و پولیش نهایی", state: "todo" },
] as const

const principles = [
  {
    icon: ShieldCheck,
    title: "LLM فقط شاهد می‌دهد",
    desc: "خروجی مدل زبانی هرگز مستقیم درخت را تغییر نمی‌دهد؛ فقط شواهد JSON تولید می‌کند و موتور قطعی تصمیم می‌گیرد.",
  },
  {
    icon: GitBranch,
    title: "گراف داده است، درخت فقط نمایش",
    desc: "گره‌ها و یال‌ها (پیش‌نیاز/مرتبط/قابل‌اشتباه) در گراف جهانی نسخه‌دار ذخیره می‌شوند.",
  },
  {
    icon: MessageCircle,
    title: "چت = تمرین‌دهنده + حسگر",
    desc: "مربی با grok-4.7 حرف می‌زند؛ تحلیل‌گر async و ارزان فقط شواهد استخراج می‌کند.",
  },
  {
    icon: Sprout,
    title: "رشد با تأیید خودت",
    desc: "بذرها امتیاز می‌گیرند (هدف × فرکانس × آمادگی × تازگی)، سقف هفتگی دارند و بدون کلیک تو کاشته نمی‌شوند.",
  },
  {
    icon: FlaskConical,
    title: "تسلط فقط با تست تأخیری",
    desc: "هیچ چیز «مسلط» نیست مگر چند روز بعد، در بافت متفاوت و بدون کمک — و قابل بازگشت است.",
  },
  {
    icon: Database,
    title: "FSRS به‌ازای گره × مهارت",
    desc: "زمان‌بندی مرور با ts-fsrs v6 و retention هدف ۸۵٪، جدا برای خواندن و نوشتن.",
  },
]

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-muted/40">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sprout className="size-6 text-primary" aria-hidden />
            <div>
              <h1 className="text-lg font-bold leading-tight">کیارا</h1>
              <p className="text-xs text-muted-foreground">درخت مهارت زنده برای یادگیری زبان</p>
            </div>
          </div>
          <Badge variant="secondary" className="gap-1">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
            M0 کامل شد — ۵۳ تست سبز
          </Badge>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 space-y-8">
        {/* Hero */}
        <section className="text-center space-y-3" aria-labelledby="hero-title">
          <h2 id="hero-title" className="text-2xl sm:text-3xl font-bold leading-relaxed">
            اپلیکیشن یادگیری زبان با <span className="text-primary">درخت مهارت شخصی و پویا</span>
          </h2>
          <p className="text-muted-foreground leading-8 max-w-2xl mx-auto">
            مثل talent tree بازی‌ها، اما زنده: گره‌ها با رفتار، خطاها و علایق تو باز می‌شوند، تقویت می‌شوند و
            اگر فراموش شوند کم‌رنگ می‌شوند. هسته‌ی تجربه یک چت هوشمند است که همزمان تمرین‌دهنده و حسگر درخت
            است. MVP: انگلیسی برای فارسی‌زبانان.
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <Badge variant="outline">Next.js 16 + TypeScript</Badge>
            <Badge variant="outline">Prisma + SQLite</Badge>
            <Badge variant="outline">ts-fsrs v6</Badge>
            <Badge variant="outline">xAI Grok (grok-4.7)</Badge>
            <Badge variant="outline">Vitest — ۵۳ تست</Badge>
          </div>
        </section>

        <Separator />

        {/* Principles */}
        <section aria-labelledby="principles-title" className="space-y-4">
          <h3 id="principles-title" className="text-xl font-bold">اصول طراحی</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {principles.map((p) => (
              <Card key={p.title} className="gap-3">
                <CardHeader className="gap-2">
                  <p.icon className="size-5 text-primary" aria-hidden />
                  <CardTitle className="text-base leading-7">{p.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-7">{p.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Separator />

        {/* Roadmap */}
        <section aria-labelledby="roadmap-title" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 id="roadmap-title" className="text-xl font-bold">نقشه‌ی راه ساخت</h3>
            <span className="text-sm text-muted-foreground">۱ از ۱۰ مایل‌استون · ~۱۰٪</span>
          </div>
          <Progress value={10} aria-label="پیشرفت پروژه: ۱۰ درصد" />
          <ol className="space-y-2">
            {milestones.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
              >
                <Badge
                  variant={m.state === "done" ? "default" : m.state === "next" ? "secondary" : "outline"}
                  className="w-12 justify-center tabular-nums"
                >
                  {m.id}
                </Badge>
                <span className={`text-sm leading-7 ${m.state === "todo" ? "text-muted-foreground" : ""}`}>
                  {m.title}
                </span>
                {m.state === "done" && (
                  <Badge variant="default" className="ms-auto gap-1">
                    <ShieldCheck className="size-3" aria-hidden /> کامل
                  </Badge>
                )}
                {m.state === "next" && (
                  <Badge variant="secondary" className="ms-auto">قدم بعدی</Badge>
                )}
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted-foreground leading-7">
            ادامه‌ی ساخت به‌صورت خودکار توسط ایجنت زمان‌بندی‌شده انجام می‌شود؛ وضعیت لحظه‌ای در
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs" dir="ltr">AGENT_STATE.md</code>
            و
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs" dir="ltr">ROADMAP.md</code>
            ریپو.
          </p>
        </section>

        <Separator />

        {/* Loop */}
        <section aria-labelledby="loop-title" className="space-y-4">
          <h3 id="loop-title" className="text-xl font-bold">حلقه‌ی طلایی MVP</h3>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {["چت با مربی", "استخراج شاهد", "به‌روزرسانی درخت (FSRS)", "چت بعدی هوشمندتر", "تست تأخیری → تسلط"].map(
              (step, i, arr) => (
                <span key={step} className="flex items-center gap-2">
                  <Badge variant={i === arr.length - 1 ? "default" : "outline"} className="px-3 py-1.5">
                    {step}
                  </Badge>
                  {i < arr.length - 1 && <ArrowLeft className="size-4 text-muted-foreground" aria-hidden />}
                </span>
              ),
            )}
          </div>
          <p className="text-sm text-muted-foreground leading-7">
            معیار موفقیت MVP این است که این حلقه به‌صورت سرتاسری در تست E2E سبز شود.
          </p>
        </section>
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto max-w-5xl px-4 py-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>کیارا — ساخت خودکار با Z.ai + Grok</span>
          <span className="flex items-center gap-1" dir="ltr">
            <Github className="size-4" aria-hidden />
            pvwvuow/kiaraselflearning
          </span>
        </div>
      </footer>
    </div>
  )
}
