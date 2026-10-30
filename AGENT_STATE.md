# AGENT STATE — read me first / وضعیت پروژه (برای ایجنت ادامه‌دهنده)

> **فارسی:** این فایل ساعتِ پروژه است. قبل از هر کاری این را کامل بخوان، بعد `ROADMAP.md`، بعد مستندات `docs/`. بعد از هر مایل‌استون این فایل را به‌روز کن، commit و push کن. اگر همه‌ی مایل‌استون‌ها تمام شد، cron را حذف کن و `FINAL_REPORT.md` بنویس.

> **English:** This file is the project's clock. Read it fully, then `ROADMAP.md`, then `docs/`.
> Update it after every milestone, then commit + push. When ALL milestones are done: delete the
> cron job and write `FINAL_REPORT.md`.

## Snapshot (updated 2026-10-30)

| Field | Value |
|---|---|
| Project | Kiara — language learning with a living personal skill tree |
| Root | `/home/z/my-project` |
| Repo | `origin` → https://github.com/pvwvuow/kiaraselflearning (branch `main`) |
| Current milestone | **M0 ✅ + M1 ✅ + M2 ✅ + M3 ✅ DONE → next: M4** |
| Tests | 125/125 green + 1 env-gated skip (`bun run test`; live smoke needs `KIARA_LIVE_SMOKE=1`) |
| Lint | clean (`bun run lint`) |
| DB | SQLite at `db/custom.db`, schema pushed, 268 graph nodes + 205 edges seeded, demo user ready |
| Dev server | auto-runs on :3000 (do NOT run `bun run dev` yourself; check `dev.log`) |

## Environment & secrets (CRITICAL RULES)

- Keys live in `.env` (gitignored): `XAI_API_KEY` (xAI), plus `XAI_TUTOR_MODEL=grok-4.7`,
  `XAI_ANALYST_MODEL=grok-4.20-0309-non-reasoning` (both verified live).
- **NEVER commit `.env`, `.git-credentials`, or any key.** Before every push run:
  `git diff --cached | grep -iE "xai-|ghp_|sk-" && echo "SECRET LEAK — ABORT" || echo clean`
- Git push works via credential helper already configured (`.git-credentials`, outside git).
- xAI API: OpenAI-compatible. `POST https://api.x.ai/v1/chat/completions`,
  `GET https://api.x.ai/v1/models`. Verified models include: grok-4.7, grok-4.6, grok-4.5,
  grok-4.3, grok-4.20-0309-non-reasoning, grok-4.20-0309-reasoning.
- Sandbox UI constraint: **the user only sees the `/` route** — build the product UI as ONE
  route with client-side view switching (chat / tree / seed inbox / settings tabs via
  zustand). `/api/*` routes are fine. Do NOT run `bun run build`. Check `dev.log` after changes.

## How to work (the loop)

1. Read `ROADMAP.md` → first unchecked milestone in order.
2. Read the matching acceptance tests in `docs/05-roadmap.md` (they are the definition of done).
3. Implement (follow `docs/01` stack + `docs/02` schema + `docs/03` engine rules + `docs/04` prompts).
4. `bun run test` + `bun run lint` must be green. Never weaken a test to pass it — fix the code.
5. Update `ROADMAP.md` checkboxes + this file's Snapshot/sections.
6. Secret-leak check (command above), then `git add -A && git commit -m "M<n>: <what>" && git push`.
7. Verify the cron job still exists (`cron` tool, action: list). If missing and work remains → recreate it (see "Cron self-healing" below).

## Architecture invariants (never violate)

1. `src/lib/engine/**` stays PURE: no prisma/next/llm imports, no ambient clock
   (`tests/engine/purity.test.ts` enforces this).
2. LLM output → zod + `isKnownNodeId()` whitelist → Evidence rows → deterministic engine →
   state. LLM NEVER writes state directly.
3. Evidence is append-only; users can dispute (excluded from aggregation), never delete.
4. Mastery only via delayed test (docs/03 §A6); `assumed_known` ≠ mastered.
5. One FSRS review per (node × skill × session) — session aggregation (docs/03 §A1–A2).
6. UI is Persian, RTL, Vazirmatn (fonts in `public/fonts/`). English inside conversation bubbles.

## Current state of the code (M0+M1+M2+M3 delivered)

- `docs/00–05` complete design (bilingual). `README.md` with quickstart.
- `prisma/schema.prisma` — full model (GraphNode, GraphEdge, UserNodeState, Evidence,
  ChatSession, Turn, Seed, NodePosition, MetricEvent, User, UserSession).
