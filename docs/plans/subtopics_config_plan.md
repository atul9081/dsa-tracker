# Sub-topic Configuration — Design Plan

## Background

Currently DSA Tracker lets you enable/disable full **topics** (e.g. Arrays, DP, Graphs).
This plan adds a second level: **sub-topics** within each enabled topic
(e.g. within DP: `knapsack`, `1d-dp`, `interval-dp`, …).

### Why some problems still have `sub_type = null`

`data/subtypes-final.json` contains **pattern definitions** (oltTopic + subtype name),
not per-problem assignments. A classification script matched each problem's title/tags
against these patterns. Problems that could not be matched confidently kept `sub_type = NULL`.
These are "unclassified" at the sub-type level — they are a known limitation to fix later
(see Backlog at bottom). For now the queue gives them `__solo_${id}__` buckets so they
can still appear but bypass sub-type staleness grouping.

### Full sub-type catalogue (19 topics, ~65 named sub-types)

| Topic | Sub-types |
|---|---|
| array | design, frequency-count, interval-scheduling, intervals, matrix, prefix-search, prefix-suffix, sequence-construction, sorting-tricks, two-sum-style |
| backtracking | backtracking-dfs, combinations, constraint-search, permutations |
| binary-search | boundary-search, classic-search, search-on-answer |
| bit-manipulation | counting-bits, subset-bitmask, xor-tricks |
| breadth-first-search | grid-bfs, level-order, multi-source-bfs |
| depth-first-search | backtracking-dfs, cycle-detection, grid-dfs, tree-traversal |
| dynamic-programming | 1d-dp, bitmask-dp, digit-dp, game-dp, interval-dp, knapsack, subsequences, tree-dp |
| graph | basic-connectivity, bfs, dfs, mst, scc, sssp, topological-sort |
| greedy | interval-scheduling, jump-game, sequence-construction |
| hash-table | design, frequency-count, pattern-matching, two-sum-style |
| heap-priority-queue | merge-streams, scheduling, top-k |
| linked-list | reversal, two-pointer-list |
| sliding-window | variable-size |
| stack | bracket-matching, calculator, monotonic-stack |
| string | anagram-sliding, palindromes, pattern-matching |
| tree | bst, construction, lca, level-order, path-problems, segment-tree, top-k, traversal, tree-dp, tree-traversal |
| trie | prefix-search |
| two-pointers | bracket-matching, fast-slow, merge-style, opposite-ends, two-pointer-list |
| union-find | basic-connectivity |

---

## Decisions (Q&A resolved)

