# ⚡ DSA Tracker

A **blind-mode** DSA practice tracker built for placement OLT prep. Problems hide their statement, difficulty, and topic tags until you click Reveal — keeping practice honest and exam-realistic.

**Live:** [dsa-tracker-pi-six.vercel.app](https://dsa-tracker-pi-six.vercel.app)

---

## Why

On LeetCode, the difficulty badge and topic tags are visible before you read the problem. Knowing "Dynamic Programming · Hard" before reading a single word changes how you approach it — defeating the purpose of blind practice.

This tracker:
- Shows only the problem title + timer
- Requires you to click **Reveal** to read the description
- Hides difficulty + topics until you mark it **Solved**
- Generates a fresh weighted-random queue every day so you never pick your own problems

---

## Features

### Daily Queue
- 5 problems/day by default (configurable: 1–20)
- **3-stage weighted sampler**: topic → sub-type → problem
  - Topics weighted by `olt_score²` so high-value topics (DP, Graphs) appear more often
  - Sub-types weighted by **staleness** — recently practiced sub-types are deprioritised
  - At most 1 problem per sub-type per day
- Stable for the day (regenerate any time via Settings)
- Skip button replaces a problem without regenerating the whole queue

### Problem Sources
| Source   | Count | Notes                                        |
|----------|-------|----------------------------------------------|
| LeetCode | 1,760 | Free problems mapped to OLT topics           |
| CSES     | 161   | Priority A+B problems from CSES Problem Set  |
| **Total**| **1,921** |                                          |

### Reveal UX
- **First click** → description reveals + timer starts + status → Attempting
- **Hide/Show** toggle — collapses description back (not re-blurred)
- Descriptions fetched from LeetCode GraphQL + cses.fi and stored in DB
- CSES math rendered client-side via **KaTeX** (no server round-trip)

### Settings
| Setting              | Description                                        |
|----------------------|----------------------------------------------------|
| Difficulty mode      | Chill / Standard / Grind / Custom splits           |
| Problem Sources      | LC only, CSES only, or both                        |
| CSES mix ratio       | 0–100% slider (Auto = proportional to pool sizes)  |
| Sub-type cooldown    | Days before re-serving the same sub-type (1–21)   |
| Topic filter         | Enable/disable individual OLT topics               |

### Analytics
- Stat cards (total / solved / streak)
- Difficulty breakdown progress bars + SVG donut chart
- Topic weakness table (solve rate · avg solve time)
- 91-day GitHub-style heatmap
- Weekly avg solve time bar chart

### History
- Last 30 days of daily queues
- Per-queue: date, solved/total, "regenerated" badge if recreated

### Access Control
- New users land on `/waiting` — admin grants access via `user_access` table
- Middleware blocks all protected routes until `granted = true`

---

## Stack

| Layer     | Tech                                       |
|-----------|--------------------------------------------|
| Framework | Next.js (App Router, TypeScript)           |
| Database  | Supabase (Postgres + Auth + RLS)           |
| Styling   | Vanilla CSS (dark theme, Inter font)       |
| Math      | KaTeX (CSES formula rendering)             |
| Hosting   | Vercel                                     |

---

## Project Structure

```
dsa-tracker/
├── app/
│   ├── page.tsx                    # / → Daily Queue
│   ├── login/page.tsx              # /login → Auth (Google + email)
│   ├── waiting/page.tsx            # /waiting → Waitlist holding page
│   ├── auth/callback/route.ts      # OAuth callback handler
│   ├── problems/page.tsx           # /problems → Filterable table (1921 problems)
│   ├── analytics/page.tsx          # /analytics → Stats, heatmap, weakness map
│   ├── history/page.tsx            # /history → Past 30 daily queues
│   ├── settings/page.tsx           # /settings → Queue & difficulty config
│   └── api/
│       ├── queue/route.ts          # GET today's queue | POST regenerate
│       ├── queue/skip/route.ts     # POST replace one problem
│       ├── progress/route.ts       # POST update problem status
│       ├── settings/route.ts       # GET/POST user settings
│       └── streak/route.ts         # GET current solve streak
├── components/
│   ├── ProblemCard.tsx             # Blind card — reveal, timer, solve, skip
│   ├── ProblemRow.tsx              # Table row for /problems
│   ├── Navbar.tsx
│   ├── StatusBadge.tsx
│   ├── DifficultyBadge.tsx
│   └── TopicTags.tsx
├── config/
│   └── topics.ts                   # OLT topics + relevance scores (1–10)
├── lib/
│   ├── supabase-server.ts
│   └── supabase-browser.ts
├── middleware.ts                    # Auth guard + access check
├── scripts/
│   ├── seed-new.ts                 # Seed new LC problems from JSON exports
│   ├── seed-cses.ts                # Seed CSES problems from cses-parsed.json
│   ├── seed-subtypes.ts            # Write Gemini-classified sub-types to DB
│   └── fetch-descriptions.ts       # Batch-fetch descriptions (LC GraphQL + cses.fi)
├── types/index.ts
├── context/
│   ├── notes.txt                   # Dev notes & task log
│   ├── algo_notes.md               # Deep-dive: queue algorithm analysis
│   └── critical_issues.md          # Post-mortems for major bugs fixed
└── docs/
    └── migrations/                 # SQL migration files (run in Supabase SQL Editor)
```

---

## Queue Algorithm (Deep Dive)

See [`context/algo_notes.md`](context/algo_notes.md) for a full analysis.

### Summary

```
1. Fetch all eligible problems (unsolved, free) — paginated 1000/page
2. Split into LC pool + CSES pool
3. Allocate slots:
     - Explicit CSES ratio set → use it directly (0% = 0 CSES)
     - Auto (null)             → proportional to pool sizes, floor at 1
4. For each pool, call sampleFromPool(pool, slots, hard, medium, easy):
     a. Split pool by difficulty
     b. threeStageSample() per difficulty bucket
     c. Fill shortfall from whole pool if a bucket is exhausted
5. threeStageSample():
     Stage 1 → pick topic (weighted by olt_score² × weight_override, MAX 3/topic/day)
     Stage 2 → pick sub-type (weighted by staleness, MAX 1/sub-type/day)
     Stage 3 → pick problem (uniform random within sub-type)
     Fallback A → relax sub-type uniqueness
     Fallback B → fully unconstrained random
6. Shuffle and persist to daily_queues
```

### OLT Topic Scores

| Score | Topics                                              |
|-------|-----------------------------------------------------|
| 10    | Dynamic Programming, Graphs                         |
| 9     | DFS, BFS, Trees, Binary Search                      |
| 8     | Two Pointers, Sliding Window, Backtracking, Heap    |
| 7     | Arrays, Stack, Hash Table, Greedy                   |
| 6     | String, Linked List, Union-Find                     |
| 5     | Trie, Bit Manipulation, Prefix Sum                  |

---

## Local Setup

### Prerequisites

- Node.js ≥ 18
- A [Supabase](https://supabase.com) project

### 1. Clone & install

```bash
git clone https://github.com/vedant-asati/dsa-tracker
cd dsa-tracker
npm install
```

### 2. Environment variables

Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
GEMINI_API_KEY=<gemini-key>         # only needed for sub-type classification
```

### 3. Database schema

Run the SQL files in order in **Supabase → SQL Editor**:

```
docs/migrations/
├── phase1.sql          # Core tables (problems, user_progress, daily_queues)
├── phase2.sql          # user_settings, problems_with_status view
├── phase3.sql          # user_access (waitlist), streak, history
├── phase4f.sql         # cses_ratio column on user_settings
└── fix_new_user_trigger.sql  # Safe trigger for auto-creating user_access row
```

Key schema additions beyond basic:
- `problems.source` — `'leetcode'` | `'cses'`
- `problems.sub_type` — Gemini-classified sub-type (e.g. `'knapsack-dp'`)
- `problems.external_url` — CSES task URL (LC problems use title_slug)
- `user_settings.cses_ratio` — REAL, null = auto
- `user_access` — `(user_id, granted)` for waitlist control

### 4. Seed problems

```bash
# LC problems (from JSON exports in data/)
npx tsx scripts/seed-new.ts

# CSES problems
npx tsx scripts/seed-cses.ts

# Sub-type classification via Gemini
npx tsx scripts/seed-subtypes.ts

# Fetch descriptions (LC from GraphQL, CSES from cses.fi)
SOURCE=lc   npx ts-node scripts/fetch-descriptions.ts
SOURCE=cses npx ts-node scripts/fetch-descriptions.ts   # run from local machine (cses.fi firewalled from some servers)
```

### 5. Run locally

```bash
npm run dev
# Open http://localhost:3000
```

---

## Deployment (Vercel)

1. Push to GitHub
2. Import at [vercel.com/new](https://vercel.com/new)
3. Add env vars from `.env.local`
4. Deploy

New users will land on `/waiting` until you grant access in Supabase:
```sql
UPDATE user_access SET granted = true WHERE user_id = '<uuid>';
```

---

## Known Limitations

| # | Issue | Notes |
|---|-------|-------|
| 1 | Supabase PostgREST max-rows cap at 1000 | Solved via paginated `.range()` fetches |
| 2 | 0% CSES slider still gives 0 problems (auto-floor removed for explicit values) | Working |
| 3 | Skip replacement doesn't respect sub-type uniqueness | Low priority |
| 4 | No spaced repetition — solved problems excluded permanently | By design for now |
| 5 | Topic weights (slider UI) not yet implemented | Planned |

---

## License

MIT