- `src/lib/engine/` — pure deterministic core, 81 tests total:
  `types.ts` (all unions/contracts + CefrBand + placement contracts) · `config.ts` (every constant,
  documented) · `grading.ts` (evidence→aggregate→FSRS rating; gap vs slip) · `fsrs.ts` (ts-fsrs v6
  wrapper) · `state.ts` (applySessionReview, display states, propagation, root-cause,
  mastery/revocation, fading) · `growth.ts` (repeated_error trigger, scoring, cap) · `brief.ts`
  (session brief + planner mix + i+1 budget) · `graph.ts` (availability/frontier/tier) ·
  `placement.ts` (M1: seeded quiz pools, 2-up/1-down ladder, assumed_known writer — never mastered).
- `src/lib/graph/load.ts` — in-memory graph cache + node-id whitelist.
- `data/graph-en/` — **M1: 268 nodes / 205 edges** (189 words A1–B1 with fa glosses + freq ranks,
  25 chunks, 21 grammar patterns, 15 pragmatic skills, 12 fa→en error patterns, 6 clusters).
  Content authored via `scripts/graph_data_*.py` → `scripts/build-graph-data.py` (validates ids,
  endpoints, dupes, DAG, quiz-ability → writes JSON). `scripts/seed-graph.ts` — idempotent,
  two-pass (all nodes → all edges) inside one transaction.
- `src/app/api/graph/stats/route.ts` — GET counts by type/cefr (live-verified on :3000).
- `src/lib/auth/` — **M2**: `password.ts` (bcryptjs cost 10) · `session.ts` (30-day cookie
  sessions on `UserSession`; framework-free `Request`/`Response` — NO `next/headers`, so routes
  are directly unit-testable; `requireUser` guard; `toPublicUser` never leaks passwordHash) ·
  `schemas.ts` (zod v4: register/login/onboarding; consentLlm boolean → `consentLlmAt` timestamp).
- API routes (all live-verified on :3000): `POST /api/auth/register|login|logout`, `GET /api/auth/me`,
  `GET|PATCH /api/onboarding` (guarded, 401). `GET /api/graph/stats` stays PUBLIC (world metadata,
  no user data). New user-scoped routes MUST use `requireUser` (M3 chat/tree included).
- `scripts/seed-demo-user.ts` — dev demo login `demo@kiara.app` / `kiara-demo-1234` (dev-only).
- Tests: `tests/engine/` (53+8 i+1) + `tests/graph/integrity.test.ts` (9) + `tests/api/graph-stats.test.ts`
  + `tests/db/seed-idempotency.test.ts` (runs the real seeder twice against SQLite)
  + `tests/api/auth-roundtrip.test.ts` (9: round-trip, consent timestamp, guards, 400/401/409)
  + **M3**: `tests/engine/iplus1.test.ts` (8) · `tests/llm/prompts.test.ts` (7) ·
  `tests/llm/xai-client.test.ts` (7: retry/timeout/fail-fast/model routing, injected fetch) ·
  `tests/session/brief-builder.test.ts` (5: sections, whitelist, ≤1500 tokens, boundToBudget) ·
  `tests/api/session-flow.test.ts` (8: start/turn/guards/rewrite/fallback/summary — mocked LLM
  via `vi.mock('@/lib/llm/xai')`) · `tests/llm/live-smoke.test.ts` (1, runs only with
  `KIARA_LIVE_SMOKE=1` — real grok-4.7 in-character check).
- `scripts/fsrs-probe.ts` — produces the REAL numeric tables used in docs/03.
- `src/lib/engine/iplus1.ts` — **M3**: pure i+1 checker (tokenizer, light lemmatizer,
  irregular map, function/discourse-word exemptions, proper-noun & number exemption,
  tiny-reply guard ≤3 content words). Violation = rate > 0.1 on >3 content words.
- `src/lib/llm/xai.ts` — **M3**: OpenAI-compatible fetch client; 30 s AbortController timeout,
  ONE retry on network/429/5xx (400 ms backoff), injectable `fetchImpl`/`sleep`/`env` for tests;
  models from `XAI_TUTOR_MODEL` / `XAI_ANALYST_MODEL`; never throws (discriminated result).
- `src/lib/llm/prompts.ts` — **M3**: docs/04 tutor template VERBATIM + tiny deterministic
  renderer (`{{#each}}` blocks), `wrapUserMessage` injection defense (<<<USER … >>>),
  rewrite messages (unknown list fed back), deterministic fallback replies, rolling-summary prompt.
