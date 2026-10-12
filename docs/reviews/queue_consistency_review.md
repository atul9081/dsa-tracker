# Queue Generation — Full Consistency Review Report (v2)

> **Methodology:** Every issue below was verified against the actual source code.
> Line numbers are exact. Data analysis scripts were run against `data/merged.json`,
> `data/subtypes-final.json`, and `data/cses-parsed.json`.

---

## GENERATION ALGORITHM

### Issue 1 — `daily_count` setting is completely ignored

**Severity: 🔴 High** | Verified at [`api/queue/route.ts:90-101`](file:///home/intruder-jsr/exps/dsa-tracker/app/api/queue/route.ts#L90-L101)

`resolveConfig()` computes `dailyCount = hardCount + mediumCount + easyCount` from
the difficulty preset only. `settings.daily_count` is read into the interface but
never consumed in the function. If you pick "7 problems/day" in Settings, you still
get 5 (the preset sum).

---

### Issue 2 — 38% of LC problems share a single `__unknown__` sub_type bucket, capped at 1 per queue

**Severity: 🔴 High** | Verified by data analysis

681 of 1760 LC problems (38.7%) are not in `subtypes-final.json` and therefore have
`sub_type = null` in the DB. In [`threeStageSample`](file:///home/intruder-jsr/exps/dsa-tracker/app/api/queue/route.ts#L182):

```ts
const subtype = p.sub_type ?? "__unknown__";
```

All 681 unclassified problems go into the same `'__unknown__'` bucket. Because
`MAX_PER_SUBTYPE = 1`, only **one** of these 681 problems can appear per queue, ever.
That means ~39% of your problem pool is effectively excluded from appearing more than
once per day regardless of topic settings. This silently makes the available pool
far smaller than it appears.

---

### Issue 3 — Topic filter (`enabled_topic_slugs`) and `getPrimaryTopic` disagree

**Severity: 🔴 High** | Verified at [`api/queue/route.ts:171-185`](file:///home/intruder-jsr/exps/dsa-tracker/app/api/queue/route.ts#L171-L185)

The eligible filter runs _before_ `getPrimaryTopic`:

```ts
const eligible = enabledSlugs
  ? pool.filter((p) => p.topic_tags.some((t) => enabledSlugs.includes(t)))
  : pool;
```

A problem with `topic_tags = ['array', 'dynamic-programming']` where the user has
only **array** enabled passes this filter (it has 'array'). But `getPrimaryTopic`
returns `'dynamic-programming'` (score 10 > 7). The problem ends up bucketed under
DP — a topic the user disabled. **Disabling a topic does not fully exclude problems
that also belong to it via secondary tags.** High-score topics like DP and Graph will
"absorb" problems the user deselected.

---

### Issue 4 — `null` sub_type staleness key collides: solving any unclassified problem "cools down" all of them

**Severity: 🔴 High** | Verified at [`api/queue/route.ts:129-133`](file:///home/intruder-jsr/exps/dsa-tracker/app/api/queue/route.ts#L129-L133)

```ts
const st = (row as any).problems?.sub_type as string | null;
if (!st) continue; // <-- null sub_type problems are skipped in staleness tracking!
```

So null-subtype problems are never stale. They always get staleness `1.0` (the
Proxy default for unknown keys). But `subtypeUsedSet.add('__unknown__')` still runs
when one is picked, blocking all other `__unknown__` problems for that day. A
single pick from the 681-problem null pool cools down the entire null bucket.

---

### Issue 5 — `MAX_PER_TOPIC = 3` is circumvented when only 1 topic is enabled

**Severity: 🟠 Medium-High** | Verified at [`api/queue/route.ts:196-232`](file:///home/intruder-jsr/exps/dsa-tracker/app/api/queue/route.ts#L196-L232)

If you enable only DP with `dailyCount=5`: slots 1–3 are filled normally (topic cap
hit), then Fallback B fires for slots 4–5 and bypasses `MAX_PER_TOPIC`. So you
get 5 DP problems. That's fine — but it means `MAX_PER_TOPIC` is meaningless when
few topics are enabled. The cap only has effect with many topics enabled, which is
the opposite of when variety constraints matter most.

---

### Issue 6 — Regen mode picker defaults to `'standard'`, ignores your saved default

**Severity: 🟠 Medium-High** | Verified at [`app/page.tsx:23`](file:///home/intruder-jsr/exps/dsa-tracker/app/page.tsx#L23)

```ts
const [diffMode, setDiffMode] = useState<DiffMode>("standard");
```

The queue page never fetches `/api/settings`. If your saved default is "Grind," the
regeneration picker still shows ⚡ Standard. Silent mode mismatch on every regen.

---

### Issue 7 — Two regeneration paths produce different queues

**Severity: 🟠 Medium-High** | Verified at [`settings/page.tsx:128-133`](file:///home/intruder-jsr/exps/dsa-tracker/app/settings/page.tsx#L128-L133) and [`page.tsx:46-49`](file:///home/intruder-jsr/exps/dsa-tracker/app/page.tsx#L46-L49)

| Path                           | Mode sent                           |
| ------------------------------ | ----------------------------------- |
| Settings → "Save & Regenerate" | `settings.difficulty_mode`          |
| Queue → "Get a fresh set"      | local state (defaults `'standard'`) |

The API uses `modeOverride` to **override** whatever is in `user_settings`, so the
queue-page regen silently ignores your saved difficulty mode.

---

### Issue 8 — Skip uses a completely different selection algorithm

**Severity: 🟠 Medium-High** | Verified at [`api/queue/skip/route.ts:55-77`](file:///home/intruder-jsr/exps/dsa-tracker/app/api/queue/skip/route.ts#L55-L77)

Skip's replacement query ignores:

- `enabled_topic_slugs` (can return topics you disabled)
- `enabled_sources` (can return LC when only CSES is enabled, or vice versa)
- Sub-type cooldowns / `subtypeUsedSet`
- `MAX_PER_TOPIC` / `MAX_PER_SUBTYPE`
- Difficulty matching (hard → easy replacement is possible)
- The 3-stage weighted sampler entirely

It uses a flat `olt_score^2 × difficultyMultiplier` weighting over ALL unsolved
problems. Skip is a completely different product from queue generation.

---

### Issue 9 — Skip does not update `queue_history`

**Severity: 🟠 Medium** | Verified at [`api/queue/skip/route.ts:80-87`](file:///home/intruder-jsr/exps/dsa-tracker/app/api/queue/skip/route.ts#L80-L87)

`daily_queues` is updated (the swap), but `queue_history` never gets a new entry.
The History page therefore shows the **original queue** (before skips), not what you
actually worked on. If you skip 2 problems and solve 3, history shows 0/5 for the
original set and may show problems you never saw.

---

### Issue 10 — Staleness uses UTC wall time, but queue date uses IST

**Severity: 🟠 Medium** | Verified at [`api/queue/route.ts:115-116`](file:///home/intruder-jsr/exps/dsa-tracker/app/api/queue/route.ts#L115-L116) and [`api/queue/route.ts:10-12`](file:///home/intruder-jsr/exps/dsa-tracker/app/api/queue/route.ts#L10-L12)

```ts
// buildStalenessMap
const today = new Date(); // UTC wall time
const days = (today.getTime() - last.getTime()) / 86_400_000; // UTC ms difference

// getTodayIST
return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
```

The queue's "today" is an IST date string. Staleness computes elapsed days using raw
UTC timestamps. For a solve at 22:30 UTC (= 04:00 IST next day): the queue generates
for IST tomorrow, but staleness computes `today - last` in UTC, making the subtype
appear to have been solved ~1.5 days ago instead of 0 days ago. The staleness
score is off by up to 5.5 hours / 24h ≈ 0.23 × cooldownFraction.

---

### Issue 11 — CSES-only mode applies LC difficulty ratios

**Severity: 🟠 Medium** | Verified at [`api/queue/route.ts:376-386`](file:///home/intruder-jsr/exps/dsa-tracker/app/api/queue/route.ts#L376-L386)

When only CSES is enabled, slots are still divided by `hardCount/mediumCount/easyCount`
from the LC preset. CSES problem difficulty distribution is different, so the HARD
bucket may find 0 problems and fall through to the uncontrolled filler path.

---

### Issue 12 — Subtypes spanning multiple OLT topics cause cross-topic cooldowns

**Severity: 🟡 Low-Medium** | Verified by data analysis

15 sub-type strings appear across **multiple** OLT topics (e.g., `'pattern-matching'`
in both `hash-table` and `string`; `'two-pointer-list'` in both `linked-list` and
`two-pointers`). When a `two-pointer-list` problem is picked from Linked List,
`subtypeUsedSet.add('two-pointer-list')` blocks all `two-pointer-list` problems in
Two Pointers as well. Solving a Linked List problem silently cools down Two Pointers.

---

### Issue 13 — `weightedPick` always returns `items[0]` when all weights are 0

**Severity: 🟡 Low-Medium** | Verified at [`api/queue/route.ts:23-31`](file:///home/intruder-jsr/exps/dsa-tracker/app/api/queue/route.ts#L23-L31)

```ts
function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + w, 0);  // total = 0
  let rand = Math.random() * total;  // rand = 0
  for (let i = 0; i < items.length; i++) {
    rand -= weights[i];  // rand stays 0
    if (rand <= 0) return items[i];  // always returns items[0]!
  }
  ...
}
```

If all `olt_score` values are 0 and no weight overrides exist, the picker always
returns the first topic in insertion order (the Map iteration order from the eligible
filter), which is deterministic and not random at all.

---

## SETTINGS & UI

### Issue 14 — Selecting a difficulty mode silently resets `daily_count`

**Severity: 🟠 Medium** | Verified at [`settings/page.tsx:70-81`](file:///home/intruder-jsr/exps/dsa-tracker/app/settings/page.tsx#L70-L81)

```ts
setSettings((s) => ({
  ...s,
  difficulty_mode: mode,
  ...presets[mode],
  daily_count:
    presets[mode].hard_count +
    presets[mode].medium_count +
    presets[mode].easy_count,
}));
```

Clicking any preset mode resets `daily_count` to that preset's sum (always 5 for
Standard/Grind, also 5 for Chill). If you previously had `daily_count=7`, clicking
a mode tab silently drops it to 5 with no visual warning.

---

### Issue 15 — Regeneration on queue page does not update the displayed date

**Severity: 🟡 Low-Medium** | Verified at [`app/page.tsx:51-53`](file:///home/intruder-jsr/exps/dsa-tracker/app/page.tsx#L51-L53)

```ts
const data = await res.json();
setProblems(data.problems ?? []);
setExhausted(data.exhausted ?? false);
// data.date is never used
```

Near midnight, if a regeneration crosses the IST date boundary, the header still
shows yesterday's date while serving tomorrow's problems.

---

### Issue 16 — Regenerating replaces ATTEMPTING problems without warning

**Severity: 🟡 Low-Medium** | Verified at [`app/page.tsx:42-59`](file:///home/intruder-jsr/exps/dsa-tracker/app/page.tsx#L42-L59)

If you're mid-attempt on a problem (timer running, status = ATTEMPTING), clicking
"Yes, regenerate" can remove that problem from the new queue. Your status in the DB
remains ATTEMPTING but the card is gone from the UI. The timer is lost. There's no
warning that in-progress problems will be replaced.

---

### Issue 17 — ProblemCard's `revealed` state is initialized from `problem.status`, but stale after undo

**Severity: 🟡 Low** | Verified at [`components/ProblemCard.tsx:63-64`](file:///home/intruder-jsr/exps/dsa-tracker/components/ProblemCard.tsx#L63-L64)

```ts
const [revealed, setRevealed] = useState(problem.status !== "TO_DO");
const [descVisible, setDescVisible] = useState(problem.status !== "TO_DO");
```

When you mark a problem SOLVED then **undo** (via the toast action), `updateStatus`
sets status back to ATTEMPTING. But `revealed` remains `true` from the initial
mount (status was ATTEMPTING). This is correct. However, if an undo races with a
page interaction, the component may re-render with stale `revealed=false` from an
old `problem` prop. The `useState` initializer only runs once — so prop changes
after mount are ignored. The component trusts its own local state, which is correct,
but if the parent ever re-passes the same problem with a different status (e.g., from
a background refresh), revealed state won't update.

---

## HISTORY PAGE

### Issue 18 — `formatDate` uses local timezone on a client-side component but queue dates are IST

**Severity: 🟡 Low-Medium** | Verified at [`app/history/page.tsx:27-39`](file:///home/intruder-jsr/exps/dsa-tracker/app/history/page.tsx#L27-L39)

```ts
const d = new Date(dateStr + "T00:00:00"); // local timezone — no 'Z'!
const today = new Date();
```

The History page is `'use client'` so this runs in the user's browser. If the user's
browser is in IST, the parse is correct (IST = IST). But `dateStr` comes from the
API which generates it via `getTodayIST()` — always IST. If a user's browser locale
is UTC or another timezone, "Today" and "Yesterday" labels will be offset by up to
a day. Low-impact for a single-user IST app but a known timezone footgun.

---

## ANALYTICS PAGE

### Issue 19 — `byDiff` mixes filtered solved count with unfiltered totals

**Severity: 🟡 Low-Medium** | Verified at [`app/analytics/page.tsx:337-345`](file:///home/intruder-jsr/exps/dsa-tracker/app/analytics/page.tsx#L337-L345)

```ts
// byDiff (filtered)
for (const p of allProblems) {
  // <-- total from allProblems (unfiltered)
  byDiff[p.difficulty].total++;
  if (solvedIds.has(p.id)) byDiff[p.difficulty].solved++; // <-- solvedIds from filteredProgress
}
```

When you switch to "This Week," `Difficulty Breakdown` shows "X solved this week
out of ALL hard problems ever." The denominator never changes. The solve rate shown
is not meaningful for a time-filtered view.

---

### Issue 20 — Heatmap ignores `dateFilter` entirely

**Severity: 🟡 Low** | Verified at [`app/analytics/page.tsx:362-367`](file:///home/intruder-jsr/exps/dsa-tracker/app/analytics/page.tsx#L362-L367)

```ts
for (const pr of allProgress) {
  // always all-time, never filteredProgress
  const date = toIST(pr.updated_at);
  heatmap[date] = (heatmap[date] ?? 0) + 1;
}
```

All other analytics sections respond to the This Week / This Month filter. The
heatmap always shows 91 days of all-time activity. No visual indicator distinguishes
that the heatmap is exempt from the filter — the section title says
"Activity — Last 91 Days" regardless of filter selection, which is misleading when
the filter is set to "This Week."

---

### Issue 21 — Status Overview pie chart is also exempt from `dateFilter`

**Severity: 🟡 Low** | Verified at [`app/analytics/page.tsx:333-335`](file:///home/intruder-jsr/exps/dsa-tracker/app/analytics/page.tsx#L333-L335)

```ts
const byStatus: Record<Status, number> = { TO_DO: 0, ATTEMPTING: 0, SOLVED: 0 };
for (const p of allProblems) byStatus[p.status] = ...  // allProblems, not filtered
```

`byStatus` and the stat cards (Total, Solved, Attempting, To-Do) all use
`allProblems.status`, which is the **current** status, not filtered by date.
Selecting "This Week" changes the Topic Weakness Map and Speed Chart, but the big
stat cards at the top and Status Pie remain unchanged.

---

### Issue 22 — `queue_history` failure silently swallowed; History always empty with no diagnosis

**Severity: 🟡 Low** | Verified at [`api/queue/route.ts:396-415`](file:///home/intruder-jsr/exps/dsa-tracker/app/api/queue/route.ts#L396-L415)

```ts
try {
  // ... insert into queue_history
} catch {
  // queue_history table not yet created — silently skip
}
```

If `queue_history` doesn't exist or has a schema mismatch, the queue still generates
and serves correctly, but nothing is ever stored. The History page shows "No history
yet — your daily queues will appear here after the database migration runs." with
no link, no button, no diagnosis path. You cannot tell if history is missing because
you haven't solved anything, or because the table migration never ran.

---

## Summary Table

| #   | Area      | Issue                                                                               | Severity    |
| --- | --------- | ----------------------------------------------------------------------------------- | ----------- |
| 1   | Algorithm | `daily_count` setting ignored in generation                                         | 🔴 High     |
| 2   | Algorithm | 38% LC problems in `__unknown__` bucket, capped at 1/queue                          | 🔴 High     |
| 3   | Algorithm | Topic filter and `getPrimaryTopic` disagree — problems sneak into disabled topics   | 🔴 High     |
| 4   | Algorithm | Null sub_type staleness key not tracked; a single null-sub problem blocks all 681   | 🔴 High     |
| 5   | Algorithm | `MAX_PER_TOPIC` circumvented when few topics enabled                                | 🟠 Med-High |
| 6   | UI        | Regen picker defaults to `'standard'`, ignores saved default                        | 🟠 Med-High |
| 7   | UI        | Two regen paths produce different queues                                            | 🟠 Med-High |
| 8   | Skip      | Skip uses different algorithm (ignores topics, sources, difficulty, cooldowns)      | 🟠 Med-High |
| 9   | Skip      | Skip doesn't update `queue_history`                                                 | 🟠 Med      |
| 10  | Algorithm | Staleness uses UTC wall time; queue date uses IST — off by up to 5.5 hours          | 🟠 Med      |
| 11  | Algorithm | CSES-only mode applies LC difficulty ratios                                         | 🟠 Med      |
| 12  | Algorithm | 15 sub-type names span multiple topics — solving one topic cools down another       | 🟡 Low-Med  |
| 13  | Algorithm | `weightedPick` returns `items[0]` deterministically when all weights are 0          | 🟡 Low-Med  |
| 14  | Settings  | Selecting a preset mode silently resets `daily_count`                               | 🟠 Med      |
| 15  | UI        | Regen doesn't update displayed date                                                 | 🟡 Low-Med  |
| 16  | UI        | Regen replaces ATTEMPTING problems without warning                                  | 🟡 Low-Med  |
| 17  | UI        | `revealed` state ignores prop changes after mount (stale on background refresh)     | 🟡 Low      |
| 18  | History   | `formatDate` uses local timezone — label wrong for non-IST browsers                 | 🟡 Low-Med  |
| 19  | Analytics | `byDiff` mixes filtered solved with all-time totals                                 | 🟡 Low-Med  |
| 20  | Analytics | Heatmap ignores `dateFilter` — always shows 91 days                                 | 🟡 Low      |
| 21  | Analytics | Status pie + stat cards ignore `dateFilter`                                         | 🟡 Low      |
| 22  | History   | `queue_history` failure silently swallowed — History always empty with no diagnosis | 🟡 Low      |

---

## Recommended Fix Order

### Immediate (correctness-breaking)

1. **Issue 2** — Treat `null` sub_type as individual-problem buckets (use problem ID as key
   for the `__unknown__` case), not a shared bucket.
2. **Issue 4** — Track null-subtype staleness by problem `id`, not by sub_type.
3. **Issue 3** — Filter eligible pool by `getPrimaryTopic()` result matching `enabledSlugs`,
   not by any tag matching.
4. **Issue 1** — Honor `daily_count` (or remove it from Settings if the preset sum is authoritative).

### High impact, low effort

- **Issue 6** — Fetch `/api/settings` on queue page load; pre-populate the regen picker.
- **Issue 9** — Call `queue_history` insert from the skip route (same try/catch pattern).
- **Issue 15** — `setDate(data.date)` after regen.
- **Issue 16** — Warn before regen if any problem is ATTEMPTING.

### Algorithm improvements

- **Issue 8** — Reuse `threeStageSample` or at minimum respect `enabled_sources` and
  difficulty-matching in skip.
- **Issue 10** — Make staleness use IST-aware date arithmetic (same as `getTodayIST`).
- **Issue 12** — Qualify sub_type keys as `${topic}:${subtype}` to avoid cross-topic collision.

### Analytics polish

- **Issues 19–21** — Make heatmap, stat cards, and byStatus all respond to `dateFilter`.
