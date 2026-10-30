# ۰۳ — موتور وضعیت و موتور رشد | State & Growth Engines

> **خلاصه اجرایی (فارسی):** موتور وضعیت سه مرحله دارد: (۱) **تجمیع** — همه‌ی شواهد یک (گره×مهارت) در یک جلسه با وزن confidence به یک عدد −۱ تا +۱ تبدیل می‌شود؛ (۲) **نگاشت به رتبه‌ی FSRS** — نتیجه‌ی تجمیع + شمار خطاهای مستقل در جلسات مختلف، یکی از Again/Hard/Good/Easy را تعیین می‌کند. قانون کلیدی: **یک خطا فقط مشاهده است**؛ فقط بعد از ≥۲ خطای مستقل در جلسات مختلف (gap) رتبه Again می‌آید و تا آن موقع حداکثر Hard است (تنزل فوری ممنوع)؛ (۳) **به‌روزرسانی قطعی FSRS + وضعیت نمایشی**. تسلط فقط با تست تأخیری (≥۲ از ۳ بافت متفاوت، بدون کمک، ≥۳ روز بعد از آخرین تمرین) رخ می‌دهد و با ۲ شکست بعدی قابل بازگشت است. محو شدن = R<0.75 یا دیرکرد بیش از ۲ برابر فاصله‌ی زمان‌بندی‌شده. موتور رشد خط لوله‌ی «تریگر ← بذر ← امتیاز ← سقف ← تأیید ← کاشت ← هرس» را با امتیاز = ارتباط هدف × فرکانس × آمادگی × تازگی اجرا می‌کند. همه‌ی اعداد این سند از اجرای واقعی `ts-fsrs v6` با `request_retention=0.85` استخراج شده‌اند (`bun scripts/fsrs-probe.ts`).

---

# Part A — State Engine

## A1. Evidence → session aggregate (per `userId × nodeId × skill × sessionId`)

```
value(outcome):  correct=+1   used_with_hint=+0.5   slip_self_corrected=+0.6
                 avoided=0    unknown=excluded      error=−1

w_i  = confidence_i            (disputed items excluded beforehand)
agg  = Σ(w_i · value_i) / Σ(w_i)          ∈ [−1, +1]
```

Edge rules:
- `hint_used` caps the item's contribution at `+0.5` even if `correct`.
- If Σw < **0.5** (not enough trustworthy signal) → **no FSRS update at all** this session (log only).
- `propagated` evidence (A4) joins the same aggregate with its own low weight.

## A2. Aggregate → FSRS rating

Inputs: `agg`, `errorObservations` = count of independent error items (confidence ≥ 0.6, non-disputed) for this (node,skill) **across distinct sessions so far**, `firstExposure` (reps == 0).

```
if firstExposure:
    agg ≥  0.5 → Good        (Easy never given on first exposure — no basis)
    0.2  ≤ agg < 0.5  → Hard
    agg  < 0.2        → Again  (first exposure failed hard: it enters learning as relearn)
else:
    agg ≥ 0.85 AND no errors AND no hints AND ≥2 confident positive items:
        → Easy if reps ≥ 3 else Good     # a single correct is never proof of "easy"
    0.5  ≤ agg < 0.85  → Good
    0.2  ≤ agg < 0.5   → Hard
    agg  < 0.2:
        errorObservations ≥ 2 (across ≥2 sessions) → Again   # GAP confirmed
        else → Hard                                           # single error = observation
```

**"≥2–3 independent observations" made precise:** `errorObservations` counts **sessions with ≥1 confident error**, not raw error items (3 typos of the same word in one session = 1 observation). Gap threshold = **2 sessions** (config `GAP_SESSION_THRESHOLD`, default 2, raise to 3 for error_pattern nodes).

## A3. FSRS update (ts-fsrs v6, deterministic)

- Global parameters, `request_retention = 0.85` (aligns scheduler with the 85% desirable-difficulty target).
- One `repeat(card, now, rating)` call per aggregated review; the new card fields are written back to `UserNodeState`.
- `due < now` at session start → node is a "due review" for the planner.

### Numeric example — node `en:chunk:could-you`, skill `writing` (REAL ts-fsrs v6 output)

| Session | Evidence (aggregated) | Rating | S (d) | D | FSRS state | next due |
|---|---|---|---|---|---|---|
| S1 d0 | 2× correct (c .90/.85) → agg 1.00, first exposure | **Good** | 2.31 | 2.12 | Learning | +10 min |
| S2 d2 | 1× correct (c .95) → agg 1.00 | **Good** | 10.96 | 2.11 | Review | +11 d |
| S3 d6 | 1× error (c .95) → agg −0.95, errorObs=1 (<2) → **no demotion** | **Hard** | 20.51 | 4.75 | Review | +21 d |
| S4 d13 | 2× error (c .90/.85) → agg −1.00, errorObs=3 across 4 sessions → **gap** | **Again** | 1.80 | 8.26 | Relearning, lapses=1 | +10 min |
| S5 d14 | 1× correct (c .90) | **Good** | 3.34 | 8.25 | Review | +3 d |
| S6 d20 | correct | Good | 8.67 | 8.23 | Review | +9 d |
| S7 d31 | correct | Good | 19.31 | 8.22 | Review | +19 d |
| S8 d50 | correct | Good | 36.77 | 8.21 | Review | +37 d |

