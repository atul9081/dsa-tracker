# Plan Review — Final Status (Ready for Execution)

## Environment — CONFIRMED ✅

| Item | Value |
|------|-------|
| **Node.js** | v24.21.0 (LTS/Krypton via nvm) |
| **npm** | v11.19.0 |
| **Supabase Project ID** | `tplobtaerdrcjlhidrrz` |
| **Supabase URL** | `https://tplobtaerdrcjlhidrrz.supabase.co` |
| **Supabase Anon Key** | from `.env` (`anon=eyJ...`) |
| **Supabase Service Role** | from `.env` (`service_role=eyJ...`) |
| **LeetCode Session** | in `fetch_context.txt` (not needed for seeding) |

---

## Data Inventory — CONFIRMED ✅

| Source | Questions | Unique new |
|--------|-----------|-----------|
| `data/1.json` | 100 HARD | 100 |
| `data/2.json` – `data/8.json` | 700 (MEDIUM + mixed) | 619 |
| `json-data.json` | 100 (DP-filtered) | 7 |
| `json-data-2.json` | duplicate of `data/2.json` | 0 (skip) |
| **Total unique** | | **726** |

After filtering (free + non-DB + OLT-relevant):

| Difficulty | Count | Solved | Unsolved |
|-----------|-------|--------|----------|
| HARD | 76 | 2 | 74 |
| MEDIUM | 470 | 33 | 437 |
| EASY | 24 | 0 | 24 |
| **Total** | **570** | **35** | **535** |

> 535 unsolved at 4/day = **~134 days** of unique practice. ✅

---

## Issues Resolved

### ✅ Issue 1: Problem descriptions — SOLVED via leetcode.ca
`https://leetcode.ca/all/{questionFrontendId}.html` returns full problem description in a clean `<div class="markdown-body">` block with **no topic tags shown** (perfect for blind mode). URL pattern confirmed working for IDs 42, 565, etc. Seed script will scrape this during setup.

### ✅ Issue 2: Difficulty skew — accepted
76 Hard is enough for ~37 days; queue falls back to Medium automatically.

### ✅ Issue 3: Partial data — accepted
570 problems = 134 days, more than sufficient for OLT prep. Can re-fetch more later.

### ✅ Issue 4: Seed script simplified
Reads local JSON files only for metadata → fetches descriptions from leetcode.ca → upserts to Supabase. No LC API, no auth required.

### ✅ Issue 5: json-data-2.json is a duplicate — skip it

---

## Final Build Approach

| What | Decision |
|------|---------|
| **Description source** | Scrape `leetcode.ca/all/{id}.html` during seed |
| **Blind cards** | Show title + description + constraints; hide difficulty + topics until status is set |
| **Seed script** | Read local JSONs → fetch leetcode.ca → upsert Supabase |
| **Charts** | Pure CSS (no charting lib) |
| **Auth** | None (single-user personal tool) |
| **Env file** | `.env.local` with keys from existing `.env` |
| **Node version** | v24.21.0 (current, already active) |

---

## .env.local Template (ready to write)

```env
NEXT_PUBLIC_SUPABASE_URL=https://tplobtaerdrcjlhidrrz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwbG9idGFlcmRyY2psaGlkcnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3ODM0MDgsImV4cCI6MjEwNTM1OTQwOH0.qXynML-kkON8l0yzQMEzRUUwW4piYL219te84cRcgVM
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwbG9idGFlcmRyY2psaGlkcnJ6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTc4MzQwOCwiZXhwIjoyMTA1MzU5NDA4fQ.ZNQKb2QZZE8GPa3MambDax4oT6__bJRCyKUKITU1GD0
```

> [!CAUTION]
> Do NOT commit `.env.local` to git. Add it to `.gitignore` immediately after creation.

---

## Pre-execution Status

- [x] Node.js v24.21.0 confirmed
- [x] npm v11.19.0 confirmed  
- [x] Supabase project exists (`tplobtaerdrcjlhidrrz`)
- [x] Supabase keys extracted from `.env`
- [x] Supabase SQL schema ready to run
- [x] Description strategy confirmed (leetcode.ca scraping)
- [x] Data files confirmed (570 usable problems)
- [ ] **Run Supabase SQL schema** (you paste into Supabase dashboard before seeding)
- [ ] **Scaffold Next.js + build app**
- [ ] **Run seed script**
- [ ] **Deploy to Vercel**

**→ READY TO EXECUTE**
