# Sub-topic Configuration — Design Plan

## Background

Currently DSA Tracker lets you enable/disable full **topics** (e.g. Arrays, DP, Graphs).
This plan adds a second level: **sub-topics** within each enabled topic
(e.g. within DP: `knapsack`, `1d-dp`, `interval-dp`, …).

### Full sub-type catalogue (derived from DB)

| Topic | Sub-types (count) |
|---|---|
| array | design, frequency-count, interval-scheduling, intervals, matrix, prefix-search, prefix-suffix, sequence-construction, sorting-tricks, two-sum-style (10) |
| backtracking | backtracking-dfs, combinations, constraint-search, permutations (4) |
| binary-search | boundary-search, classic-search, search-on-answer (3) |
| bit-manipulation | counting-bits, subset-bitmask, xor-tricks (3) |
| breadth-first-search | grid-bfs, level-order, multi-source-bfs (3) |
| depth-first-search | backtracking-dfs, cycle-detection, grid-dfs, tree-traversal (4) |
| dynamic-programming | 1d-dp, bitmask-dp, digit-dp, game-dp, interval-dp, knapsack, subsequences, tree-dp (8) |
| graph | basic-connectivity, bfs, dfs, mst, scc, sssp, topological-sort (7) |
| greedy | interval-scheduling, jump-game, sequence-construction (3) |
| hash-table | design, frequency-count, pattern-matching, two-sum-style (4) |
| heap-priority-queue | merge-streams, scheduling, top-k (3) |
| linked-list | reversal, two-pointer-list (2) |
| sliding-window | variable-size (1) |
| stack | bracket-matching, calculator, monotonic-stack (3) |
| string | anagram-sliding, palindromes, pattern-matching (3) |
| tree | bst, construction, lca, level-order, path-problems, segment-tree, top-k, traversal, tree-dp, tree-traversal (10) |
| trie | prefix-search (1) |
| two-pointers | bracket-matching, fast-slow, merge-style, opposite-ends, two-pointer-list (5) |
| union-find | basic-connectivity (1) |

**Total: ~65 named sub-types across 19 topics.**
Plus ~681 problems with `sub_type = null` (unclassified), each in their own `__solo_${id}__` bucket.

---

## Data model

```typescript
// Addition to UserSettings (types/index.ts)
enabled_sub_type_slugs?: Record<string, string[]> | null;
//
//  null (or field absent)              → all sub-types eligible (default, zero behaviour change)
//  {}                                  → same as null (no overrides)
//  { 'dynamic-programming': ['knapsack', '1d-dp'] }
//                                      → only those two sub-types for DP; other topics unrestricted
//  { 'dynamic-programming': [] }       → all named DP sub-types disabled
//                                        (null-subtype DP problems can still appear — see Q1 below)
```

**Rule:** a topic not present as a key → all its sub-types are eligible (backward-compatible).

---

## DB migration

```sql
-- Run in Supabase SQL Editor
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS enabled_sub_type_slugs jsonb DEFAULT NULL;
```

One line. `jsonb DEFAULT NULL` means all existing rows get `null` → no change in behaviour.

---

## Implementation phases

### Phase 1 — Schema (5 min)
- Run SQL above in Supabase dashboard.

### Phase 2 — Types + API (~10 min)

**`types/index.ts`** — add field to UserSettings.

**`app/api/settings/route.ts`** — read/write the new field in GET and POST handlers.

### Phase 3 — Static sub-type catalogue (~5 min)
Add `SUB_TYPES_BY_TOPIC: Record<string, string[]>` to **`config/topics.ts`**, derived from
`data/subtypes-final.json`. Sub-types are stable (dataset-level, not user-generated).

### Phase 4 — Queue engine (~10 min)

**`app/api/queue/route.ts`** — three small changes:

1. Add `enabledSubTypes: Record<string, string[]> | null` to `QueueCfg`.
2. Populate it in `resolveConfig` from `settings.enabled_sub_type_slugs`.
3. Add one guard inside the pool-grouping loop in `threeStageSample`:

```typescript
// Sub-type filter — only applies to classified problems (p.sub_type != null)
if (cfg.enabledSubTypes && p.sub_type) {
  const allowed = cfg.enabledSubTypes[topic];
  if (allowed !== undefined && !allowed.includes(p.sub_type)) continue;
}
```

No other queue logic changes. Staleness, cooldown, difficulty ratios, skip route — all unchanged.

### Phase 5 — Settings UI (~30 min)

**`app/settings/page.tsx`** — collapsible sub-type panel under each enabled topic row:

```
☑ Dynamic Programming                   [▼ 3 / 8 sub-types]
    ☑ 1d-dp   ☑ knapsack   ☑ interval-dp
    □ bitmask-dp   □ digit-dp   □ game-dp   □ subsequences   □ tree-dp

☑ Arrays                                [all sub-types]
    (collapsed)
```

Save logic:
- All selected → remove topic key from record (cleaner)
- Partial → `{ topic: ['a', 'b'] }`
- None selected → `{ topic: [] }`

### Phase 6 — Verify (~10 min)
```bash
npx tsc --noEmit
```
Manual: disable `knapsack` in DP → regen → confirm no knapsack problems appear.

---

## Nothing-breaks guarantees

| Scenario | Outcome |
|---|---|
| DB column not added yet | Field missing → `null` fallback → no behaviour change |
| `enabled_sub_type_slugs = null` (default) | All sub-types eligible — identical to today |
| Topic disabled in `enabled_topic_slugs` | Sub-type filter irrelevant; topic excluded at Stage 1 |
| Stale sub-type slug in settings | Never matches any problem → no crash |
| Pool shrinks after filtering | Existing `exhausted = true` path handles it |
| Skip route | Uses same `resolveConfig` → inherits filter automatically |
| Re-enabling a sub-type after a gap | Staleness score is high → gets prioritised → desirable |

---

## Open questions

> Please edit/answer these — I'll implement exactly to your answers.

**Q1. Null-subtype problems when all named sub-types are disabled**
If you set `{ 'dynamic-programming': [] }` (disable all named DP sub-types), the unclassified DP
problems (null sub_type) can still appear because the filter can't apply to them.
Should they **still appear**, or should "disable all sub-types" effectively **block the whole topic**?

**Q2. Sub-type display names**
Slugs look like `two-sum-style`, `backtracking-dfs`, `1d-dp`.
Display as-is with hyphens, or prettified ("Two Sum Style", "1D DP")?

**Q3. UI: expand by default or collapsed?**
Proposal: collapsed by default, badge shows "all sub-types" or "3 / 8 sub-types".
Is that fine, or expand all by default?

**Q4. Warn when all sub-types of a topic are deselected?**
Show a warning like "⚠ No named sub-types selected — only unclassified problems from this topic will appear"?

**Q5. Cross-topic sub-type name collisions**
`prefix-search` appears in both `array` and `trie`. Filtering is per `(topic, sub_type)` pair —
disabling `array → prefix-search` does NOT disable `trie → prefix-search`. Expected behaviour?
