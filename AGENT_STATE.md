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
| Current milestone | **M0 ✅ + M1 ✅ + M2 ✅ + M3 ✅ + M4 ✅ + M5 ✅ + M6 ✅ DONE → next: M7** |
| Tests | 182/182 green + 1 env-gated skip (`bun run test`; live smoke needs `KIARA_LIVE_SMOKE=1`) |
| Lint | clean (`bun run lint`) |
| DB | SQLite at `db/custom.db`, schema pushed (NodePosition += pinned/hidden in M6), 268 graph nodes + 205 edges seeded; demo user has a seeded tree (114 states: learning/fading/mastered/assumed_known via `scripts/seed-demo-tree.ts`); M5 user `sara-m5@test.local` has placement states (B1, 378 assumed_known) |
| Dev server | auto-runs on :3000 (restart path after schema pushes: `setsid bash .zscripts/dev.sh … & disown` — see Known issues) |

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

## Current state of the code (M0–M6 delivered)

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
  + **M4**: `tests/llm/analyst-validate.test.ts` (10: schema/clamp/hallucination/fences/repair) ·
  `tests/llm/analyst-golden.test.ts` (4: ≥20 turns, ids real, accuracy ≥85% = 100%) ·
  `tests/db/session-pipeline.test.ts` (6: S1–S8 through the REAL DB incl. disputed-exclusion,
  propagation boost, root-cause routing, flight seed proposal + dedupe, summary shape) ·
  `tests/api/evidence-dispute.test.ts` (4: flag+reason, append-only, exclusion → no state,
  undisputed control) · `tests/api/session-end.test.ts` (6: guards, summary persistence,
  409 idempotency, per-turn evidence wiring, analyst_parse_fail metric) ·
  `tests/engine/growth.test.ts` (+1 BUGFIX regression: track_pattern novelty).
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
- `src/lib/llm/analyst.ts` — **M4**: docs/04 §2 analyst prompt VERBATIM + few-shot;
  zod schema (confidence CLAMPED not rejected); `validateAnalystOutput` = parse → zod →
  node whitelist (hallucinated id → item dropped, last id segment feeds new_unknown_words)
  → skill whitelist → clamp; `analyzeTurn` = ONE repair retry (validation error appended,
  docs/04 §3) then give-up with `ok:false` (chat never blocked); markdown fences stripped.
- `src/lib/evidence/writer.ts` — **M4**: `writeTurnEvidence` (append-only, idempotent per
  (sessionId, turnId), persists `disputed` when present) · `writeEngineEvidence`
  (propagation/root-cause rows, `turnId='engine'`, NO per-turn guard — the session status
  guard already makes the run once-only) · `disputeEvidence` (flag-only, never delete).
- `src/lib/session/pipeline.ts` — **M4**: `endSession` = docs/03 §A7 exactly:
  pass A propagation emits (pre-update states) → persisted via writeEngineEvidence → merged
  into groups → pass B per-group aggregate (ENGINE aggregateSession) → rating → FSRS →
  persist → metrics; pass C root-cause re-attribution for confirmed gaps (routed error
  becomes real evidence + applied to the weak prereq immediately); pass D growth scan
  (`scanRepeatedErrors` + `buildSeedDraft`, dedupe by candidateNodeId / payload title /
  triggerRef dedupeKey) → Seed rows; summary (reinforced/fading/delayTestResults/seeds/
  tomorrow) stored on ChatSession + status ended (409 on second call).
- API routes (M4, all live-verified): `POST /api/session/end` (401/400/404/409) ·
  `POST /api/evidence/[id]/dispute` (owner-checked, 200/404/401, append-only flag).
- Per-turn analyst wired into `runTutorTurn`: runs IN PARALLEL with the tutor call (needs
  only the learner message + previous tutor context → zero added latency); whitelist =
  user's touched nodes + session targets; failure → `analyst_parse_fail` metric only.
- `data/analyst-golden.json` — **M4**: 22 labeled turns (docs/04 examples + L1 patterns +
  hallucinated-id + fenced-output cases), all ids verified against the graph.
- Live-verified M4 loop (real grok-4.20 analyst): learner message → evidence rows →
  `POST /api/session/end` → FSRS state rows + summary + metrics in one shot (200, 210ms).
- `src/lib/client/api.ts` — **M5**: typed fetch client for every endpoint (PublicUser, brief,
  turn meta, session-end summary, placement); `ApiError` carries the server's `errorFa`.
- `src/stores/app-store.ts` — **M5**: zustand store = single source of truth for client-side
  view switching on `/` (landing | auth | onboarding | home | chat) + chat session state
  (messages, typing, status, summary). Exposes `window.__kiaraStore` for browser-test driving.
- `src/lib/client/format.ts` — **M5**: pure UI formatters (faDigits, formatDuration mm:ss,
  formatUnknownRate ≥1% else null, wordQuestionTemplate) — unit-tested (tests/ui/format.test.ts).