- `src/lib/session/` — **M3** wiring layer (imports db + engine + llm):
  `scenarios.ts` (12 goal-tagged roleplay scenarios, FNV-1a deterministic pick per user+day,
  mustElicit whitelist-resolved) · `brief-builder.ts` (states→knownBands/sampleLemmas,
  rankWeakNodes dedupe, frontier by freq rank, error patterns from last-30d confident errors
  with Persian descs + faDigits, `boundToBudget` trims error-patterns→weak→frontier→lemmas,
  `getKnownLemmas` for the i+1 allowlist) · `chat.ts` (startSession + runTutorTurn;
  shared `enforceIPlus1`: check → 1 rewrite → fallback, used by opener AND turns;
  history window 20 + rolling summary injection; summary every 10 user turns via analyst role;
  `ChatError` → 404/409/400; LLM failure NEVER blocks the conversation — fallback replies).
- API routes (live-verified on :3000 with real grok-4.7): `POST /api/session/start`
  (401/403-consent/200 brief+scenario+opener), `POST /api/session/turn`
  (401/400/404/409/200 tutor+meta{unknownRate,unknownWords,rewritten,fallback}+summaryUpdated).
  Both `requireUser`-guarded; turn validates ownership (foreign session → 404) + active status.
- Live-verified behavior: tutor elicits mustElicit targets ("Hotel Mehr is on the left"),
  i+1 violation triggers rewrite (meta.rewritten=true); LLM flakiness degrades to original/
  fallback replies without 500s.
- Landing page `/` — Persian RTL status page (browser-verified, no console errors).

## Known issues / gotchas

- ts-fsrs v6 API: `new FSRS(generatorParameters())`, `f.repeat(card, now)[Rating.X].card`,
  `f.retrievability(card, now)`; Rating/State are plain objects (no reverse map).
- Prisma on SQLite: no enums — strings + zod. `UserNodeState.learningSteps` persists
  `card.learning_steps` (needed for correct round-trips).
- **Seeder must insert ALL nodes before ANY edges** (FK order): fixed in M1 by two-pass +
  `$transaction`; do not regress this.
- Placement final band = highest band with positive correct/wrong majority (docs/05 M1 unit
  test pins this); null → light NOTHING (absolute beginner, C2a ultra-light register).
- `.gitignore` excludes `download/ upload/ skills/ tests/*.sh examples/ mini-services/ .zscripts/
  Caddyfile db/ .env* .git-credentials` — real tests under `tests/**/*.test.ts` ARE tracked. Keep it that way.
- Auth routes avoid `next/headers` on purpose (plain Request/Response → unit-testable). Keep
  this pattern; read cookies via `req.headers.get('cookie')`, set via `set-cookie` header.
- `package.json` name is still `nextjs_tailwind_shadcn_ts` — fine to rename in M9 polish.
- The route `src/app/api/route.ts` is a template leftover health endpoint — replace in M3.
  (M3 note: left as-is; it's harmless. Remove in M9 polish.)
- **Fresh users have an EMPTY known lexicon** until placement states exist (M1 engine is pure;
  wiring the quiz into onboarding is not done yet). i+1 then treats most content words as
  unknown → openers/turns burn a rewrite call and often degrade to the deterministic fallback.
  This is data-honest (docs: mastery/assumption only via placement), not a bug. Wiring
  placement → assumed_known into onboarding would soften it (candidate for M4/M5 gap work).
- DB contains the M0 sample nodes TOO (seed.sample.json): e.g. en:word:airport/hotel/recommend
  exist ONLY there — when authoring content, check `loadGraph()` (all files) not just words.*.json.
- xAI latency is real-world slow (opener ~2.5–7 s; a turn + rewrite can hit ~60 s when the
  rewrite path fires — 30 s timeout × 2 attempts). Keep UI timeouts generous (M5).
- Known-lexicon counts come from the loader's 268 nodes; `en:word:you/do/good` (sample file)
  surface as frontier targets — harmless but noisy; consider pruning sample function words in
  a later data pass.

## Blockers

(none)

## Cron self-healing

The scheduled job `kiaraself-continuation` (every 10 min) runs this prompt. If you are reading
this from a cron run and the job list is empty while work remains, recreate it:
`cron` tool → action `create`, name `kiaraself-continuation`, kind `agentTurn`, cron
`0,10,20,30,40,50 * * * *`, tz `Asia/Tehran`, message = the same continuation prompt stored
in `docs/06-continuation-prompt.md`. When ALL milestones are complete instead: delete the job,
write `FINAL_REPORT.md` (what was built, test counts, how to run, what's next post-MVP), push.
