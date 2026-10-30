# ۰۲ — مدل داده | Data Model

> **خلاصه اجرایی (فارسی):** گراف جهانی در دو جدول `GraphNode` و `GraphEdge` ذخیره می‌شود (idهای پایدار مثل `en:word:recommend`، نسخه‌دار با `supersededBy` به‌جای حذف). وضعیت کاربر به‌ازای هر (گره×مهارت) در `UserNodeState` با فیلدهای FSRS است. شواهد در جدول **append-only** یعنی `Evidence` می‌روند (قابل رد توسط کاربر، هرگز حذف نمی‌شوند). بذرهای رشد در `Seed` با تفکیک امتیاز و وضعیت. جلسات و نوبت‌ها در `ChatSession`/`Turn`، برگه‌ی جلسه به‌صورت JSON snapshot داخل جلسه ذخیره می‌شود. چون SQLite enum ندارد، همه‌ی enumها String + union type در TS + اعتبارسنجی zod هستند. قانون طلایی: **هیچ جدول وضعیتی هیچ‌وقت از LLM مستقیم نوشته نمی‌شود؛ فقط موتور قطعی از روی Evidence می‌نویسد.**

---

## 1. Entity map

```
GraphNode ── GraphEdge ──▶ GraphNode          (world graph, versioned, per language)
    ▲
    │ (nodeId)
UserNodeState  (userId, nodeId, skill)        (FSRS per node × skill + display state)
    ▲
    │ applied from
Evidence  (append-only, disputable)           (the ONLY bridge from LLM to state)
    ▲
    │ produced by analyst from
Turn (sessionId, role, content)               ChatSession (brief snapshot, summary)
Seed  (growth pipeline: proposed → approved → planted)   NodePosition (semi-fixed layout)
User / Session(auth) / MetricEvent             NodeContentCache (exercises, post-MVP)
```

## 2. Prisma schema (implemented in `prisma/schema.prisma`)

> SQLite: no native enums → `String` columns + TS unions + zod. All datetimes UTC.

