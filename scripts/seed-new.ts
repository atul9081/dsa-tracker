/**
 * scripts/seed-new.ts
 *
 * Seeds net-new LeetCode problems from data/merged.json into Supabase.
 * Deduplicates against what already exists in DB.
 * Only free problems with OLT tags are inserted.
 *
 * Run:          source .env.local && npx tsx scripts/seed-new.ts
 * Dry-run:      source .env.local && npx tsx scripts/seed-new.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DRY_RUN       = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars. Run: source .env.local && npx tsx scripts/seed-new.ts');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// OLT topic score map (keep in sync with config/topics.ts)
const TOPIC_SCORE_MAP: Record<string, number> = {
  'dynamic-programming':   10,
  'graph':                 10,
  'depth-first-search':     9,
  'breadth-first-search':   9,
  'tree':                   8,
  'binary-search':          8,
  'two-pointers':           7,
  'sliding-window':         7,
  'backtracking':           7,
  'heap-priority-queue':    7,
  'array':                  6,
  'stack':                  6,
  'hash-table':             6,
  'greedy':                 6,
  'string':                 5,
  'linked-list':            5,
  'union-find':             6,
  'trie':                   5,
  'bit-manipulation':       5,
  'prefix-sum':             5,
};

function getPrimaryTopic(tags: string[]): string {
  let best = '';
  let bestScore = -1;
  for (const t of tags) {
    const s = TOPIC_SCORE_MAP[t] ?? 0;
    if (s > bestScore) { bestScore = s; best = t; }
  }
  return best;
}

function getOltScore(tags: string[]): number {
  return Math.max(...tags.map(t => TOPIC_SCORE_MAP[t] ?? 0), 0);
}

interface MergedProblem {
  questionFrontendId: string;
  title: string;
  titleSlug: string;
  difficulty: string;
  paidOnly: boolean;
  topicTags: Array<{ slug: string }>;
  acRate: number | null;
}

async function main() {
  const mergedPath = path.join(process.cwd(), 'data', 'merged.json');
  if (!fs.existsSync(mergedPath)) {
    console.error('data/merged.json not found. Run parse-new-data.ts first.');
    process.exit(1);
  }
  const merged: MergedProblem[] = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
  console.log(`Loaded ${merged.length} problems from merged.json`);

  // Fetch existing problem IDs from DB
  const { data: existingRows, error } = await supabase
    .from('problems')
    .select('id');
  if (error) { console.error('Failed to fetch existing problems:', error); process.exit(1); }

  const existingIds = new Set((existingRows ?? []).map((r: { id: number }) => r.id));
  console.log(`Existing in DB: ${existingIds.size} problems`);

  // Build rows to insert
  const toInsert = [];
  for (const p of merged) {
    const id = parseInt(p.questionFrontendId);
    if (existingIds.has(id)) continue;

    const tags = p.topicTags.map(t => t.slug);
    const oltScore = getOltScore(tags);
    if (oltScore === 0) continue; // no OLT tag — skip

    toInsert.push({
      id,
      title:       p.title,
      title_slug:  p.titleSlug,
      difficulty:  p.difficulty.toUpperCase(),
      topic_tags:  tags,
      ac_rate:     p.acRate,
      paid_only:   false,
      olt_score:   oltScore,
      source:      'leetcode',
    });
  }

  console.log(`\nNew problems to insert: ${toInsert.length}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] First 10 would be inserted:');
    toInsert.slice(0, 10).forEach(p => console.log(`  #${p.id} ${p.title} [${p.difficulty}] olt=${p.olt_score}`));
    const diffStats = toInsert.reduce((a, p) => { a[p.difficulty] = (a[p.difficulty] || 0) + 1; return a; }, {} as Record<string, number>);
    console.log('\nDifficulty split:', diffStats);
    return;
  }

  // Insert in batches of 500 (Supabase limit)
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error: insertErr } = await supabase.from('problems').insert(batch);
    if (insertErr) {
      console.error(`Error inserting batch ${Math.floor(i/BATCH)+1}:`, insertErr);
    } else {
      inserted += batch.length;
      process.stdout.write(`\rInserted: ${inserted}/${toInsert.length}`);
    }
  }

  console.log(`\n\nDone! Inserted ${inserted} new problems.`);
}

main().catch(err => { console.error(err); process.exit(1); });
