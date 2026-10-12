# User Perspective Review — DSA Tracker

**Date:** September 2026  
**Reviewer:** Antigravity (AI pair-programmer)  
**Scope:** Full codebase audit from a user's daily-use perspective

---

## TL;DR

The core concept is solid and the blind-mode mechanic is genuinely well-designed. But from a daily-use standpoint the app is very "static" — it doesn't adapt to the user at all. All the intelligence lives in a config file that requires a code change to tweak. Every feature suggestion below is about making the app feel like a **personalized coach** rather than a static problem shuffler.

---

## 1. Queue Customization — Currently Zero In-App Control

### Current State

Everything lives in `config/queue.ts` (a compile-time constant):

```ts
export const QUEUE_CONFIG = {
  dailyCount: 5,
  hardCount: 2,
  mediumCount: 3,
  easyCount: 0,
  topicWeightExponent: 2,
  difficultyMultiplier: { HARD: 1.5, MEDIUM: 1.0, EASY: 0.5 },
};
```

To change *anything* about queue behaviour the user has to edit a TypeScript file and redeploy. For a multi-user app this is a blocker — friends literally cannot set their own preferences.

### What Users Want

#### 1a. Difficulty Mode ("How hard do you want today?")

A simple three-way toggle that adjusts the hard/medium/easy split **before** generating the queue.

| Mode | Hard | Medium | Easy | Use case |
|------|------|--------|------|----------|
| **Chill** | 0 | 3 | 2 | Struggling days / revision |
| **Standard** | 2 | 3 | 0 | Default (current) |
| **Grind** | 3 | 2 | 0 | Peak prep, feeling sharp |

Stored per-user in Supabase (e.g. a `user_settings` table).

#### 1b. Topic Weights / Pinning

Currently `olt_score` is the only weight and it's fixed in the seed script. Users should be able to:
- **Pin** a topic → guarantee at least 1 problem from it per day
- **Boost** a topic → slider from 0.5x to 3x on the default weight
- **Mute** a topic → never include it in today's queue

A UI like a topic grid with toggle + weight slider per row, persisted in `user_settings.topic_overrides`.

#### 1c. Daily Count

Some days you only have 30 minutes, some days you have 3 hours. Let the user set `dailyCount` to 3, 5, or 7 from a settings page. Default 5 is fine.

---

## 2. Topic Selection / Focus Mode

### Current State

All 19 OLT topics are always in play. There's no way to say "for this week I only want DP and Graphs."

### What's Needed

A **"Focus Topics"** UI — a multi-select checklist on the Settings or Queue page where the user toggles which topics are eligible for queue generation. All enabled by default. Changes take effect the next day (or immediately on "Get new problems").

This is especially useful when:
- Interview is in 3 days and you want to hammer one topic
- You've already completed all graph problems and want to exclude it
- A friend only cares about a subset of topics

**Implementation hint:** filter the pool in `generateQueue()` by `user_settings.enabled_topic_slugs` before the weighted sample.

---

## 3. Solve-Time Tracking

### Current State

`user_progress` stores: `problem_id`, `user_id`, `status`, `updated_at`.

`updated_at` is just when the row was last upserted — not meaningful for tracking solve speed. There's no concept of when the *attempt* started.

### What's Needed

#### 3a. Attempt Timer

When the user clicks "Mark Attempting" (or clicks the LC link which auto-advances), start an in-memory timer visible on the card. When they click "Mark Solved", record the elapsed time. Store `attempt_started_at` and `solve_duration_seconds` in the DB.

The timer doesn't need to be perfectly accurate — even approximate measurement is valuable. Show it on the card as `⏱ 14 min` after solving.

**DB fields to add to `user_progress`:**
```sql
attempt_started_at  TIMESTAMPTZ,
solve_duration_secs INTEGER,      -- null = no timer captured
first_attempted_at  TIMESTAMPTZ,  -- first time status went to ATTEMPTING
```

#### 3b. Revealed Solve Time in Analytics

After a user accumulates data, show:
- Average solve time by difficulty (Hard: ~38 min, Medium: ~22 min)
- Trend: are you getting faster week over week?

---

## 4. "Blur Until Attempt" UX Flow

### Current State

Problems are fully visible in TO_DO state — title, full description, constraints. Only difficulty and topic tags are hidden.