```prisma
model User {
  id              String   @id @default(cuid())
  email           String   @unique
  passwordHash    String
  displayName     String?
  l1              String   @default("fa")
  targetLang      String   @default("en")
  cefrSelf        String?                    // A1..C2 from onboarding
  cefrComputed    String?                    // engine-computed, overrides self over time
  goal            String   @default("general") // travel|work|exam|daily|general
  interests       String   @default("[]")     // JSON array of strings
  dailyMinutes    Int      @default(15)
  correctionStyle String   @default("immediate") // immediate|end_of_session
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  sessions        UserSession[]
  states          UserNodeState[]
  evidences       Evidence[]
  seeds           Seed[]
  positions       NodePosition[]
}

model UserSession {                            // auth session (cookie)
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())
}

model GraphNode {
  id             String   @id                  // stable slug: "{lang}:{type}:{key}"
  type           String                       // word|chunk|grammar_pattern|pragmatic_skill|error_pattern|topic_cluster|sound_letter
  lang           String   @default("en")
  cefr           String?                      // A1..C2
  frequencyRank  Int?
  title          String                       // surface form / pattern name (target lang)
  glossFa        String?                      // one-line Persian gloss
  explanationFa  String?                      // short Persian explanation (teach moment)
  examples       String   @default("[]")      // JSON [{text, source, license}]
  tags           String   @default("[]")      // JSON string[]
  version        Int      @default(1)
  status         String   @default("active")  // active|deprecated
  supersededBy   String?                      // migration pointer, never delete
  isUserGenerated Boolean @default(false)
  ownerId        String?                      // set when user-generated
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  states         UserNodeState[]
  fromEdges      GraphEdge[] @relation("fromNode")
  toEdges        GraphEdge[] @relation("toNode")
}

model GraphEdge {
  id       String @id @default(cuid())
  fromId   String
  toId     String
  type     String                              // prerequisite|related|confusable|part_of
  weight   Float  @default(1)
  fromNode GraphNode @relation("fromNode", fields: [fromId], references: [id])
  toNode   GraphNode @relation("toNode", fields: [toId], references: [id])
  @@unique([fromId, toId, type])
}

model UserNodeState {
  id              String   @id @default(cuid())
  userId          String
  nodeId          String
  skill           String                       // reading|writing (MVP); listening|speaking later
  // FSRS materialized view (rebuildable from Evidence + grades)
  stability       Float    @default(0)
  difficulty      Float    @default(0)
  due             DateTime?
  lastReviewAt    DateTime?
  reps            Int      @default(0)
  lapses          Int      @default(0)
  fsrsState       String   @default("New")     // New|Learning|Review|Relearning
  // display / engine
  displayState    String   @default("locked")  // locked|available|learning|mastered|fading|assumed_known
  strength        Float    @default(0)         // soft 0..1 signal for propagation & UI
  pendingDelayTest Boolean @default(false)
  delayTestEligibleAt DateTime?
  masteredAt      DateTime?
  lastAppliedEvidenceId String?                // idempotency for offline replay
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  user            User @relation(fields: [userId], references: [id])
  node            GraphNode @relation(fields: [nodeId], references: [id])
  @@unique([userId, nodeId, skill])
  @@index([userId, displayState])
}

model Evidence {
  id            String   @id @default(cuid())
  userId        String
  sessionId     String
  turnId        String
  nodeId        String                        // MUST exist in GraphNode (whitelist-checked)
  skill         String                        // reading|writing
  outcome       String                        // correct|error|slip_self_corrected|avoided|used_with_hint|unknown
  errorType     String?                       // form|usage|word_choice|spelling|register|word_order|...
  produced      String?                       // what the user actually wrote
  expected      String?                       // target form
  l1Interference Boolean  @default(false)
  hintUsed      Boolean   @default(false)
  responseLatencyMs Int?
  confidence    Float                         // 0..1 (analyst)
  propagated    Boolean   @default(false)     // true if generated by mastery propagation
  disputed      Boolean   @default(false)     // user rejected it
  disputeReason String?
  sessionIdRef  ChatSession @relation(fields: [sessionId], references: [id])
  createdAt     DateTime  @default(now())
  @@index([userId, nodeId, skill, createdAt])
  @@index([sessionId])
}

model ChatSession {
  id        String   @id @default(cuid())
  userId    String
  type      String                          // roleplay_targeted|confirmatory (MVP); diagnostic|free later
  status    String   @default("active")     // active|ended
  brief     String?                         // JSON snapshot of SessionBrief used
  scenario  String?                         // JSON {title, roleplay spec, targetNodes[]}
  summary   String?                         // JSON SessionSummary written at end
  startedAt DateTime @default(now())
  endedAt   DateTime?
  user      User @relation(fields: [userId], references: [id])
  turns     Turn[]
  evidences Evidence[]
}

model Turn {
  id        String   @id @default(cuid())
  sessionId String
  role      String                            // user|tutor
  content   String
  meta      String?                           // JSON {latencyMs, unknownRate, corrections[], tokenEstimate}
  createdAt DateTime @default(now())
  session   ChatSession @relation(fields: [sessionId], references: [id])
  @@index([sessionId, createdAt])
}

model Seed {
  id               String   @id @default(cuid())
  userId           String
  triggerType      String                       // repeated_error (MVP); interest|goal|imported|l1_error later
  triggerRef       String?                      // JSON {errorCount, sessionIds[], sampleProduced, sampleExpected}
  candidateNodeId  String?                      // existing GraphNode id
  candidatePayload String?                      // JSON to CREATE a node (user-generated)
  score            Float
  scoreBreakdown   String                       // JSON {goalRelevance, frequency, readiness, novelty}
  status           String   @default("proposed") // proposed|approved|planted|rejected|expired|merged
  reasonFa         String?                      // human-readable "why" (Persian)
  expiresAt        DateTime?
  createdAt        DateTime  @default(now())
  decidedAt        DateTime?
  user             User @relation(fields: [userId], references: [id])
  @@index([userId, status])
}

model NodePosition {
  userId String
  nodeId String
  x      Float
  y      Float
  tier   Int                      // depth layer for layout stability
  user   User   @relation(fields: [userId], references: [id])
  @@id([userId, nodeId])
}

model MetricEvent {
  id        String   @id @default(cuid())
  userId    String?
  name      String                          // session_start, session_end, evidence_created, ...
  props     String?                         // JSON
  createdAt DateTime @default(now())
  @@index([name, createdAt])
}
```

