# ۰۱ — انتخاب پشته فنی | Tech Stack Decision

> **خلاصه اجرایی (فارسی):** یک مونولیت **Next.js 16 + TypeScript** (App Router) می‌سازیم: فرانت و بک‌اند یکجا، تایپ‌های مشترک بین موتور قطعی و UI، و سریع‌ترین مسیر تا MVP. دیتابیس **SQLite + Prisma** (گراف در جداول رابطه‌ای؛ برای ~۳۰۰ تا ۱۰هزار گره، پیمایش گراف در حافظه کاملاً کافی است و بعداً با یک env به Postgres مهاجرت می‌شود). زمان‌بندی مرور با **ts-fsrs v6** (پیاده‌سازی مرجع FSRS در TS). مدل زبانی: **xAI Grok** — مربی `grok-4.7` (قوی، گرم، طبیعی) و تحلیل‌گر `grok-4.20-0309-non-reasoning` (ارزان و سریع برای JSON). اعتبارسنجی خروجی LLM با **zod** و لیست سفید گره‌ها. تست با **vitest**. UI با **Tailwind 4 + shadcn/ui** و RTL کامل فارسی (فونت Vazirmatn). درخت با **SVG سفارشی** (بدون وابستگی سنگین) و چیدمان نیمه‌ثابت مبتنی بر موقعیت ذخیره‌شده در DB.

---

## Decision table

| Layer | Choice | Runner-ups & why rejected |
|---|---|---|
| Runtime / framework | **Next.js 16 (App Router) + TypeScript 5** | Separate FastAPI backend: +1 deployable, +1 language boundary, type drift between engine and UI, slower iteration for a solo-built MVP. React Native/Expo: no web-first preview, heavier tooling. |
| Language | **TypeScript everywhere** (strict) | The deterministic engines are the product's IP; sharing their types with the UI removes a whole class of bugs. |
| Database | **SQLite via Prisma 6** (file at `db/custom.db`) | Postgres: right for prod-scale, wrong for MVP ops (no service to babysit here); Prisma keeps the switch to one env-var change. Neo4j: graph queries at 300–10k nodes are trivially in-memory; a graph DB adds ops for nothing. **Graph = tables `GraphNode`/`GraphEdge`; reachability/closure computed in TS and cached.** |
| Scheduling (SRS) | **ts-fsrs v6** | Hand-rolled FSRS: weeks of math validation for no gain; anki_rs: wrong runtime. ts-fsrs is the maintained reference TS port (FSRS-6 parameters, MIT). |
| LLM provider | **xAI Grok API** (OpenAI-compatible) | Tutor = `grok-4.7` (quality of persona, correction judgement); Analyst = `grok-4.20-0309-non-reasoning` (cheap, fast, sufficient for structured extraction). OpenAI/Anthropic: user chose Grok explicitly; the client is OpenAI-compatible so swapping is a base-URL + model change. |
| LLM output safety | **zod v4 schema + node-id whitelist + 1 repair retry** | Free JSON parsing: one malformed item poisons state. See `docs/00` R1. |
| Tests | **Vitest** (unit for engines, golden set for analyst) | Jest: slower, more config. Engine tests run with **no network, no DB** (pure functions over plain data). |
| Styling / UI kit | **Tailwind CSS 4 + shadcn/ui (New York) + Lucide** | MUI/AntD: fighting RTL and theming. shadcn gives full source ownership — required for RTL + tree custom work. |
| RTL / fonts | `dir="rtl"` root, **Vazirmatn** bundled via `next/font/local`, Latin text in conversations wrapped LTR | System fonts only: Persian rendering quality varies wildly by OS. |
| Tree rendering | **Custom SVG** (deterministic layered layout, positions persisted per user in `NodePosition`) | D3 full lib: 90kb for layout math we can do in 60 lines; react-flow: edge-routing opinions clash with semi-fixed layout. |
| Client state | **Zustand** (chat/session UI) + TanStack Query (server state) | Redux: boilerplate. Context: re-render storms on chat streams. |
| Auth | **Cookie session, email+password (bcrypt), `Session` table** | NextAuth v4: provider surface we don't need for MVP; a 40-line session module is auditable. Google/GitHub login: post-MVP. |
| Realtime | Plain HTTP request/response per turn (analyst is async; SSE for "analysis done" toast post-MVP) | WebSocket: unnecessary until voice/streaming. |
| Deployment (target) | Vercel or Fly.io (single Node service + attached SQLite→Postgres) — later | Not an MVP concern; sandbox preview now. |

## Model routing & cost controls (concrete)

```
TUTOR   -> grok-4.7                    ~1 call/turn, ctx ≤ ~2.5k tokens out ≤ 250 tokens
ANALYST -> grok-4.20-0309-non-reasoning  ~1 call/session-batch + optional per-turn
REWRITE -> same as tutor, only when unknown-rate > 10% (target <5% of turns)
```

- Daily per-user LLM budget (token estimate counter in `MetricEvent`, hard stop at cap with friendly message) — default 250k tokens/day.
- Brief instead of tree; rolling summary every 10 turns; history window = last 10 turns.
- Analyst results are pure function of (turns, brief) — cacheable by turn-hash at the same graph version.

## Repository layout (target)

```
docs/                     design documents (this folder)
prisma/schema.prisma      full data model (see 02)
src/lib/engine/           DETERMINISTIC CORE — pure TS, no I/O
  types.ts grading.ts fsrs.ts state.ts growth.ts brief.ts planner.ts
src/lib/llm/              xai client, tutor.ts, analyst.ts, prompts.ts, validate.ts
src/lib/graph/            graph load, closure, placement helpers
src/app/api/*             route handlers (thin: parse -> engine -> persist)
src/app/(app)/*           UI: onboarding, chat, tree, settings
src/components/tree/      SVG tree renderer + node card
data/graph-en/            seed content (words, chunks, grammar, errors)
tests/                    vitest: engine units + analyst golden set
scripts/                  fsrs-probe, seed, verify
AGENT_STATE.md ROADMAP.md handoff files for the continuation agent
```

## Non-negotiable invariants enforced by the stack

1. `src/lib/engine/**` imports nothing from `@prisma/client`, `next`, or any LLM SDK — pure data in, pure data out. (Checked by an import-lint test.)
2. Every state mutation originates from an `Evidence` row (or an explicit user action with its own audit row).
3. All LLM output crosses zod + whitelist before touching anything.
4. No secret ever enters git; `.env` is gitignored; `.git-credentials` lives outside the repo tree scope of pushes.