### What Users Actually Want (from `context/notes.txt`)

> "maybe we can add a btn show test cases. so i get better idea."
> "when i got some idea to code. then state is attempting and then only the heading and the problem title is visible"

The ideal flow:

```
TO_DO:
  - Show title
  - Show description BLURRED / collapsed
  - Button: "👁 Reveal & Start Timer" → reveals description, starts timer

ATTEMPTING:
  - Full description visible
  - Timer running (shown subtly)
  - LC link prominent
  - "✅ Mark Solved" stops timer, records duration

SOLVED:
  - Collapsed accordion (current behaviour is good)
  - Shows difficulty + topics + time taken
```

**This is the single biggest UX shift available with relatively small dev effort.** The blur/reveal of description is pure CSS + a boolean state. Timer is a `setInterval` in React.

---

## 5. Historical Tracking — First/Last Attempted

### Current State

The DB only keeps `updated_at`, which is always overwritten on status change. There's no way to know "when did I first attempt this?" or "when did I solve this?".

### What's Needed

Add `first_attempted_at TIMESTAMPTZ` to `user_progress` — set once when status transitions to ATTEMPTING and never overwritten. This gives the user:
- "You first tried this 12 days ago and just solved it — great persistence! 💪"
- A calendar heatmap of activity (like GitHub's contribution graph)
- Sorting the problems list by "last attempted" to resume in-progress work

---

## 6. Analytics — Very Basic Right Now

### Current State

- 4 stat cards (total, solved, attempting, to-do)
- Progress bars by difficulty and topic
- A donut SVG chart of status

### What's Missing

#### 6a. Streak Tracking

How many days in a row have you solved at least 1 problem? This single metric is more motivating than any other. Show it prominently on the Daily Queue page: **🔥 7-day streak**.

Requires: a query that checks if each date had at least one SOLVED status change.

#### 6b. Calendar Heatmap

GitHub-style heatmap of problems solved per day. Show the last 90 days. Green = solved something, darker = solved more. Low dev effort, huge motivation boost.

#### 6c. Topic Weakness Map

Current analytics shows topic progress bars (solved/total). But the *real* insight is: "Which topics do you *attempt* the most but *solve* the least?" — that's your weak spot. A simple ratio table would be very useful.

#### 6d. Solve Speed Trends (once timer is added)

Line chart of average solve time per week. Are you improving?

#### 6e. Problems Solved Today / This Week

The Daily Queue page shows today's solved count. But Analytics has no "this week" or "today" view — just all-time totals. Add a date filter.

---

## 7. Data Skew — Topic Distribution Problem

### Current State (from `docs/reviews/1_review.md`)

```
Total: 570 problems
HARD: 76  |  MEDIUM: 470  |  EASY: 24
```

Within medium/hard, topic distribution is almost certainly uneven. DP problems tend to dominate LeetCode's library. Graph problems are fewer. This means:

- A user practicing with default weights will see **disproportionately more DP** problems
- Topics like Graph, BFS, Trie, Union-Find will appear much less often, even with high OLT scores

### What Happens in Practice

The `weightedSample()` in `queue/route.ts` samples from the *full unsolved pool* per difficulty. If DP has 150 medium problems and Graphs has 20, DP problems will appear ~7.5x more often even at equal weight.

### Solutions

#### 7a. Add More Data (User's Planned Approach)

Add more JSON data for under-represented topics. This is the cleanest fix. CSES problems (as mentioned in `context/notes.txt`) are a great addition — they tend to be algorithm-specific and cover graphs/trees well.

**Suggested CSES additions:** Graph problems (shortest paths, MST, connectivity), Tree DP, Range queries (segment tree / BIT).

#### 7b. Topic-Normalized Sampling

Instead of sampling from the full pool, **sample by topic first**:
1. Pick a random topic (weighted by `olt_score`)
2. Pick a random problem from that topic (weighted by difficulty multiplier)

This guarantees topic diversity regardless of dataset imbalance. Implementable with a 2-stage sampling change in `generateQueue()`.

#### 7c. "Never Same Topic Twice Today" Guard

Even with balanced data, you could draw 3 DP problems in one day. Add a constraint: within a daily queue, no topic should appear more than N times (e.g. N=2). Easy to implement as a post-sampling filter.

---

## 8. Regenerate Queue — Confusing Purpose

### User Feedback (from `context/notes.txt`)

> "im also not sure what regenerate queue does? and whats its use."

The "Get new problems" button completely replaces today's queue with a fresh random set. This is useful but poorly communicated.

### Issues

1. No explanation of what it does or why you'd want it
2. After regenerating, any SOLVED/ATTEMPTING statuses on old problems are **silently preserved** in `user_progress` — those problems just disappear from today's queue. Confusing.
3. No way to "add 1 more problem" without replacing all 5

### Improvements

- Rename to something clearer: "Shuffle today's problems" or "Get a fresh set"
- Add a tooltip/subtitle: *"Replaces today's 5 problems with a new random set. Progress on removed problems is saved."*
- Consider an "Add 1 more" option that appends without replacing
- Log regenerations somewhere (so user knows they shuffled 4 times today)

---

## 9. Problems List (/problems page) — Good Foundation, Some Gaps

### What Works Well

- Search by title/ID
- Filter by status, difficulty, topic
- Pagination at 50/page
- Inline status toggle without page reload

### What's Missing

#### 9a. Sorting

The table is locked to `ORDER BY id` (LeetCode problem number). Users often want to sort by:
- OLT Score (most important first)
- Difficulty (hard first)
- Status (unsolved first)
- AC Rate (easier first within difficulty)

Add sortable column headers.

#### 9b. "Last Attempted" in the Table

Once `first_attempted_at` / `updated_at` is meaningful, show it in the row: *"3 days ago"*. Lets users find problems they were stuck on.

#### 9c. Bulk Actions

Currently you can only change one status at a time. Power users might want to bulk-mark a set of problems as TO_DO (e.g. resetting a topic for re-practice).

#### 9d. Topic Filter Shows ALL Topics

The topic dropdown has all 19 topics even if the user has solved everything in some. Filter the dropdown to only show topics that have problems in the current filtered result set (or at least indicate count).

---

## 10. Smaller UX Papercuts

### 10a. No Mobile Navigation

The navbar at 56px height is fine on desktop. On mobile, three nav links + user email + sign-out = horizontal overflow. No hamburger menu. For friends using this on their phone, this is broken.

### 10b. No Feedback on Status Change

When you click "Mark Solved" on a ProblemCard, it immediately re-renders the solved state. There's no toast/notification. A subtle "✅ Marked as solved!" toast for 2 seconds would feel much better.

### 10c. Empty State on Daily Queue

If all 5 problems are solved, the page shows "5 solved of 5 problems" with no congratulations. Just the cards greyed out. Add a completion celebration — even a simple message: *"🎉 All done for today! Come back tomorrow."*

### 10d. No Way to "Skip" a Problem

If a user genuinely can't attempt a problem (wrong topic for their current prep, or they've seen it before), there's no skip/hide option. They're stuck with it until regenerating the whole queue.

