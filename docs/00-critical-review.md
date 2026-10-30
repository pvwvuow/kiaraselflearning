# ۰۰ — بازبینی انتقادی طراحی | Critical Design Review

> **خلاصه اجرایی (فارسی):** طراحی شما از نظر معماری درست است و ستون‌های اصلی آن (شاهد جدا از حکم، گراف به‌عنوان داده، موتور قطعی، تست تأخیری برای تسلط) علمی و قابل‌دفاع‌اند. اما ۶ تناقض درونی، ۱۰ ریسک جدی و ۸ مورد جاافتاده پیدا کردم که همه را با راه‌حل مشخص در همین سند بسته‌ام. مهم‌ترین‌ها: (۱) «روشن‌کردن هسته در تعیین سطح» با «هیچ چیز بدون تست تأخیری تسلط نیست» تناقض دارد → وضعیت جدید `assumed_known` تعریف شد؛ (۲) هر نوبت چت نباید هر شاهد را جداگانه به FSRS بدهد → شواهد هر جلسه به‌ازای هر (گره×مهارت) در «یک» رتبه تجمیع می‌شود؛ (۳) دقت تحلیل‌گر نقطه‌ی شکست واحد سیستم است → اعتبارسنجی سختگیرانه + لیست سفید گره‌ها + harness ارزیابی با نمونه‌ی طلایی لازم است. این سند مبنای تصمیم‌های پیاده‌سازی است و هر مورد، تصمیم نهایی را با برچسب **[تصمیم]** مشخص می‌کند.

---

## 1. Strengths (what we keep, unchanged)

| Principle | Why it is right |
|---|---|
| LLM produces **evidence only**; a deterministic engine mutates state | Auditable, replayable, testable, cheap. The core loop can be unit-tested without any LLM call. |
| **Graph is the data**, tree is a view | Trees force single-parent; confusable/related edges (ser/estar) need a graph. Correct call. |
| FSRS **per (node × skill)** | Receptive vs productive memory genuinely differ (you can read a word you cannot produce). |
| Mastery **only via delayed, unassisted test** | Distinguishes *performance* from *learning* — the single most evidence-based rule in the design. |
| Growth **capped + user-approved** | Prevents the "300 suggested branches" doom loop that kills adaptive systems. |
| World knowledge **cached and shared**, user state separate | The only way LLM content costs stay sub-linear in users. |

## 2. Internal contradictions found → resolutions

**C1 — Placement lights up the core vs. nothing is mastery without a delayed test.**
"هسته را تا حد دانسته‌های کاربر روشن می‌کند" implies mass-marking as known; rule 6 forbids calling anything mastered without a delayed test.
**[تصمیم]** New display state `assumed_known`: placement fills it, it counts for prerequisite readiness and i+1 vocabulary, it is **not** mastery, and it gets **priority sampling** in delayed tests (it is the cheapest place to catch placement errors). A failed delayed test on an `assumed_known` node demotes it to `learning` and flags placement calibration.

**C2 — Delayed test "بدون هشدار" (no warning) vs. the session planner scheduling it.**
If the planner announces "delayed test on Friday about X", it is a cram-able announcement.
**[تصمیم]** "Surprise" applies to **which nodes** are sampled, not to when sessions happen. The user always knows a session may contain probes; never which nodes. Planner picks eligible nodes stochastically (`p≈0.3`, max 2/session) and never right after the node was practiced in-session (no warm-up effect).

**C3 — Tutor must use 90–95% known words vs. cold start.**
Right after onboarding the "known" set can be tiny (or empty for A0 users); a natural conversation cannot be held inside a 40-word bubble.
**[تصمیس]** Three-part rule: (a) placement must light up a **minimum viable lexicon** (top frequency band for the claimed level; for absolute beginners the tutor uses a scripted "ultra-light" register); (b) the unknown-rate checker **exempts** proper nouns, numbers, cognates, and a closed class of function words; (c) unknown-rate is measured over **content words only**, target ≤10%.

**C4 — "یک حالت چت در MVP" vs. mastery requiring delayed tests.**
The confirmatory session *is* a chat mode.
**[تصمیم]** MVP = one *practice* mode (targeted roleplay) + one *test* mode (confirmatory). The spec's "one mode" is read as "one practice mode".