- `src/app/api/placement/route.ts` — **M5**: stateless adaptive ladder. Client sends
  `{ selfBand, answers[{nodeId, optionIndex}], finish? }`; server rebuilds the SAME quiz
  (seed=hash(userId)), grades where correctIndex lives, reruns ladder (needs `currentBand`
  — added to `PlacementLadderResult`, engine-tested) and returns the next item WITHOUT
  correctIndex. `finish:true` → applyPlacement upserts (update:{} — never overwrites
  practiced state) + cefrComputed + `placement_applied` metric. 401-guarded.
- `src/components/app/` — **M5** the single-route shell:
  `app-root.tsx` (boot `/api/auth/me` once → landingViewFor) · `landing-view.tsx` (old page
  content, CTA wired) · `auth-view.tsx` (login/register tabs, LTR credential inputs) ·
  `onboarding-view.tsx` (profile → prefs → timestamped consent → LIVE adaptive placement
  ladder → done screen with finalBand + litCount) · `home-view.tsx` (start-chat card +
  honest M6/M7/M9 placeholders + logout) · `chat-view.tsx` (start card, scenario header,
  timer badge Persian digits, tutor/user bubbles `dir="ltr"` inside RTL with logical
  corner radii, ✏️ unknown-word chips → composer template tap-fill, subtle unknown-rate
  hint, rewritten/fallback meta notes, typing indicator, AlertDialog end-session →
  compact summary card).
- **M5 agent-browser-verified live** (user sara-m5@test.local): register → onboarding
  (placement ladder 12/12, A2→B1, 378 states lit, never mastered, pendingDelayTest=true) →
  home → chat start → 3 real grok-4.7 turns (one degraded to fallback — graceful) →
  end-session summary. LTR-in-RTL renders without breakage (desktop 1280px + mobile 390px).
  Zero console errors; all API calls 2xx. Keyboard: native tab order, Enter=send,
  Shift+Enter newline, Radix dialog focus trap, chips tap-fill composer (verified via
  `__kiaraStore` injection). Contrast: `--muted-foreground` darkened 0.556→0.44 (≈7.8:1).

- `src/lib/engine/tree-layout.ts` — **M6**: PURE deterministic layered layout.
  `buildLayoutTiers` = longest prerequisite depth, raised to `cluster tier + 1` for `part_of`
  members (own DFS with cycle guard — do NOT pass a pre-seeded memo into `nodeTier`, it
  short-circuits). `computeTreeLayout` = saved positions pass through UNTOUCHED; fresh nodes
  placed per tier at the NEXT FREE SLOT (docs/03 §B5), ordered by (cluster, typeGroup,
  frequencyRank, id); x always integer slot × TREE_GAP_X, y = tier × TREE_TIER_GAP_Y — both
  exactly recoverable from a saved row. `plantTierFor` = 1 + max(prereq tiers) for M7 planting.
  Config: TREE_NODE_W 132 · TREE_NODE_H 76 · TREE_GAP_X 148 · TREE_TIER_GAP_Y 130.
- `src/lib/tree/tree-service.ts` — **M6** wiring layer: `getTreeView(userId, now)` merges
  world graph (files) ∪ user-generated nodes (DB) + states + saved positions → layout →
  persists only `newIds` (createMany, P2002-tolerant) → recomputes display state ON READ
  (`computeDisplayState`) → node state = strongest across skills with priority
  fading > learning > mastered > assumed_known > available > locked → evidence aggregates
  (last 2000 non-disputed rows: lastOutcome + confident errors/30d) → Persian `why` per node
  (`buildWhy`: locked names blocking prereq titles, fading/learning cite evidence) →
  prerequisite-only edge list + stats + bounds. `setTreeNodeFlags` = pin/hide on the
  NodePosition row (creates the row with a deterministic position when missing).
- API routes (M6, live-verified on :3000): `GET /api/tree` (requireUser; first call lays out
  and persists ALL positions, later calls keep them — the semi-fixed contract) ·
  `PATCH /api/tree/[nodeId]` (zod pinned/hidden, 401/400/404; returns `{ ok, id, pinned,
  hidden }` — the client expects `id`, keep them in sync).
- `src/components/app/tree-view.tsx` — **M6** the tree view (client-side `tree` view in the
  `/` shell): SVG canvas `absolute inset-0` (h-full on a flex child collapses to the 150px
  SVG default — do not regress), pointer-drag pan, zoom buttons 0.45–2.5 (default 0.72),
  «نمایش ناحیه‌ی من» recenter on the user's lit region, state colors + DOUBLE dashed ring for
  fading (non-color cue), 4 skill mini-rings (stroke-dasharray = strength; listening/speaking
  render "—"), pinned = green border + 📌 badge, selected-node panel = the "why?" tooltip with
  pin/hide actions, legend, Esc/keyboard support (`role=button` nodes). Home view's tree card
  is live; M7/M9 cards remain placeholders.
