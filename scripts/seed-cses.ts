/**
 * scripts/seed-cses.ts
 *
 * Seeds CSES problems from data/cses-parsed.json into Supabase problems table.
 * Sets source='cses', external_url, sub_type from the parsed data.
 *
 * CSES problems use negative IDs (e.g., -1068 for CSES task 1068) to avoid
 * colliding with LeetCode problem IDs (which are positive integers).
 *
 * Run:      source .env.local && npx tsx scripts/seed-cses.ts
 * Dry-run:  source .env.local && npx tsx scripts/seed-cses.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Auto-load .env.local (no need to `source` before running)
for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.trim().match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const val = m[2].replace(/^['"]|['"]$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
  break;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DRY_RUN      = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars. Run: source .env.local && npx tsx scripts/seed-cses.ts');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// OLT score map (keep in sync with config/topics.ts)
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

interface CSESParsed {
  cses_id: number | null;
  title: string;
  difficulty: string;
  priority: string;
  section: string;
  olt_topic: string;
  sub_type: string;
  external_url: string | null;
  source: string;
  topic_tags: string[];
}

async function main() {
  const parsedPath = path.join(process.cwd(), 'data', 'cses-parsed.json');
  if (!fs.existsSync(parsedPath)) {
    console.error('data/cses-parsed.json not found. Run parse-cses.ts first.');
    process.exit(1);
  }

  const parsed: CSESParsed[] = JSON.parse(fs.readFileSync(parsedPath, 'utf8'));
  console.log(`Loaded ${parsed.length} CSES problems`);

  const noId = parsed.filter(p => !p.cses_id);
  if (noId.length > 0) {
    console.warn(`⚠️  ${noId.length} problems have no CSES ID:`, noId.map(p => p.title).slice(0, 5));
  }

  // Build DB rows
  // Use negative CSES task ID as the internal problem ID to avoid collision with LC IDs.
  const rows = parsed
    .filter(p => p.cses_id) // only problems with resolved IDs
    .map(p => ({
      id:           -(p.cses_id!),           // negative = CSES namespace
      title:        p.title,
      title_slug:   p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      difficulty:   p.difficulty,
      topic_tags:   p.topic_tags,
      description:  null,                    // CSES has no cached description
      ac_rate:      null,
      paid_only:    false,
      olt_score:    TOPIC_SCORE_MAP[p.olt_topic] ?? 5,
      sub_type:     p.sub_type || null,
      source:       'cses',
      external_url: p.external_url,
    }));

  console.log(`\nRows to insert: ${rows.length}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] First 10:');
    rows.slice(0, 10).forEach(r =>
      console.log(`  #${r.id} "${r.title}" [${r.difficulty}] ${r.sub_type} → ${r.external_url}`)
    );
    const diffStats = rows.reduce((a, r) => { a[r.difficulty] = (a[r.difficulty] || 0) + 1; return a; }, {} as Record<string, number>);
    console.log('\nDifficulty:', diffStats);
    return;
  }

  // Upsert (idempotent — safe to run multiple times)
  const BATCH = 100;
  let upserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('problems')
      .upsert(batch, { onConflict: 'id' });

    if (error) {
      console.error(`Error in batch ${Math.floor(i/BATCH)+1}:`, error);
    } else {
      upserted += batch.length;
      process.stdout.write(`\rUpserted: ${upserted}/${rows.length}`);
    }
  }

  console.log(`\n\nDone! Upserted ${upserted} CSES problems.`);
}

main().catch(err => { console.error(err); process.exit(1); });
