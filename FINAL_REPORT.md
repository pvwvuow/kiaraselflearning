# Kiara — FINAL REPORT (MVP complete, 2026-10-30)

> **فارسی:** اپ یادگیری زبان «کیارا» با درخت مهارت پویا ساخته شد — همه‌ی ۱۰ مایل‌استون
> (M0–M9) طبق `docs/05-roadmap.md`، به‌ترتیب و با تست سبز، تحویل داده شد. ۲۴۸ تست
> پاس می‌شود. جزئیات پایین — نحوه‌ی اجرا، معماری، و پیشنهادهای پس از MVP.

## What was built (چه ساخته شد)

**The idea, honored end-to-end:** every learner owns a living personal skill tree that
grows from behavior, errors and interests. The chat is both practice partner and the
tree's sensor. All 5 non-negotiable principles hold in the shipped code:

1. **LLM only emits evidence** — every model output crosses zod + node-id whitelist
   before touching anything; the LLM never writes state.
2. **Deterministic engines own state** — `src/lib/engine/**` is pure TypeScript
   (no prisma/next/LLM imports, no ambient clock; enforced by a purity test).
3. **The graph is data, the tree is a view** — 268 nodes / 205 edges (words with fa
   glosses + frequency ranks, chunks, grammar, pragmatics, fa→en error patterns,
   clusters); deterministic layered layout, positions persisted and stable.
4. **Mastery only via delayed testing** — confirmatory probes (≤2 nodes × 3 fresh
   contexts, no hints, no warm-up); pass → mastered, fail → 7-day retry, double-fail
   post-mastery → revoked. `assumed_known` (placement) is never mastery.
5. **The user owns the controls** — settings page: correction style, level, goal,
   daily minutes, LLM consent toggle, one-click JSON data export, full account delete
   (cascade verified to zero rows). Evidence is append-only and user-disputable.

**The full MVP loop works** (the success criterion, E2E-tested and live-verified):
chat with the tutor → analyst turns messages into evidence → session-end pipeline
(aggregation → FSRS → propagation → root-cause → growth scan) → tree updates → next
session's brief reflects it → delayed test → mastery.

**Milestone map (all ✅):**

| Milestone | Delivered |
|---|---|
| M0 | Design docs 00–06, full Prisma schema, pure engine core, Persian RTL landing |
| M1 | Graph expanded to 268 nodes/205 edges + integrity tests + adaptive placement (2-up/1-down ladder) |
| M2 | Email+password auth, httpOnly sessions, onboarding API + consent timestamping |
| M3 | Tutor loop (xAI grok-4.7), docs/04 prompts verbatim, brief builder, i+1 checker with rewrite-on-violation |
| M4 | Analyst (grok-4.20) with zod+whitelist+repair, append-only evidence + dispute, §A7 pipeline, 22-turn golden set (100% offline attribution) |
| M5 | Single-route Persian RTL UI (chat/onboarding/home/auth), live placement in onboarding, mobile-first |
| M6 | SVG tree view: deterministic layout, state colors, fading rings, pin/hide, "why?" panel |
| M7 | Growth engine live: repeated-error seeds → inbox → approve (weekly cap 3) → plant with celebration; 14-day reject cooldown |
| M8 | Confirmatory delayed tests → mastery/revocation, ride-along probes, planner mix 40:25:20:15, full session summary |
| M9 | MetricEvent emission at all documented points, daily LLM token budget with friendly cap, content-safety screen + hardened prompt, settings page (style/level/consent/export/delete), README accuracy, package renamed `kiara`, final browser golden-path pass |

## Test counts (تعداد تست‌ها)

- **248 passing + 1 env-gated skip** (`bun run test`): engine units (incl. purity,
  FSRS tables, delayed-test machinery), graph integrity, seeder idempotency, auth
  round-trip, session flow, analyst validation + golden set, evidence pipeline
  (S1–S8 through the real DB), tree layout/API, seeds, confirmatory, **E2E MVP loop**,
  metrics acceptance, budget, safety, settings (PATCH/export/delete-cascade).
- `bun run lint` clean; `src/` fully typechecks.
- Live verifications: real grok-4.7 tutor turns, real grok-4.20 analyst grading,
  a real mastery (`en:word:recommend`) and an honest failure (`en:word:journey`),
  browser golden path with zero console errors.

## How to run (نحوه‌ی اجرا)

```bash
bun install
bun run db:push                      # schema → db/custom.db
bunx tsx scripts/seed-graph.ts       # world graph (idempotent)
bunx tsx scripts/seed-demo-user.ts   # demo login: demo@kiara.app / kiara-demo-1234
bun run dev                          # http://localhost:3000 — everything on ONE route
bun run test && bun run lint         # 248 green
```

`.env` keys (never committed): `DATABASE_URL`, `XAI_API_KEY`, `XAI_TUTOR_MODEL`,
`XAI_ANALYST_MODEL`, optional `KIARA_DAILY_TOKEN_BUDGET` (default 150000 tokens/day/user).
Live smoke: `KIARA_LIVE_SMOKE=1 bunx vitest run tests/llm/live-smoke.test.ts`.

## Post-MVP suggestions (پیشنهاد پس از MVP)

1. **Voice** (listening/speaking skills already have UI placeholders "—"): ASR/TTS on
   the same evidence contract — the engine needs zero changes.
2. **Interests & content import** triggers for the growth engine (the Seed model already
   carries `interest|goal|imported` trigger types).
3. **Language-pack framework**: tokenizer + RTL/CJK handling + L1 error matrix behind
   the current `lang='en'` parameter; fa→en patterns become one L1 row.
4. **Postgres migration** before real traffic (SQLite → Postgres is a Prisma provider
   swap; the only raw SQL is none — all through Prisma).
5. **Per-user FSRS optimization** (request_retention per learner) + A/B infra once
   MetricEvent rows accumulate — the `llm_call`/`delay_test_result` ledgers are the
   training data.
6. **Key rotation reminder**: both secrets (xAI + GitHub) were pasted in chat during
   development — rotate them now that development is complete.