Read this table twice — it is the whole philosophy in numbers:
- The single error at S3 **raised** stability (20.51) while only nudging difficulty (2.11→4.75): an error is information, not punishment.
- The confirmed gap at S4 collapsed S to 1.80 and jumped D to 8.26 — the tree visibly "dims" that node (see A5).
- Eight reviews over 50 days → S=36.77 ≫ 21d mastery bar, earned back after the lapse.

First-exposure anchors (same library, for reference): Again S=0.21/D=6.41 · Hard S=1.29/D=5.11 · Good S=2.31/D=2.12 · Easy S=8.30/D=1.00.

## A4. Propagation (mastery spread & root-cause attribution)

**Downward (prerequisite boost).** When node X gets an aggregated **Good/Easy** with `agg ≥ 0.8` and all evidence confidence ≥ 0.8:
```
for each prerequisite P of X (edges type=prerequisite, direction P→X):
    if P.skill state is fading or learning:
        emit Evidence(P, skill, outcome=correct, confidence = 0.8 × 0.35, propagated=true)
```
One aggregated positive at X can therefore shift a prerequisite's session aggregate by at most `0.28·w/Σw` — enough to rescue a fading node (Hard instead of Again), never enough to master anything. Propagation is logged (`propagated=true`) and reversible: a later explicit failure of P simply dominates (its weight is 1).

**Upward (root-cause re-attribution).** When node X hits a confirmed gap (A2 Again via errorObservations ≥ 2) **and** X has a prerequisite P with `strength < 0.35`:
```
route the gap's next error evidence to P as well (confidence × 0.7, l1_interference preserved)
→ the review burden moves to the actual rot, X gets a Hard (not Again) until P recovers
```
Max one re-attributed prerequisite per gap; choose the weakest by strength; log both routes.

## A5. Display states (derived, recomputed on every state write & read)

```
locked        no UserNodeState, and prerequisites not satisfied
available     frontier: prerequisites satisfied (or none), reps == 0, not planted-interest
learning      reps ≥ 1, not mastered
assumed_known placed by placement test (C1); counts for readiness/i+1, NOT mastery
mastered      masteredAt set (A6) and not since revoked
fading        (learning|mastered) and (R < 0.75 or overdue > 2 × scheduled interval)
```

`R` = ts-fsrs `retrievability(card, now)`. With `request_retention=0.85` a healthy card stays above 0.85 until due; **R-based fading is the slow channel** (measured on the S=10.96 card: R=0.882 at +14d, 0.780 at +45d, 0.684 at +120d → crosses 0.75 only after ~3 months of silence) while **the overdue rule is the fast channel that actually fires on missed reviews** (young S=2.31 card: R=0.808 at +7d, 0.742 at +14d, but overdue-fading already at +7d since 6d late > 2× its 1d interval). Overdue rule: `now − due > 2 × (due − lastReviewAt)` (and > 3 days) → fading regardless of R.

## A6. Mastery — delayed test only

Eligibility (engine sets `pendingDelayTest=true`, `delayTestEligibleAt = lastReviewAt + 3d`):
```
reps ≥ 4  AND  stability ≥ 21d  AND  no unresolved gap  AND  not hint-assisted in last 2 sessions
```
Confirmatory session (type `confirmatory`):
- Samples up to 2 eligible nodes (planner, `p≈0.3` per session).
- Per node: 3 fresh contexts (from a different scenario family than practice), no hints, no prior in-session practice of that node, no announcement of which node is tested.
- Pass: ≥ 2/3 items correct with confidence ≥ 0.8 → `mastered`, `masteredAt=now`.
- Fail: rating **Again** recorded; back to `learning`; re-eligible after 7d.
- **Revocation:** a mastered node that fails 2 subsequent delayed probes → `learning` (mastery is a distribution, not a certificate).

## A7. Session aggregation pipeline (end of chat session)

```
on session end:
  evs = load Evidence(sessionId, disputed=false)
  group by (nodeId, skill)
  for each group:
      agg, errorObs = aggregate(evs)                      # A1, A2
      grade          = toRating(agg, errorObs, state)     # A2
      card           = fsrs.repeat(state.card, now, grade)# A3
      persist card; lastAppliedEvidenceId = max(evid)     # idempotency
      recompute displayState                              # A5
      emit metric evidence_applied
  growthEngine.scan(user, session)                        # Part B
  brief version bumped for next session
```

# Part B — Growth Engine

## B1. Pipeline

```
trigger → seed → score → cap → USER APPROVAL → plant → prune/merge
```

