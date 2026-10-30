# Kiara — Self-Learning Language App | اپ یادگیری زبان با درخت مهارت پویا

> **فارسی:** «کیارا» یک اپ یادگیری زبان برای هر زبانی است: هسته‌ی مرکزی ثابت است و هر کاربر یک **درخت مهارت شخصی و پویا** دارد که از رفتار، خطاها، علایق و محتوای خودش رشد می‌کند (مثل talent tree بازی‌ها، اما زنده: قفل/باز/تقویت/محو). هسته‌ی تجربه یک چت هوشمند است که همزمان تمرین‌دهنده و حسگر درخت است. **اصل طلایی:** LLM فقط «شاهد» تولید می‌کند؛ درخت را فقط یک موتور قطعی و قابل‌تست به‌روز می‌کند.

> **English:** Kiara is a language-learning app where a fixed core engine grows a personal,
> dynamic skill tree from each learner's behavior, errors and interests. An AI chat sits at
> the heart of the experience — simultaneously the practice partner and the tree's sensor.
> **Golden rule:** the LLM only produces *evidence*; a deterministic, unit-tested engine
> mutates the tree. Mastery is only ever granted by delayed, unassisted tests.

**MVP scope:** English for Persian (فارسی) speakers · small world graph (~300 nodes) · one
practice chat mode (targeted roleplay) + confirmatory (delayed-test) mode · written evidence
only (reading/writing FSRS) · growth trigger: repeated errors · simple tree view ·
end-of-session summary. **Success = the full loop runs green in E2E:**
chat → evidence → tree update → next chat reflects it → delayed test grants mastery.

## Docs (design phase — read in order)

| # | File | Content |
|---|---|---|
| 0 | [`docs/00-critical-review.md`](docs/00-critical-review.md) | Critical review: contradictions resolved, risks mitigated, gaps filled |
| 1 | [`docs/01-tech-stack.md`](docs/01-tech-stack.md) | Stack decisions with reasons (Next.js 16, Prisma/SQLite, ts-fsrs, xAI Grok) |
| 2 | [`docs/02-data-model.md`](docs/02-data-model.md) | Full schema: graph, user state, evidence, seeds, sessions, JSON contracts |
| 3 | [`docs/03-engines.md`](docs/03-engines.md) | State & growth engines: algorithms, pseudocode, real numeric examples |
| 4 | [`docs/04-prompts.md`](docs/04-prompts.md) | Tutor & Analyst prompts, few-shots, validation/repair loop |
| 5 | [`docs/05-roadmap.md`](docs/05-roadmap.md) | Milestones M0–M9 with acceptance tests (the build order) |

## Architecture invariants

1. `src/lib/engine/**` is **pure TypeScript** — no DB, no LLM, no clock (time is injected).
2. State changes **only** from `Evidence` rows (append-only, user-disputable) or explicit
   user actions — never directly from LLM output.
3. Every LLM output crosses **zod + node-id whitelist** before touching anything.
4. Global knowledge (graph, content) is versioned and shared; user state is separate.
5. No secrets in git — keys live in `.env` (gitignored) only.

## Stack

Next.js 16 (App Router) · TypeScript 5 · Prisma 6 + SQLite · ts-fsrs v6 · xAI Grok
(`grok-4.7` tutor / `grok-4.20-0309-non-reasoning` analyst) · zod · vitest ·
Tailwind CSS 4 + shadcn/ui · Vazirmatn (فونت فارسی) · custom SVG tree.

## Develop

```bash
bun install
bun run db:push        # apply prisma schema to db/custom.db
bun run test           # engine unit tests (no network needed)
bun run dev            # dev server on :3000
bun run lint
bunx tsx scripts/seed-graph.ts   # (M1) seed the world graph — idempotent
```

`.env` (never committed):
```
DATABASE_URL=file:/home/z/my-project/db/custom.db
XAI_API_KEY=...        # xAI key
XAI_TUTOR_MODEL=grok-4.7
XAI_ANALYST_MODEL=grok-4.20-0309-non-reasoning
```

## Repo layout

```
docs/            design documents (Persian summary + English body)
prisma/          schema
src/lib/engine/  deterministic core (pure TS): grading, fsrs, state, growth, brief, planner
src/lib/llm/     xAI client + prompts + validation
src/lib/graph/   graph loading/caching
src/app/api/     thin route handlers
src/app/         UI (RTL Persian)
data/graph-en/   world-graph content
tests/           vitest suites + analyst golden set
scripts/         probes & seeders
AGENT_STATE.md   handoff state for the continuation agent
ROADMAP.md       machine-readable milestone checklist
```