| # | Question | Decision |
|---|---|---|
| Q1 | Unclassified (null sub_type) problems when a sub-type is disabled | **Exclude them too** — if sub-types are filtered for a topic and a problem is unclassified (can't be proven to belong to an enabled sub-type), it should NOT appear. Classify all remaining problems as backlog. |
| Q2 | Sub-type display names | **Prettify** — `two-sum-style` → "Two Sum Style", `1d-dp` → "1D DP" |
| Q3 | Panel collapsed/expanded by default | **Collapsed** — badge shows "all sub-types" or "3 / 8 sub-types" |
| Q4 | Warn when all sub-types deselected | **Yes** — show inline notice. Eventually all problems will be classified so this edge becomes rare |
| Q5 | Cross-topic sub-type name collisions | **Per-topic filtering is correct** — disabling `array → prefix-search` does not affect `trie → prefix-search` |

---

## Data model

```typescript
// Addition to UserSettings (types/index.ts)
enabled_sub_type_slugs?: Record<string, string[]> | null;
//
//  null (or field absent)                          → all sub-types eligible (default)
//  {}                                              → same as null (no overrides)
//  { 'dynamic-programming': ['knapsack', '1d-dp'] }→ only those two for DP; other topics unrestricted
//  { 'dynamic-programming': [] }                   → disable ALL DP sub-types (named + unclassified)
```

**Rule:** topic not present as a key → all its sub-types are eligible (backward-compatible).

---

## DB migration

> ⚠️ **CRITICAL — DB contains real user data. Every SQL statement must be additive-only.**
> - Never DROP or ALTER existing columns
> - Never modify existing rows
> - Use `ADD COLUMN IF NOT EXISTS` + `DEFAULT NULL` so existing rows are untouched
> - Verify the statement is safe before running
> - Rollback plan: `ALTER TABLE user_settings DROP COLUMN enabled_sub_type_slugs;`
>   (safe since all values would be NULL at that point)

```sql
-- Safe: additive only. Existing rows get NULL = no filter = current behaviour.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS enabled_sub_type_slugs jsonb DEFAULT NULL;
```

**Verify after running:**
```sql
SELECT enabled_sub_type_slugs FROM user_settings LIMIT 1; -- should return null
```

That is the **only** DB change required for this feature.

---

## Implementation phases

### Phase 1 — Schema (5 min)
Run the ALTER TABLE above in Supabase SQL Editor. Verify. Done.

### Phase 2 — Types + API (~10 min)

**`types/index.ts`** — add field to `UserSettings`:
```typescript
enabled_sub_type_slugs?: Record<string, string[]> | null;
```

**`app/api/settings/route.ts`**:
```typescript
// GET handler — read field
enabled_sub_type_slugs: data.enabled_sub_type_slugs ?? null,

// POST handler — write field
if ('enabled_sub_type_slugs' in body)
  settings.enabled_sub_type_slugs = body.enabled_sub_type_slugs;
```

### Phase 3 — Static sub-type catalogue (~5 min)

Add to **`config/topics.ts`**:
```typescript
export const SUB_TYPES_BY_TOPIC: Record<string, string[]> = {
  'array':               ['design', 'frequency-count', ...],
  'dynamic-programming': ['1d-dp', 'bitmask-dp', ...],
  // ... all 19 topics
};

// Prettify helper used by settings UI
export function prettifySubtype(slug: string): string {
  return slug
    .split('-')
    .map(w => w === 'dp' ? 'DP' : w === 'bst' ? 'BST' : w === 'lca' ? 'LCA'
             : w === 'bfs' ? 'BFS' : w === 'dfs' ? 'DFS' : w === 'mst' ? 'MST'
             : w === 'scc' ? 'SCC' : w === 'sssp' ? 'SSSP'
             : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
// Examples: 'two-sum-style' → 'Two Sum Style', '1d-dp' → '1D DP', 'bst' → 'BST'
```

No new API route needed. Sub-types are stable dataset-level values.

### Phase 4 — Queue engine (~10 min)

**`app/api/queue/route.ts`** — three small, contained changes:

**1. Add to `QueueCfg`:**
```typescript
enabledSubTypes: Record<string, string[]> | null;
```

**2. Populate in `resolveConfig`:**
```typescript
enabledSubTypes: settings?.enabled_sub_type_slugs ?? null,
```

**3. Guard in `threeStageSample`** — replaces the pool-grouping loop header:
```typescript
for (const p of eligible) {
  const topic = getPrimaryTopic(p.topic_tags);

  // Sub-type filter (Q1 decision: also exclude unclassified problems when a filter is active)
  if (cfg.enabledSubTypes) {
    const allowed = cfg.enabledSubTypes[topic];
    if (allowed !== undefined) {
      // Filter is active for this topic:
      // - Classified problem: only pass if sub_type is in the allow-list
      // - Unclassified (null): also excluded — can't verify it belongs to an enabled sub-type
      if (!p.sub_type || !allowed.includes(p.sub_type)) continue;
    }
  }

  const subtypeKey = getSubtypeKey(p);
  // ... rest of existing grouping logic unchanged ...
}
```

> Note: this is stricter than the original design. Unclassified problems are excluded
> whenever any sub-type filter is active for their topic. This is the correct behaviour
> per Q1 decision and will become less impactful as more problems get classified (backlog).

No other queue logic changes — staleness, cooldown, difficulty ratios, skip route all unchanged.

### Phase 5 — Settings UI (~35 min)

**`app/settings/page.tsx`** — expand/collapse sub-type panel per enabled topic:

```
☑ Dynamic Programming               [▼ 3 / 8 sub-types]
    ☑ 1D DP   ☑ Knapsack   ☑ Interval DP
    □ Bitmask DP   □ Digit DP   □ Game DP   □ Subsequences   □ Tree DP
    ⚠ Unclassified DP problems will not appear while sub-types are filtered.

☑ Arrays                            [▼ All sub-types ▶]
    (collapsed)
```

Badge logic:
- All selected → "All sub-types ▶"
- Partial → "3 / 8 sub-types ▶"
- None → "0 / 8 sub-types ▶" + warning

State:
```typescript
const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
// enabled_sub_type_slugs is part of the existing `settings` state
```

### Phase 6 — Verify (~10 min)
```bash
npx tsc --noEmit   # must pass with zero errors
```
Manual: disable `knapsack` in DP → save → regen → confirm no knapsack problems; confirm
that unclassified DP problems also don't appear (per Q1).

---

## Nothing-breaks guarantees

| Scenario | Expected outcome |
|---|---|
| DB column not yet added | Field missing from row → `null` fallback → no behaviour change |
| `enabled_sub_type_slugs = null` (default) | All sub-types eligible — **identical to current behaviour** |
| Topic disabled in `enabled_topic_slugs` | Sub-type filter never reached; topic excluded at Stage 1 |
| All sub-types of a topic disabled | Entire topic pool (named + unclassified) excluded for that topic |
| Some sub-types selected, topic enabled | Only classified problems matching allowed sub-types appear |
| Stale sub-type slug in settings (name changed) | Never matches any problem → silently no-ops, no crash |
| Pool shrinks after filtering | Existing `exhausted = true` flag + UX notice handles it |
| Skip route | Same `resolveConfig` → inherits filter, zero extra code |
| Regen modal | Same path through `generateQueue` → inherits filter |
| `tsc --noEmit` | Must pass with zero errors before shipping |

---

## Backlog (related, not blocking this feature)

- **Classify remaining `sub_type = null` problems** — run a more aggressive classification
  pass (or manual tagging) so that the Q1 "exclude unclassified when filter active" rule
  doesn't silently drop too many problems from the pool.
- **CSES sub-types** — CSES problems are currently unclassified at sub-type level.
  They will all be excluded when any sub-type filter is active for a topic they belong to.
  Either classify them or treat CSES as always unfiltered by sub-type.
