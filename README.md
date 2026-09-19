# ⚡ DSA Tracker

A **blind-mode** LeetCode practice tracker built for placement OLT prep. Problems hide their difficulty and topic tags until you mark them — keeping your practice honest and exam-realistic.

**Live:** [dsa-tracker-pi-six.vercel.app](https://dsa-tracker-pi-six.vercel.app)

---

## Why

On LeetCode, the difficulty label and topic tags are visible before you even read the problem. Knowing a problem is tagged "Dynamic Programming" or is "Hard" changes how you approach it — defeating the point of blind practice.

This tracker hides all that. You see the problem statement. You think. You solve. Only after marking it solved do the tags and difficulty reveal.

---

## Features

- **🔒 Blind Mode** — difficulty and topics hidden; revealed only on Solved
- **📅 Daily Queue** — 5 weighted-random problems/day (2 Hard + 3 Medium), stable for the day, regeneratable on demand
- **📋 Problem List** — filterable table (status · difficulty · topic · search) across all 570 problems
- **📊 Analytics** — stat cards, difficulty/topic progress bars, SVG donut chart
- **🔄 Status Flow** — `To-Do` → `Attempting` → `Solved`
  - Clicking "Open on LeetCode" auto-sets Attempting and collapses the card to title-only
  - Solved reveals difficulty + topics in an expandable accordion
- **👥 Multi-user** — Supabase Auth (Google OAuth + email), per-user isolated progress and queues

## Stack

| Layer     | Tech                                 |
| --------- | ------------------------------------ |
| Framework | Next.js 14 (App Router, TypeScript)  |
| Database  | Supabase (Postgres + Auth + RLS)     |
| Styling   | Vanilla CSS (dark theme, Inter font) |
| Hosting   | Vercel                               |

---

## Project Structure

```
dsa-tracker/
├── app/
│   ├── page.tsx                  # / → Daily Queue
│   ├── login/page.tsx            # /login → Auth (Google + email)
│   ├── auth/callback/route.ts    # OAuth callback handler
│   ├── problems/page.tsx         # /problems → Filterable list
│   ├── analytics/page.tsx        # /analytics → Stats & charts
│   └── api/
│       ├── queue/route.ts        # GET today's queue + POST regenerate
│       └── progress/route.ts     # POST update status
├── components/
│   ├── ProblemCard.tsx           # Blind card with 3-state reveal logic
│   ├── ProblemRow.tsx            # Table row for /problems
│   ├── Navbar.tsx                # Nav + user email + sign out
│   ├── StatusBadge.tsx
│   ├── DifficultyBadge.tsx
│   └── TopicTags.tsx
├── config/
│   ├── topics.ts                 # OLT topics + relevance scores (1–10)
│   └── queue.ts                  # Daily count, difficulty split, weights
├── lib/
│   ├── supabase-server.ts        # Session-aware client (API routes)
│   ├── supabase-admin.ts         # Service role client (seed only)
│   └── supabase-browser.ts       # Anon client (client components)
├── middleware.ts                  # Auth guard — redirects to /login
├── scripts/
│   └── seed.ts                   # One-time seed: local JSONs + leetcode.ca
├── types/index.ts
└── data/                         # Raw LeetCode export JSONs (gitignored)
```

---

## Queue Algorithm

1. Pull all unsolved free problems from `problems_with_status` (per-user via RLS)
2. Split into difficulty buckets
3. **Weighted random sample** within each bucket: `weight = olt_score² × difficulty_multiplier`
4. Pick 2 Hard + 3 Medium (fallback to next difficulty if exhausted)
5. Shuffle the 5 cards (hides position-based difficulty hints)
6. Persist to `daily_queues` (stable for the day, per user)

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

- Node.js ≥ 18
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
# Fill in your Supabase URL, anon key, and service role key
```

### 3. Create Supabase schema

Run in **Supabase → SQL Editor**:

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
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  user_id    UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status     TEXT    NOT NULL DEFAULT 'TO_DO'
             CHECK (status IN ('TO_DO','ATTEMPTING','SOLVED')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (problem_id, user_id)
);

CREATE TABLE daily_queues (
  date        DATE    NOT NULL,
  user_id     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_ids INTEGER[] NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (date, user_id)
);

-- Per-user view using auth.uid()
CREATE VIEW problems_with_status AS
  SELECT p.*, COALESCE(up.status,'TO_DO') AS status, up.updated_at AS status_updated_at
  FROM problems p
  LEFT JOIN user_progress up ON p.id = up.problem_id AND up.user_id = auth.uid();

-- RLS
ALTER TABLE problems      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_queues  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "problems_read" ON problems      FOR SELECT USING (true);
CREATE POLICY "own_progress"  ON user_progress USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_queues"    ON daily_queues  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```

### 4. Enable Google OAuth (optional)

1. [Google Cloud Console](https://console.cloud.google.com) → Credentials → Create OAuth 2.0 Client
   - Redirect URI: `https://<your-supabase-ref>.supabase.co/auth/v1/callback`
2. Supabase → Auth → Providers → Google → paste Client ID + Secret → Enable
3. Supabase → Auth → URL Configuration → set Site URL + add redirect URL

### 5. Seed the database

Put your LeetCode export JSON files in `data/` then:

```bash
export $(grep -v '^#' .env.local | xargs)
npx tsx scripts/seed.ts
```

The seed script deduplicates, filters to free OLT-relevant problems, scrapes descriptions from [leetcode.ca](https://leetcode.ca), computes OLT scores, and upserts in batches.

### 6. Run locally

```bash
npm run dev
# Open http://localhost:3000
```

---

## Deployment (Vercel)

1. Push to GitHub
2. Import at [vercel.com/new](https://vercel.com/new)
3. Add env vars from `.env.example`
4. Deploy

---

## Extending

| Feature             | Where to change                                     |
| ------------------- | --------------------------------------------------- |
| Daily problem count | `config/queue.ts` → `dailyCount`                    |
| Difficulty split    | `config/queue.ts` → `hardCount / mediumCount`       |
| OLT topics          | `config/topics.ts`                                  |
| Add more problems   | Drop new JSON in `data/` → re-run `scripts/seed.ts` |

---

## License

MIT