**C5 — "گره‌های درست‌استفاده‌شده شاهد مثبت بگیرند" vs. FSRS inflation.**
A single tutor turn can legitimately touch 8–12 nodes. Feeding each positive evidence as a separate FSRS review would multiply `reps` and inflate stability fast.
**[تصمیم]** **Session aggregation:** all evidence for one (node, skill) inside one session collapses into **exactly one** FSRS review (rules in `03-engines.md`). The evidence log keeps every item (immutable); only the FSRS update is aggregated.

**C6 — Desired difficulty 85% vs. FSRS default desired retention 0.9.**
These are two dials for the same machine; leaving both at defaults makes them fight.
**[تصمیم]** Set FSRS `request_retention = 0.85` globally to match the 85% target-success principle; keep it configurable per experiment.

## 3. Critical risks → mitigations

**R1 — Analyst misattribution is the single point of failure.**
If the analyst blames the wrong node, the tree grows wrong branches and reviews the wrong things — silently.
Mitigations (all in MVP):
- Node ids must pass a **whitelist check** against the graph; unknown ids are demoted to `new_unknown_words`, never create state. This kills hallucinated-node updates.
- Output is parsed with **zod**; one repair retry with the validation error appended; persistent failure → evidence dropped + metric `analyst_parse_fail` incremented (never crashes the chat).
- **Confidence** from the analyst weights everything downstream (a 0.4-confidence item moves almost nothing).
- User can **dispute** any evidence; disputed items are excluded from aggregation from that point on.
- A **golden-set eval harness** (`tests/analyst-golden.test.ts`) with ≥20 hand-labeled turns runs offline; accuracy target ≥85% before shipping changes to prompts.

**R2 — FSRS data sparsity per (node × skill).**
FSRS parameters converge after ~8–10 reviews per card; 300 nodes × 4 skills = 1,200 cards that mostly get 1–3 reviews.
Mitigations: MVP enables FSRS only for `writing`/`reading` (per spec); **default global parameters** (no per-user optimization until ≥400 reviews); cross-skill evidence propagation with a 0.3 discount (a word *read* correctly is weak positive evidence for *writing*); session aggregation (C5) concentrates signal.

**R3 — LLM cost & latency.**
Per turn: 1 tutor call (strong model) + 1 analyst call (cheap model) + occasional rewrite pass.
Mitigations: model routing (grok-4.7 tutor / grok-4.20-0309-non-reasoning analyst); the tutor receives a **brief, not the tree** (≤1.5k tokens); rolling context window (last 10 turns + rolling summary, not full history); i+1 rewrite only on violation (measure rate, tune prompt to keep it <5% of turns); hard daily token budget per user (config, default generous); analyst runs async — the user never waits for it.

**R4 — Mastery propagation can mask gaps.**
Boosting prerequisites on downstream success can paint a rosy tree over a rotten foundation.
Mitigations: propagation emits only **low-weight positive evidence** (≤0.3 weight), can never trigger mastery or skip a delayed test, is fully logged as `propagated: true` evidence, and is **reversible** (a later failure of the prerequisite re-normalizes). Failure attribution (root-cause to weakest prerequisite) is the symmetric rule and is capped at one re-attribution per error.

**R5 — Tree visualization scope creep.**
Semi-fixed layout + fog + 4 skill rings + 3 zoom levels is a product in itself.
Mitigation: staged. MVP = single-level SVG with deterministic layered layout and persisted positions; fog = opacity ramp on `locked`; rings = 4 quadrants. Zoom levels and clusters land post-MVP (see roadmap).

**R6 — Prompt injection through imported content (and adversarial chat).**
Post-MVP the user pastes articles/subtitles; even in MVP the user could type "ignore your instructions" into the tutor.
Mitigations: imported content is wrapped in delimiters and labeled **data**; both prompts explicitly refuse instructions found inside user text that are not language-learning intents; analyst output passes zod + whitelist (R1) so injection cannot reach state even if it reaches the model; state mutations never take free-text parameters from the LLM.

