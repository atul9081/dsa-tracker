# Changelog

All notable changes to DSA Tracker are documented here.

---

## [Unreleased] — 2026-09-27

### Queue Algorithm Fixes (`app/api/queue/route.ts`)

- **[fix] `daily_count` setting now honored** — `resolveConfig` scales the preset difficulty ratio to the user's configured daily target. Standard mode at 7 problems/day now gives 3H+4M instead of always 5.
- **[fix] `null` sub_type bucket bottleneck** — 681 unclassified LC problems no longer share a single `__unknown__` bucket capped at 1 per queue. Each gets a unique `__solo_${id}__` key so `MAX_PER_SUBTYPE=1` applies per problem.
- **[fix] Staleness tracking for unclassified problems** — `buildStalenessMap` joins `problems.id` and tracks unclassified problems individually. Solving one no longer cools down the entire unclassified pool.
- **[fix] Topic filter uses primary topic** — Eligible-problem filter now checks `getPrimaryTopic()` instead of any matching tag. Problems can no longer appear in disabled topic buckets via a secondary tag.
- **[fix] Cross-topic sub_type collisions** — `subtypeUsedSet` stores topic-qualified keys (`array:prefix-sum` ≠ `tree:prefix-sum`). A solve in one topic no longer cools down an identically-named sub_type in an unrelated topic.
- **[fix] Staleness uses IST calendar dates** — All timestamps converted to IST via `toISTDate()`. Eliminates UTC/IST drift near midnight (~0.23 cooldown period error).
- **[fix] `weightedPick` uniform fallback** — When all weights are 0, picks uniformly at random instead of always returning `items[0]`.
- **[fix] Dynamic `MAX_PER_TOPIC`** — Changed from a fixed 3 to `max(1, floor(dailyCount/3))`. A 5-problem day now caps at 1 per topic (was 3, allowing 60% from one topic).

### Skip Route Fixes (`app/api/queue/skip/route.ts`)

- **[fix] Skip respects `enabled_sources`** — Replacement pool filtered to user's enabled platforms. Previously a CSES problem could replace an LC one even when CSES was disabled.
- **[fix] Skip matches difficulty** — Replacement matches the difficulty of the skipped problem (Hard → Hard). Falls back to any difficulty if pool is empty at that difficulty.
- **[fix] Skip applies topic filter** — Uses the same primary-topic filter as main queue generation.
- **[fix] Skip updates `queue_history`** — Post-skip problem set recorded in `queue_history` with incremented version so History reflects what was actually worked on.

### UX Fixes

- **[fix] Exhausted banner placement** (`app/page.tsx`) — `🏆` banner only renders when queue is truly empty. When problems still visible, shows quiet amber `⚠ Only X available` notice instead.
- **[fix] Progress counter shows expected count** (`app/page.tsx`) — Adds `· only X available in your topics` in amber when pool came up short.
- **[fix] `↗ Open` link always visible after solving** (`components/ProblemCard.tsx`) — Solved cards show a persistent `↗ Open` link in the header row, not buried in the collapsible section.
- **[fix] Skip undo toast** (`app/page.tsx`) — Skip shows a page-level amber "Undo" toast for 8s. Undo restores client state and issues a reverse-skip on the server.
- **[fix] Solve time in solved badge** (`components/ProblemCard.tsx`) — Duration now shown inline: `✅ Solved · 12:34`.
- **[fix] Clickable timer restarts attempt** (`components/ProblemCard.tsx`) — `⏱ elapsed` display is clickable, writes a new `attempt_started_at`.
- **[fix] Regen mode pre-populated from settings** (`app/page.tsx`) — Saved `difficulty_mode` loaded from `/api/settings` on mount and used as the initial selection.
- **[fix] Regen warns about in-progress problems** (`app/page.tsx`) — Amber warning shown if any problem is ATTEMPTING when the confirm step opens.
- **[fix] Regeneration updates date display** (`app/page.tsx`) — `setDate(data.date)` called after regen so header date stays in sync.
- **[fix] `🔒 topic hidden` tooltip clarified** (`components/ProblemCard.tsx`) — "Blind practice mode — difficulty and topics are intentionally hidden to avoid anchoring bias."
- **[fix] Platform badge after solve** (`components/ProblemCard.tsx`) — Small `LC` or `CSES` label shown in solved card header.
- **[fix] All-done banner: `⊕ Solve more today`** (`app/page.tsx`) — Link to `/settings` on the completion screen; copy changed from "Come back tomorrow" to "Take a break or go deeper."
- **[fix] Undo toast duration raised to 8s** (`components/ProblemCard.tsx`) — Both solved-undo and skip-undo toasts now give 8s.
- **[fix] History empty state copy** (`app/history/page.tsx`) — Removed "database migration" jargon; now links to home page.
- **[fix] `dailyCount` in queue API response** (`app/api/queue/route.ts`) — Both GET and POST return `dailyCount` (configured target) so the client can detect low-pool conditions.