## B2. Triggers (MVP: `repeated_error` only; others behind flags)

`repeated_error`: after each session, group non-disputed error evidence by `(nodeId, errorType)`:
```
candidate if:
    errorSessions ≥ 2 (distinct sessions, confidence ≥ 0.6)
 AND (node has no active UserNodeState          # word/grammar never planted
      OR an error_pattern node for this signature does not exist for the user)
```
Two seed kinds:
- **(a) plant-an-existing-node**: e.g. `en:word:whose` keeps being misused → propose planting it (adds to frontier with a targeted exercise focus).
- **(b) track-the-pattern**: propose creating/linking an `error_pattern` node (global if it's a known fa→en transfer, e.g. `en:err:l1-3rd-singular-s`, else user-generated).

## B3. Scoring (deterministic, all factors in [0,1])

```
score = goalRelevance × frequency × readiness × novelty

goalRelevance: 1.0 if node.tags ∩ goalTags ≠ ∅   (map: work→[business,formal,meeting...],
               travel→[travel,airport,food...], exam→[academic...]); default 0.6; error_pattern→0.9 (always relevant)
frequency:     rank ≤ 1k → 1.0 · ≤5k → 0.8 · ≤20k → 0.6 · else 0.4   (error_pattern: 0.8 flat)
readiness:     fraction of prerequisite nodes in {available, learning, mastered, assumed_known}
               (no prereqs → 1.0)
novelty:       0 if user already has an active state for the node; else 1.0
```
Proposal threshold: `score ≥ 0.45`. `reasonFa` is assembled from the parts ("۳ خطای مستقل در «whose» + مربوط به هدف سفر + آماده (پیش‌نیازها روشن)").

**Numeric example (real numbers from the seeded graph):**

| Candidate | goal | freq | readiness | novelty | score | verdict |
|---|---|---|---|---|---|---|
| `en:word:recommend` (rank 1987, goal=work, prereqs ok, not planted) | 1.0 | 0.8 | 1.0 | 1.0 | **0.80** | propose |
| `en:word:itinerary` (rank 24k, tags=travel, goal=work → no match) | 0.6 | 0.4 | 1.0 | 1.0 | 0.24 | below bar |
| `en:err:l1-3rd-s` (error pattern, 2 sessions) | 0.9 | 0.8 | 1.0 | 1.0 | **0.72** | propose |
| `en:word:whose` already planted last week | 1.0 | 0.8 | 1.0 | 0.0 | 0.00 | skip (novelty) |

## B4. Cap

`planted` seeds in the trailing 7-day window ≤ **3** (config `WEEKLY_SEED_CAP`). Over-cap proposals stay `proposed` in a ranked queue and expire after 14 days (`expired`). The cap counts only **approved+planted**, never rejections — punishing rejections would train the user to ignore the inbox.

## B5. Approval & planting

Approval is a single tap in the seed inbox; it shows the full breakdown above. On approve:
1. If `candidateNodeId`: create `UserNodeState` (reading+writing) with `displayState=available`; assign a `NodePosition` (tier = 1 + max(prereq tiers), x = next free slot).
2. If `candidatePayload`: create the `GraphNode` (`isUserGenerated=true, ownerId`) then as above.
3. Celebrate (UI): planting a branch is the streak-positive moment, never a chore.

## B6. Prune / merge (tree hygiene)

- **Collapse:** all tracked skills `mastered` for 30+ days → node visually collapses into its `part_of` cluster parent (still reviewable; just not rendered as an open branch).
- **Merge:** user-generated node with same normalized key as a global node → mark `merged`, alias to global, copy states.
- Weekly job (post-MVP) proposes merges; MVP implements collapse only.

# Part C — Session Brief & Planner (supporting)

- **Brief** (contract in `02 §3.2`): built fresh per session from state; ≤ ~1.5k tokens; contains lexicon-band counts + sample lemmas (not the whole vocabulary), 2–3 weak/fading, 2–3 frontier, active error patterns, scenario with `mustElicit` targets.
- **Planner mix** (interleaving, per "شروع جلسه"): due reviews : new frontier : remedial (nodes with open gaps) : interest-flavored ≈ **40 : 25 : 20 : 15**, clamped to `dailyMinutes`. Delayed-test probes ride along (A6) with p≈0.3.
- **i+1 check** (post-tutor-turn): tokenize response, lemmatize against graph word list, unknown content-word rate ≤ **10%** (proper nouns/numbers/cognates/function words exempt) → else one rewrite pass with the unknown list fed back.

# Part D — Purity & testability

Every function in `src/lib/engine/**` is pure (data in → data out; no DB, no LLM, no clock — `now` is injected). All constants live in `src/lib/engine/config.ts` (single source, documented, overridable by env for experiments). The engines are validated by `tests/engine/*.test.ts` using the exact numeric tables above as fixtures — the S1–S8 lifecycle, propagation bounds, gap confirmation, mastery gating/revocation, fading thresholds, seed scoring, and the weekly cap.