A "Skip" button that replaces just that card with a new problem would be very handy.

### 10e. The "🔒 topic hidden" Badge is Confusing

In TO_DO state, the badge says "🔒 topic hidden". Users who haven't read the README may not understand what this means or why. A brief tooltip on hover: *"Difficulty and topic are revealed after you mark this solved."* would help, especially for friends sharing the app.

### 10f. Difficulty Filter on /problems Leaks Info

The /problems filter bar lets you filter by MEDIUM or HARD before solving. Since the table hides difficulty per-row, the filter itself becomes a spoiler. Consider disabling/greying the difficulty filter for unsolved problems with an explanatory note.

### 10g. Status Reversion Not Possible from Cards

If you accidentally click "✅ Mark Solved" on a problem you didn't actually solve, you can't undo it from the ProblemCard (only ProblemRow lets you cycle back). Add an "Undo" option briefly after marking solved (e.g. a 5-second undo toast).

---

## 11. Settings / User Preferences Page — Missing Entirely

All of the above improvements require storing user preferences. Currently there's no `user_settings` table and no Settings page. This should be a foundational addition:

**Suggested `user_settings` table:**
```sql
CREATE TABLE user_settings (
  user_id               UUID PRIMARY KEY REFERENCES auth.users(id),
  daily_count           INTEGER DEFAULT 5,
  hard_count            INTEGER DEFAULT 2,
  medium_count          INTEGER DEFAULT 3,
  easy_count            INTEGER DEFAULT 0,
  enabled_topic_slugs   TEXT[] DEFAULT NULL,  -- NULL = all topics enabled
  topic_weight_overrides JSONB  DEFAULT '{}', -- { "graph": 2.0, "dp": 0.5 }
  difficulty_mode       TEXT   DEFAULT 'standard', -- 'chill' | 'standard' | 'grind'
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
```

