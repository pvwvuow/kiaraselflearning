# ۰۵ — نقشه راه ساخت | Build Roadmap & Acceptance Tests

> **خلاصه اجرایی (فارسی):** مسیر ساخت به ۱۰ مایل‌استون (M0–M9) تقسیم شده که **به‌ترتیب** اجرا می‌شوند، چون هر یکی به قبلی تکیه دارد. M0 (همین امروز): محیط + مستندات + مدل داده + موتورهای قطعی با تست سبز + push. بعد از آن به‌ترتیب: داده‌ی گراف و تعیین سطح (M1)، احراز هویت سبک و آنبوردینگ (M2)، حلقه‌ی چت با مربی و برگه‌ی جلسه (M3)، تحلیل‌گر و اتصال شواهد به موتور (M4)، رابط چت فارسی RTL (M5)، نمای درخت SVG (M6)، موتور رشد و صندوق بذرها (M7)، تست تأخیری و تسلط و خلاصه‌ی جلسه (M8)، و در پایان متریک‌ها/گاردریل/پولیش/تأیید E2E (M9). هر مایل‌استون تست پذیرش خودکار یا دستی صریح دارد؛ **تا سبز نشدن تست‌ها، مایل‌استون «تمام» حساب نمی‌شود** و ایجنت ادامه‌دهنده اجازه‌ی رفتن به مرحله‌ی بعد را ندارد. معیار موفقیت کل MVP: حلقه‌ی کامل «چت ← شاهد ← به‌روزرسانی درخت ← چت بعدی ← تست تأخیری» به‌صورت خودکار در تست E2E کار کند.

---

## Golden rule for the continuation agent

Work milestones **strictly in order**. A milestone is done only when every acceptance test
passes (`bun run test`) and `bun run lint` is clean. Update `AGENT_STATE.md` after EVERY
milestone. Commit + push after every milestone. Never weaken a test to make it pass — fix
the code. If blocked >30 min on one issue: write it in AGENT_STATE.md under "Blockers",
skip to the next unblocked item WITHIN the same milestone, and note it.

## M0 — Foundation (this session) ✅ target

**Scope:** environment, secrets (env-only), git remote, design docs 00–05, full Prisma
schema pushed to SQLite, deterministic engine core (`types, config, grading, fsrs, state,
growth, brief, planner`) as pure TS, seed graph skeleton (graph loader + sample nodes),
vitest suite covering the numeric tables in `docs/03`.

**Acceptance:**
- [x] `bun run test` green (engine unit tests incl. S1–S8 lifecycle fixture)
- [x] `bun run lint` clean
- [x] `bun run db:push` succeeds; schema matches `docs/02`
- [x] repo pushed to GitHub with zero secrets (grep audit: no `xai-`, no `ghp_` in tracked files)
- [x] engine purity test: no import of prisma/next/llm inside `src/lib/engine/**`

## M1 — Graph data & placement

**Scope:** `data/graph-en/` content files (≥250 nodes: top-frequency words A1–B1 with
Persian glosses, ~25 chunks, ~20 grammar patterns, ~15 pragmatic skills, ~12 fa→en error
patterns, edges: prerequisite/related/confusable/part_of), seed script
(`scripts/seed-graph.ts`, idempotent, versioned), graph loader cache, placement: onboarding
self-level + adaptive band quiz (~12 items, 2-up-1-down) writing `assumed_known` states.

**Acceptance:**
- [ ] seed script rerunnable without duplicates (idempotency test)
- [ ] graph integrity test: all edge endpoints exist & active; no orphans beyond frontier roots
- [ ] placement unit test: answering A2-band correctly lights A1+A2 word band as
      `assumed_known`, never `mastered`
- [ ] `GET /api/graph/stats` returns counts by type/cefr (smoke)

## M2 — Auth-lite & onboarding

**Scope:** signup/login (email+password bcrypt, httpOnly cookie session), onboarding wizard
(level self-report, goal, interests, daily minutes, correction style, consent screen for xAI
processing), user profile API, demo user seed for dev.

**Acceptance:**
- [ ] auth round-trip test (register → login → me → logout) via API
- [ ] onboarding persists profile fields; consent flag stored with timestamp
- [ ] unauthenticated API routes 401; chat/tree routes guarded

## M3 — Tutor chat loop

**Scope:** xAI client (OpenAI-compatible fetch, timeout, retry), prompts module
(`docs/04` verbatim), brief builder (from state, ≤1.5k tokens), `POST /api/session/start`
(creates session + brief + scenario pick), `POST /api/session/turn` (tutor call + i+1 check
+ rewrite pass + turn persistence), rolling summary every 10 turns.

**Acceptance:**
- [ ] brief builder unit test: contains weak/frontier/error-pattern sections, bounded size
- [ ] turn API with mocked LLM returns tutor message + meta.unknownRate recorded
- [ ] i+1 checker unit test: known-list input → rate; violation triggers rewrite path (mocked)
- [ ] live smoke: one real grok-4.7 call returns in-character reply (guarded by env flag)