## 3. JSON contracts crossing the LLM boundary

### 3.1 Analyst output (one JSON object per batch of turns) — zod-validated

```jsonc
{
  "turn_id": "turn_01HZ...",
  "items": [{
    "node_id": "en:chunk:could-you",       // must be in whitelist OR goes to new_unknown_words
    "skill": "writing",                     // reading|writing (MVP)
    "outcome": "error",                     // correct|error|slip_self_corrected|avoided|used_with_hint|unknown
    "error_type": "form",
    "produced": "Can you to help me?",
    "expected": "Could you help me?",
    "l1_interference": false,
    "hint_used": false,
    "response_latency_ms": 8400,
    "confidence": 0.9
  }],
  "new_unknown_words": ["recommendation"]
}
```

### 3.2 SessionBrief (built by engine, injected into tutor system prompt)

```jsonc
{
  "user": { "level": "A2", "goal": "travel", "interests": ["food", "football"],
            "correctionStyle": "immediate", "tone": "warm" },
  "knownLexicon": { "A1": 412, "A2": 187, "B1": 43, "sampleLemmas": ["go", "want", "because", "airport"] },
  "weakNodes":  [ { "id": "en:chunk:could-you", "title": "Could you…?", "why": "3 errors / 4 sessions" } ],
  "frontierNodes": [ { "id": "en:word:recommend", "title": "recommend", "gloss": "پیشنهاد کردن" } ],
  "activeErrorPatterns": [ { "id": "en:err:l1-3rd-singular-s", "desc": "غیاب s سوم‌شخص مفرد" } ],
  "scenario": { "title": "At the airport hotel", "role": "receptionist",
                "mustElicit": ["en:chunk:could-you", "en:word:recommend"] }
}
```

### 3.3 SessionSummary (end of session, engine-built)

```jsonc
{
  "reinforced": [ { "nodeId": "en:word:luggage", "skill": "writing", "grade": "Good" } ],
  "newSeeds":   [ { "seedId": "...", "reasonFa": "۳ خطای مستقل در «whose/who’s»", "score": 0.71 } ],
  "fading":     [ { "nodeId": "en:chunk:used-to", "r": 0.71 } ],
  "delayTestResults": [ { "nodeId": "en:word:journey", "passed": true } ],
  "tomorrow":   { "reviewsDue": 7, "newCandidates": ["en:word:flight"], "remedial": ["en:chunk:could-you"] }
}
```

## 4. Migration & integrity rules

1. Node ids are **immutable**. Schema/graph updates that change identity: create new node → set old `status=deprecated`, `supersededBy=newId` → copy `UserNodeState` rows forward → reads resolve `deprecated→supersededBy` transitively (≤2 hops).
2. `Evidence.nodeId` is never rewritten; reads resolve through the alias chain. The log stays a truthful audit trail.
3. Offline merge: `Evidence` is the merge base (append-only, server-timestamped). `UserNodeState.lastAppliedEvidenceId` makes re-application idempotent; FSRS state is a materialized view and can always be rebuilt by replay.
4. Soft references (seed candidates, briefs, summaries) store ids as plain strings and tolerate dangling ids (filter at read).
5. A migration test (`tests/graph-integrity.test.ts`) asserts: no evidence points to a missing node; no active node has `supersededBy`; edge endpoints exist and are active.

## 5. Index & access notes

- Hot path per turn: `UserNodeState(userId, displayState)`, `Evidence(userId, nodeId, skill, createdAt)` — both indexed above.
- The whole active graph for a language (~300 nodes MVP) is loaded in memory once per server process (`src/lib/graph/load.ts`) with a version-keyed cache; per-request lookups are map hits, not queries.
- `MetricEvent` is write-only from the app and read by analytics scripts; never joined in hot paths.
