# ROADMAP — machine-readable checklist (do in strict order)

> Definition of done per milestone: every acceptance test in `docs/05-roadmap.md` passes,
> `bun run test` + `bun run lint` green, AGENT_STATE.md updated, committed & pushed.
> Never check a box that isn't really done. Never weaken tests.

## M0 — Foundation ✅ (2026-10-30)
- [x] Environment, secrets (env-only), git remote, ts-fsrs + vitest installed
- [x] Design docs 00–05 + README (bilingual)
- [x] Full Prisma schema pushed (GraphNode/Edge/UserNodeState/Evidence/ChatSession/Turn/Seed/NodePosition/MetricEvent/User/UserSession)
- [x] Deterministic engine core (types/config/grading/fsrs/state/growth/brief/planner/graph) — PURE
- [x] 53 vitest tests green (S1–S8 lifecycle fixture, propagation bounds, mastery/revocation, fading, seed scoring, cap, purity)
- [x] Sample graph (46 nodes / 23 edges) + idempotent seeder + in-memory loader/whitelist
- [x] Persian RTL landing page (Vazirmatn local, browser-verified)
- [x] Pushed to GitHub with zero secrets

## M1 — Graph data & placement ✅ (2026-10-30)
- [x] Expand `data/graph-en/` to ≥250 nodes (268 nodes / 205 edges: 189 words with fa glosses + frequency ranks, 25 chunks, 21 grammar patterns, 15 pragmatic skills, 12 fa→en error patterns, 6 clusters)
- [x] Graph integrity test: all edge endpoints exist & active; prereq DAG + no islands (frontier roots = nodes without prereqs)
- [x] Placement: adaptive band quiz (2-up/1-down ladder, ~12 items) → `assumed_known` states (NEVER mastered) — pure `src/lib/engine/placement.ts`
- [x] `GET /api/graph/stats` returns counts by type/cefr
- [x] Seeder still idempotent (rerun test) — fixed to two-pass (all nodes → all edges) inside one transaction (cross-file FK order bug)

## M2 — Auth-lite & onboarding ✅ (2026-10-30)
- [x] Email+password (bcryptjs) + httpOnly cookie sessions (`UserSession`) — framework-free Request/Response handlers
- [x] Onboarding API (`GET`/`PATCH /api/onboarding`): level self-report, goal, interests, daily minutes, correction style, xAI consent (timestamped `consentLlmAt`) — wizard UI lands with the `/` view-switching work (M5)
- [x] Guarded API routes (401 when unauthenticated) via `requireUser`; demo user seed (`scripts/seed-demo-user.ts`, demo@kiara.app)
- [x] Auth round-trip API test (register → login → me → logout) + 400/401/409 cases (9 tests)

## M3 — Tutor chat loop ✅ (2026-10-30)
- [x] xAI client (fetch, timeout 30s, 1 retry) reading `.env` models
- [x] Prompts module verbatim from `docs/04` (tutor system prompt + user-message wrapping)
- [x] Brief builder wired to real state (weak/frontier/error-patterns/scenario) — bounded ≤1.5k tokens
- [x] `POST /api/session/start` (brief snapshot + scenario pick) · `POST /api/session/turn` (tutor + i+1 check + rewrite-on-violation + Turn persistence)
- [x] Rolling summary every 10 turns
- [x] Unit tests: brief content/bounds, i+1 checker math, rewrite path (mocked LLM); live smoke behind env flag

## M4 — Analyst & evidence wiring ✅ (2026-10-30)
- [x] Analyst module: per-turn async + end-of-session batch; zod + whitelist + 1 repair retry
- [x] Evidence writer (append-only, disputed flag) + `POST /api/evidence/:id/dispute`
- [x] Session-end pipeline (docs/03 §A7): aggregation → FSRS update → display recompute → propagation → root-cause → growth scan
- [x] Analyst golden set ≥20 labeled turns, ≥85% attribution accuracy (offline harness)
- [x] E2E (DB, mocked LLM): fake evidence reproduces the S1–S8 table transitions

## M5 — Chat UI (RTL, single route) ✅ (2026-10-30)
- [x] Chat view inside `/` (view-switching via zustand): scenario card, messages, typing state, correction chips, unknown-rate hint, session timer, end-session (+ auth/onboarding/home views in the same shell)
- [x] Mobile-first responsive; keyboard navigable; contrast ≥4.5:1; LTR bubbles for English text
- [x] agent-browser verification: onboarding (incl. live adaptive placement, 378 states lit) → start session → 3 turns with real grok-4.7 → LTR-in-RTL renders without breakage; zero console errors
- [x] Placement wired into onboarding (M1 gap work): `POST /api/placement` stateless ladder, server-side grading, `assumed_known` upserts + cefrComputed

## M6 — Tree view (simple SVG) ✅ (2026-10-30)
- [x] Deterministic layered layout from prerequisites; `NodePosition` persistence (two renders → identical positions)
- [x] Node card: title, gloss, 4-skill rings (listening/speaking "—"), state colors + dashed ring for fading (non-color cue), "why?" tooltip, pin/hide
- [x] agent-browser: ≥30 nodes readable at 1280px; planted seed appears at stable position

## M7 — Growth engine live + seed inbox ✅ (2026-10-30)
- [x] repeated_error trigger wired to real evidence; proposals with score breakdown + `reasonFa`
- [x] Inbox UI: approve/reject + celebration on plant; weekly cap enforced (4th held in queue)
- [x] Reject → 14-day cooldown on same node
- [x] Unit + agent-browser tests per docs/05 M7

## M8 — Delayed tests, mastery & session summary ✅ (2026-10-30)
- [x] Confirmatory session mode: samples ≤2 eligible nodes, 3 fresh contexts each, no hints, no warm-up
- [x] Pass → mastered; fail → Again + 7d retry; double-fail post-mastery → revoked
- [x] Session summary (reinforced/seeds/fading/delay results/tomorrow) rendered at session end
- [x] Planner mix 40:25:20:15 + probes p=0.3
- [x] **E2E: full MVP loop (chat → evidence → tree update → next brief reflects it → delayed test → mastery) — the success criterion**

## M9 — Metrics, guardrails, cost caps, polish ✅ (2026-10-30)
- [x] MetricEvent emission at all documented points; metrics test (metrics.test.ts: session_start/end, evidence_created/applied/disputed, seed_proposed/approved, llm_call ledger)
- [x] Daily LLM token budget with friendly cap message (`KIARA_DAILY_TOKEN_BUDGET`, default 150k; over-cap turn → warm Persian notice, zero LLM calls; tree/pipeline keep working)
- [x] Content-safety hardening (deterministic screen + safe-redirect turn path + hardened tutor prompt); settings page (correction style, level, goal, minutes, consent, JSON export, cascade delete verified to zero rows)
- [x] Empty/error/loading states; README run instructions accurate (demo user/tree/seeds, live smoke, budget env)
- [x] Final agent-browser golden-path pass (landing→auth→home→settings save/export/delete-dialog); package renamed to `kiara`

## Post-MVP queue (NOT scheduled — do not start without user)
voice (listening/speaking) → interests & content import → language-pack framework →
Postgres migration → per-user FSRS optimization → A/B infra → social/leagues