## M4 — Analyst & evidence wiring

**Scope:** analyst module (per-turn async + end-session batch), zod validation + whitelist +
repair retry, evidence writer (append-only, disputed flag), session-end aggregation pipeline
(`docs/03 §A7`): FSRS update, display-state recompute, propagation, root-cause
re-attribution, growth trigger scan.

**Acceptance:**
- [ ] analyst golden set (≥20 labeled turns) ≥85% node-attribution accuracy (offline, mocked)
- [ ] validation: hallucinated node id → item dropped to new_unknown_words, no state written
- [ ] aggregation E2E (DB): fake evidence set → expected S/D/reps/display transitions
      (fixture = the S1–S8 table from docs/03)
- [ ] dispute API: flag evidence → excluded from next aggregation (unit + DB test)

## M5 — Chat UI (RTL)

**Scope:** Persian RTL chat page (Vazirmatn), scenario card, message list, typing state,
correction chips (✏️), unknown-rate indicator (subtle), session timer, end-session trigger,
responsive (mobile-first), a11y labels.

**Acceptance:**
- [ ] agent-browser: onboarding → start session → send 3 turns → tutor replies render LTR
      inside RTL layout without breakage
- [ ] keyboard-only navigation works; contrast ≥ 4.5:1 on text
- [ ] no console errors in dev.log during the flow

## M6 — Tree view (simple SVG)

**Scope:** deterministic layered layout from prerequisites, NodePosition persistence
(semi-fixed: nodes never jump between visits), node card (title, gloss, 4-skill rings —
listening/speaking shown "—"), state colors + opacity ramp for locked/fading, "why?"
tooltip (reason from evidence summary), pin/hide actions.

**Acceptance:**
- [ ] layout stability test: two renders with unchanged state → identical positions
- [ ] planted seed appears in tree at next visit at a stable position
- [ ] node card shows per-skill mini-state; fading has non-color cue (dashed ring + tooltip)
- [ ] agent-browser screenshot inspection: tree renders with ≥30 nodes, readable at 1280px

## M7 — Growth engine live + seed inbox

**Scope:** repeated_error trigger wired to real evidence, seed scoring (`docs/03 §B3`),
proposal inbox UI with reason breakdown ("چرا این پیشنهاد شد؟"), approve/reject, weekly cap
enforcement, planting (state + position), merge/collapse stubs.

**Acceptance:**
- [ ] unit: 2 errors across 2 sessions on unplanted word → proposal appears with score ≥0.45
- [ ] unit: cap — 4th approval in 7-day window is held in queue (not planted)
- [ ] reject → no re-proposal of same node for 14 days
- [ ] agent-browser: inbox → approve → tree shows new node (celebration animation)

## M8 — Delayed tests, mastery & session summary

**Scope:** confirmatory session mode (samples eligible nodes, 3 contexts each, no hints),
pass/fail → mastery transitions incl. revocation, end-of-session summary UI (reinforced /
seeds / fading / delay results / tomorrow plan), planner mix (40:25:20:15 + probes p=0.3).

**Acceptance:**
- [ ] unit: eligibility gate (reps≥4, S≥21d, ≥3d old) exactly per docs/03 §A6
- [ ] unit: 2/3 correct → mastered; later double-fail → revoked to learning
- [ ] E2E (mocked LLM): full loop — chat → evidence → state change → next session brief
      reflects it → delayed test → mastery. **This is the MVP success criterion.**

## M9 — Metrics, guardrails, cost caps, polish

**Scope:** MetricEvent emission at all points in docs/00 §4, daily token budget with
friendly cap message, content-safety system-prompt hardening + basic filter on user input,
settings page (correction style, level, data export/delete), empty/error/loading states,
final agent-browser E2E of the whole golden path, README with run instructions.

**Acceptance:**
- [ ] metrics test: one fake session emits session_start/end, evidence_created,
      evidence_applied, seed_proposed/approved with correct props
- [ ] budget: over-cap user gets friendly message; no further LLM calls that day
- [ ] export returns JSON of all user data; delete removes user cascade (verify zero rows)
- [ ] agent-browser full golden path green; README accurate

## Post-MVP (explicitly queued, not scheduled)

Voice (listening/speaking + ASR/TTS) → interests/content-import triggers → language packs
framework (tokenizer, RTL/CJK, L1-matrix) → Postgres migration → per-user FSRS
optimization → A/B infra → social/leagues (only if metrics justify).

## Effort & order sanity

M1→M9 is ordered by the critical path of the MVP loop (chat→evidence→state→next chat→delayed
test). M5/M6 (UI) can partially overlap M4 in a later sprint if the agent finishes engine
work early — but never start M5 before M3 is green.
