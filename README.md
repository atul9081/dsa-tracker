# ⚡ DSA Tracker

A personal **blind-mode** LeetCode practice tracker. Problems reveal their topic tags and difficulty _only after_ you mark your status — keeping practice honest.

**Live:** [dsa-tracker-pi-six.vercel.app](https://dsa-tracker-pi-six.vercel.app)

---

## Features

- **🔒 Blind Mode** — difficulty and topics hidden until you interact with a card
- **📅 Daily Queue** — 4 weighted-random problems per day (prioritised by OLT relevance score), regeneratable on demand
- **📋 Problem List** — filterable table (status · difficulty · topic · search) with inline status updates
- **📊 Analytics** — stats cards, difficulty/topic progress bars, and a status donut chart (pure SVG)
- **🏷️ Status Tracking** — `To-Do` → `Attempted` → `Debugging` → `Solved`
- **570 problems** seeded from personal LeetCode exports, descriptions scraped from [leetcode.ca](https://leetcode.ca)

## Stack

| Layer     | Tech                                 |
| --------- | ------------------------------------ |
| Framework | Next.js 14 (App Router, TypeScript)  |
| Database  | Supabase (Postgres)                  |
| Styling   | Vanilla CSS (dark theme, Inter font) |
| Hosting   | Vercel                               |

---

## Project Structure

```
dsa-tracker/
├── app/
│   ├── page.tsx              # / → Daily Queue
│   ├── problems/page.tsx     # /problems → Filterable list
│   ├── analytics/page.tsx    # /analytics → Stats & charts
│   └── api/
│       ├── queue/route.ts    # GET (today's queue) + POST (regenerate)
│       └── progress/route.ts # POST (update status)
├── components/
│   ├── ProblemCard.tsx       # Blind card with reveal-on-status
│   ├── ProblemRow.tsx        # Table row for /problems
│   ├── Navbar.tsx
│   ├── StatusBadge.tsx
│   ├── DifficultyBadge.tsx
│   └── TopicTags.tsx
├── config/
│   ├── topics.ts             # OLT topics + relevance scores (1–10)
│   └── queue.ts              # Daily count, difficulty split, weights
├── lib/
│   ├── supabase-server.ts    # Service role client (API routes only)
│   └── supabase-browser.ts   # Anon client (client components)
├── scripts/
│   └── seed.ts               # One-time seed: local JSONs + leetcode.ca
├── types/index.ts
└── data/                     # Raw LeetCode export JSONs (gitignored)
```

---

## Queue Algorithm

1. Pull all unsolved, free problems from `problems_with_status` view
2. Split into `HARD`, `MEDIUM`, `EASY` buckets
3. **Weighted random sample** within each bucket:
   `weight = olt_score² × difficulty_multiplier`
4. Pick 2 Hard + 2 Medium (fallback to next difficulty if exhausted)
5. Shuffle the 4 cards (hides position-based difficulty hints)
6. Persist to `daily_queues` table (stable for the day)

### OLT Topic Scores

| Score | Topics                                           |
| ----- | ------------------------------------------------ |
| 10    | Dynamic Programming, Graphs                      |
| 9     | DFS, BFS, Trees, Binary Search                   |
| 8     | Two Pointers, Sliding Window, Backtracking, Heap |
| 7     | Arrays, Stack, Hash Table, Greedy                |
| 6     | String, Linked List, Union-Find                  |
| 5     | Trie, Bit Manipulation, Prefix Sum               |

---

## Local Setup

### Prerequisites

- Node.js ≥ 18 (v24 recommended)
- A [Supabase](https://supabase.com) project

### 1. Clone & install

```bash
git clone https://github.com/vedant-asati/dsa-tracker
cd dsa-tracker
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
# Fill in your Supabase URL and keys
```

### 3. Create Supabase schema

Run the SQL below in **Supabase → SQL Editor**:

```sql
CREATE TABLE problems (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  title_slug  TEXT NOT NULL UNIQUE,
  difficulty  TEXT NOT NULL CHECK (difficulty IN ('EASY','MEDIUM','HARD')),
  topic_tags  TEXT[] NOT NULL,
  description TEXT,
  ac_rate     FLOAT,
  paid_only   BOOLEAN DEFAULT FALSE,
  olt_score   INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_problems_difficulty ON problems(difficulty);
CREATE INDEX idx_problems_topic_tags ON problems USING GIN(topic_tags);

CREATE TABLE user_progress (
  problem_id INTEGER PRIMARY KEY REFERENCES problems(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'TO_DO'
             CHECK (status IN ('TO_DO','ATTEMPTED','DEBUGGING','SOLVED')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE daily_queues (
  date        DATE PRIMARY KEY,
  problem_ids INTEGER[] NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE VIEW problems_with_status AS
  SELECT p.*, COALESCE(up.status,'TO_DO') AS status, up.updated_at AS status_updated_at
  FROM problems p
  LEFT JOIN user_progress up ON p.id = up.problem_id;
```

### 4. Seed the database

Put your LeetCode export JSON files in `data/` (format: `{"data":{"problemsetQuestionListV2":{"questions":[...]}}}`), then:

```bash
export $(grep -v '^#' .env.local | xargs)
npx tsx scripts/seed.ts
```

The seed script:

- Deduplicates problems across all JSON files
- Filters to free, non-database, OLT-relevant problems
- Fetches descriptions from `leetcode.ca/all/{id}.html`
- Computes OLT scores
- Upserts everything to Supabase in batches of 20

### 5. Run locally

```bash
npm run dev
# Open http://localhost:3000
```

---

## Deployment (Vercel)

1. Push to GitHub
2. Import at [vercel.com/new](https://vercel.com/new)
3. Add the 3 env vars from `.env.example`
4. Deploy

---

## Extending

| Feature               | Where to change                                     |
| --------------------- | --------------------------------------------------- |
| Daily problem count   | `config/queue.ts` → `dailyCount`                    |
| Difficulty split      | `config/queue.ts` → `hardCount / mediumCount`       |
| Add/remove OLT topics | `config/topics.ts`                                  |
| Add more problems     | Drop new JSON in `data/` → re-run `scripts/seed.ts` |
| Add user auth         | Supabase Auth + RLS policies                        |