- **M6 agent-browser-verified live** (demo user, 114 states): 268 nodes render; 32 readable
  at 1280px after one zoom-out (26 at default 0.72); positions identical across reload
  (268/268 within ±1px); pin persists across reload; fading card shows dashed rings + why;
  zero console errors. `scripts/seed-demo-tree.ts` seeds the demo user's spread
  (learning/fading/mastered/assumed_known).
- `tests/engine/tree-layout.test.ts` (11: tier math, two-render identity, exact preservation
  + next-free-slot, collision-freedom, stale rows, cluster-hug ordering, plantTierFor) ·
  `tests/api/tree.test.ts` (7: 401 guards, persist-then-identical GETs + availability wiring
  (fresh user MUST see >50 `available`), per-skill payload + read-time fading, locked-why,
  planted user-generated node lands at stable tier prereq+1 and never moves others, pin/hide
  persistence, 400/404). NodePosition rows are DERIVED data — wiping them is safe
  (deterministic re-layout on next GET); positions of real users must never move though.

## Known issues / gotchas

- **M6 — stale Prisma client after `prisma db push`**: a RUNNING dev server keeps the old
  generated client in its require cache → new schema fields (e.g. NodePosition.pinned)
  cause `Unknown argument` 500s even though tests (fresh processes) pass. Fix: restart the
  dev server via `setsid bash .zscripts/dev.sh > /tmp/devsh.log 2>&1 < /dev/null & disown`
  (the harness's own entry: bun install → db:push → bun run dev → disown). Plain `nohup bun
  run dev &` does NOT survive between tool calls. Check `dev.log` + `curl :3000` after.
- **M6 — SVG height trap**: `h-full` on an `<svg>` inside a flex-grown div resolves to the
  150px replaced-element default (percentage against an indefinite height). The tree canvas
  svg must stay `absolute inset-0` inside the `relative overflow-hidden` canvas div.
- **M6 — panel vs. canvas pointer handlers**: the panel lives inside the pointer-drag
  container; `onPointerDown` must ignore events from `[data-testid=node-panel]` and
  background-deselect must be skipped when the press started on a node — otherwise panel
  buttons unmount before their onClick fires.
- **M6 — node ids contain colons** (`en:word:flight`) — never `split(':')` on composite
  "id:value" fingerprints; use `lastIndexOf(':')`.
- **M6 — availability map key**: `computeAvailability` returns `{ node: EngineNode, ... }`
  — the per-id map must key on `a.node.id` (TS won't catch `a.nodeId` under esbuild/vitest,
  which strip types without checking).

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
- **RESOLVED (M5) — empty known lexicon for fresh users**: placement is now wired into the
  onboarding wizard (`POST /api/placement` + `applyPlacement` upserts). A user finishing the
  ladder gets assumed_known states immediately, so i+1 no longer treats everything as unknown.
  Users who skip/finish with null finalBand still light nothing (data-honest, C2a).
- **M5 BUGFIX — session-end `applied` shape**: the §A7 pipeline returns `applied: AppliedGroup[]`
  (per-group FSRS applications), not a count. The first ChatView wiring rendered an empty
  number; fixed to `r.applied.length` + corrected `SessionEndResponse` type (rootCaused is
  `string[]` too). Keep client types in sync with pipeline returns.
- **agent-browser gotcha**: Persian labels contain ZWNJ (‌) — `find text "ثبتنام"` fails;
  snapshot refs (`@eN`) or `eval` selectors are the reliable way to click Persian UI.
- **BUGFIX (M4) — track_pattern scoring**: `scoreCandidate` scored the error SOURCE node with
  novelty=0 (it always has a state), so error-pattern seed proposals could never reach the
  0.45 bar — contradicted docs/03 §B3's own example (0.72). Fixed: track_pattern candidates
  use ERROR_PATTERN_RELEVANCE/FREQUENCY and novelty=1 (the pattern node is new). Regression
  test added (`tests/engine/growth.test.ts`).
- **Semantics decision (M4)** — "active UserNodeState" for the growth trigger (docs/03 §B2):
  = planted-but-unpracticed (available/assumed_known) OR strength > 0. States created purely
  by error evidence (reps ≥ 1, strength 0) are error-tracking, NOT adoption — otherwise
  plant_existing could never fire (any analyzed error auto-creates a state).
- **BUGFIX (M4) — engine-generated evidence persistence**: propagation emits were merged
  into aggregates but never written to Evidence; `writeEngineEvidence` now appends them
  (turnId='engine', propagated=true) OUTSIDE the per-turn idempotency guard (which would
  wrongly block the second engine batch of the same run).
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