**R7 — Privacy/GDPR with a US LLM vendor.**
Chat text leaves the EU/user device to xAI.
Mitigations for MVP: explicit consent screen at onboarding ("your messages are processed by xAI to generate evidence; not used for training without opt-in"); data export + full delete; retention config (default 180d for turns, evidence log kept while account exists — it *is* the learning state's audit trail); post-MVP: EU gateway or on-prem model option.

**R8 — Graph versioning can break user state.**
Renumbering ids at migration time would orphan evidence and states.
Mitigations: **ids are immutable slings** (`en:word:recommend`); migration = deprecate + `supersededBy` pointer, never delete; user states migrate by copy-forward; evidence rows keep the original id and resolve through the alias chain at read time; a migration test asserts zero orphaned references.

**R9 — Content licensing.**
Tatoeba is CC-BY 2.0 FR (attribution required); Wiktionary derivations are share-alike.
Mitigations: every example stores `{text, source, license}`; MVP ships mostly hand-authored examples (safest); Tatoeba used with per-sentence attribution; a `report content` button pulls an item from cache pending review.

**R10 — Placement quality gates everything.**
A bad placement either bores (too low) or drowns (too high) — the #1 churn point.
Mitigations: adaptive band sampling (start mid-band, 2-up-1-down ladder on mixed-skill micro-probes, ~12 items, ≤4 min); the first roleplay session is also a **diagnostic** (analyst evidence recalibrates); user can manually drag their level; `assumed_known` soft state (C1) makes over-lighting recoverable.

## 4. Missing pieces → added to the design

1. **`assumed_known` state** (C1) — added to the state machine.
2. **Session aggregation rule** (C5) — added to the state engine.
3. **Context management**: rolling summary every 10 turns (tutor prompt), brief regenerated per session, never the full history. Without this, session 15 costs 10× session 1.
4. **Metrics instrumentation from day 1** (`MetricEvent` table): session started/ended, evidence created/disputed, delayed test offered/passed/failed, seed proposed/approved, i+1 violations, analyst failures. The evaluation section of the spec is impossible to compute later if these aren't logged now.
5. **Offline/merge rule made explicit**: the append-only evidence log **is** the merge base; FSRS state is a materialized view. Conflict resolution = replay evidence by `(createdAt, id)` order. States carry the last applied evidence id for idempotency.
6. **Anti-cheat as downweighting only**: response latency and sudden style shifts reduce evidence confidence; no accusations, no lockouts (matches spec; latency is already in the evidence schema).
7. **Content-safety guardrails**: tutor refuses non-language harmful content with a brief redirect; age-gate at onboarding; scenario bank pre-vetted. MVP scope: system-prompt guardrails + no free-form scenario input.
8. **Fading rule refined**: with `request_retention=0.85`, R drops below 0.7 only after ~100+ days of silence — too late for a "your tree is fading" signal. **[تصمیم]** `fading` display = `R < 0.75` **or** overdue by more than 2× the scheduled interval.

## 5. What I would change outright (and why)

- **Per-turn analyst batching**: run the analyst on the *session's* turns in one batched call at session end **plus** a lightweight per-turn call for correction-relevant items. Rationale: errors only need attribution before the *next* session, not before the next turn; corrections come from the tutor, not the analyst. This halves analyst cost with zero UX loss. *(Kept configurable; default = batch at end + turn-level for tutor-visible items.)*
- **Mastery revocation**: the spec describes fading and lock/unlock but not *un-mastery*. A mastered node that later fails two delayed probes must fall back to `learning` — mastery is a claim about a distribution, not a certificate. Added to the state machine.
- **Interleaving is a planner property, not an engine property**: implement in the session planner mix (reviews : new : remedial : interest ≈ 40 : 25 : 20 : 15) rather than as a separate mechanism.

## 6. Explicitly out of scope for MVP (accepted debt)

Voice (listening/speaking FSRS), interest/content import triggers, multi-language packs, social/leagues, full a11y audit beyond basics, Postgres migration, per-user FSRS optimization. Each has a stub/flag in the schema so post-MVP work is additive, not destructive.