**Settings Page sections:**
1. **Queue Setup** — daily count, difficulty mode toggle
2. **Topic Focus** — multi-select topic checklist with weight sliders
3. **Display** — (future: light mode, font size)

---

## 12. CSES Problem Integration

From `context/notes.txt`:
> "now think what questions from cses.fi/problemset to add."

CSES problems are excellent for OLT prep because they are:
- Algorithm-category focused (graph, tree, DP, etc.)
- Well-balanced across difficulty
- Free and no account required

**Implementation consideration:** CSES doesn't have LeetCode-style slugs, so the `title_slug` link pattern won't work. You'd need to:
1. Add a `source` field to `problems` table (`'leetcode' | 'cses'`)
2. Add a `external_url` field for CSES problem URLs
3. Render the link conditionally in ProblemCard/ProblemRow

This is a moderate but very worthwhile addition given the topic balance issue (§7).

---

## 13. Summary Table — Feature Priority

| # | Feature | Impact | Dev Effort | Priority |
|---|---------|--------|-----------|----------|
| 1c | Daily count setting | Medium | Very Low | 🔴 High |
| 1a | Difficulty mode toggle | High | Low | 🔴 High |
| 4 | Blur/reveal + timer UX | Very High | Low | 🔴 High |
| 10c | "All done!" empty state | Medium | Very Low | 🔴 High |
| 10e | "topic hidden" tooltip | Medium | Very Low | 🔴 High |
| 2 | Focus topics selection | High | Medium | 🟠 Medium |
| 3a | Attempt timer + store duration | High | Medium | 🟠 Medium |
| 5 | First/last attempted timestamps | Medium | Low | 🟠 Medium |
| 6a | Streak tracking | High | Medium | 🟠 Medium |
| 6b | Calendar heatmap | High | Medium | 🟠 Medium |
| 7b | Topic-normalized sampling | High | Medium | 🟠 Medium |
| 7c | No-same-topic guard | Medium | Low | 🟠 Medium |
| 8 | Regenerate UX clarification | Medium | Low | 🟠 Medium |
| 10b | Toast on status change | Medium | Low | 🟠 Medium |
| 10d | Skip a problem | Medium | Medium | 🟠 Medium |
| 10g | Undo mark solved | Medium | Low | 🟠 Medium |
| 1b | Per-topic weight sliders | High | High | 🟡 Low |
| 9a | Sortable columns | Low | Low | 🟡 Low |
| 6c | Topic weakness map | Medium | Medium | 🟡 Low |
| 6d | Solve speed trends | Medium | High | 🟡 Low |
| 10a | Mobile nav | Low | Medium | 🟡 Low |
| 11 | Settings page | Foundational | High | 🟡 Low |
| 12 | CSES integration | High | High | 🟡 Low |

---

## 14. What's Already Working Well (Don't Break These)

- **Blind mode mechanic** is excellent. Hiding difficulty+topics until solved is the core value prop and it's implemented cleanly.
- **Weighted random sampling** with `olt_score^2` is a clever way to bias toward important topics.
- **Daily queue stability** — same 5 problems persist through the day, not re-rolled on every page load.
- **Auto-advancing to ATTEMPTING on LC link click** is a smart workflow touch.
- **Dark theme + Inter font** looks professional.
- **RLS-based multi-user isolation** is properly implemented.
- **Analytics donut chart** in pure SVG (no dependency) is a nice touch.
- **Accordion on Solved cards** (expand/collapse description) is the right design.

---

## 15. Top 3 Recommendations

If only implementing 3 things from this review, pick:

1. **Blur + timer reveal flow** (§4) — biggest UX shift, least code. The whole "reveal when ready" mechanic is the soul of this app.
2. **Difficulty mode toggle** (§1a) — most requested user control, trivially easy to add with a `user_settings` table.
3. **Streak counter on Daily Queue page** (§6a) — highest motivation/engagement impact per line of code.
