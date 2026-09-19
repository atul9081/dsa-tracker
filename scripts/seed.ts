/**
 * Seed script: reads local JSON data files → fetches descriptions from leetcode.ca
 * → upserts everything into Supabase.
 *
 * Run: npx tsx scripts/seed.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// ── env ──────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Run: source .env.local && npx tsx scripts/seed.ts');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── OLT scoring ───────────────────────────────────────────────────────────────
const TOPIC_SCORE_MAP: Record<string, number> = {
  'dynamic-programming':  10,
  'graph':                10,
  'depth-first-search':    9,
  'breadth-first-search':  9,
  'tree':                  9,
  'binary-search':         9,
  'two-pointers':          8,
  'sliding-window':        8,
  'backtracking':          8,
  'heap-priority-queue':   8,
  'array':                 7,
  'stack':                 7,
  'hash-table':            7,
  'greedy':                7,
  'string':                6,
  'linked-list':           6,
  'union-find':            6,
  'trie':                  5,
  'bit-manipulation':      5,
  'prefix-sum':            5,
};

const OLT_SLUGS = new Set(Object.keys(TOPIC_SCORE_MAP));

// ── types ─────────────────────────────────────────────────────────────────────
interface LCQuestion {
  id: number;
  questionFrontendId: string;
  title: string;
  titleSlug: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  paidOnly: boolean;
  status: string | null;
  acRate: number | null;
  topicTags: { name: string; slug: string }[];
}

interface ProblemRow {
  id: number;
  title: string;
  title_slug: string;
  difficulty: string;
  topic_tags: string[];
  description: string | null;
  ac_rate: number | null;
  paid_only: boolean;
  olt_score: number;
}

interface ProgressRow {
  problem_id: number;
  status: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchDescription(frontendId: string): Promise<string | null> {
  try {
    const url = `https://leetcode.ca/all/${frontendId}.html`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DSA-Tracker-Seed/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Extract the markdown-body div content
    const match = html.match(/<div[^>]*class="[^"]*markdown-body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div>/i);
    if (!match) return null;
    return match[1].trim();
  } catch {
    return null;
  }
}

// ── load local JSON data ───────────────────────────────────────────────────────
function loadAllQuestions(): Map<string, LCQuestion> {
  const dataDir = path.join(process.cwd(), 'data');
  const rootDir = process.cwd();

  const files = [
    ...fs.readdirSync(dataDir).map(f => path.join(dataDir, f)),
    path.join(rootDir, 'json-data.json'),
    // json-data-2.json is a duplicate of data/2.json — skip
  ];

  const map = new Map<string, LCQuestion>();

  for (const file of files) {
    if (!file.endsWith('.json') || !fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const questions: LCQuestion[] = raw?.data?.problemsetQuestionListV2?.questions ?? [];
      for (const q of questions) {
        const key = q.questionFrontendId;
        if (!map.has(key)) map.set(key, q);
      }
    } catch (e) {
      console.warn(`Failed to parse ${file}:`, e);
    }
  }

  return map;
}

// ── filter questions ──────────────────────────────────────────────────────────
function filterQuestions(all: Map<string, LCQuestion>): LCQuestion[] {
  return Array.from(all.values()).filter(q => {
    if (q.paidOnly) return false;
    const slugs = q.topicTags.map(t => t.slug);
    if (slugs.includes('database')) return false;
    // Keep if it has at least one OLT-relevant topic
    return slugs.some(s => OLT_SLUGS.has(s));
  });
}

// ── compute olt_score ─────────────────────────────────────────────────────────
function computeOltScore(topicTags: { slug: string }[]): number {
  let max = 0;
  for (const tag of topicTags) {
    const score = TOPIC_SCORE_MAP[tag.slug] ?? 0;
    if (score > max) max = score;
  }
  return max;
}

// ── batch upsert ──────────────────────────────────────────────────────────────
async function upsertBatch(rows: ProblemRow[]) {
  const { error } = await supabase.from('problems').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
}

async function upsertProgressBatch(rows: ProgressRow[]) {
  const { error } = await supabase.from('user_progress').upsert(rows, { onConflict: 'problem_id' });
  if (error) throw error;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('📂 Loading questions from local JSON files...');
  const allMap = loadAllQuestions();
  console.log(`   Total unique questions loaded: ${allMap.size}`);

  const filtered = filterQuestions(allMap);
  console.log(`   After filtering (free + non-DB + OLT-relevant): ${filtered.length}`);

  const problemRows: ProblemRow[] = [];
  const progressRows: ProgressRow[] = [];

  let fetched = 0;
  let failed  = 0;

  console.log('\n🌐 Fetching descriptions from leetcode.ca...');

  for (let i = 0; i < filtered.length; i++) {
    const q = filtered[i];
    const olt_score = computeOltScore(q.topicTags);
    const topic_tags = q.topicTags.map(t => t.slug);

    // Fetch description
    const description = await fetchDescription(q.questionFrontendId);
    if (description) fetched++; else failed++;

    problemRows.push({
      id:          parseInt(q.questionFrontendId, 10),
      title:       q.title,
      title_slug:  q.titleSlug,
      difficulty:  q.difficulty,
      topic_tags,
      description,
      ac_rate:     q.acRate ?? null,
      paid_only:   q.paidOnly,
      olt_score,
    });

    // Seed progress for SOLVED / ATTEMPTED
    const status = q.status?.toUpperCase();
    if (status === 'SOLVED' || status === 'ATTEMPTED') {
      progressRows.push({
        problem_id: parseInt(q.questionFrontendId, 10),
        status,
      });
    }

    if ((i + 1) % 10 === 0 || i === filtered.length - 1) {
      process.stdout.write(`\r   Progress: ${i + 1}/${filtered.length} | ✅ ${fetched} descriptions | ❌ ${failed} failed`);
    }

    await sleep(200); // polite delay for leetcode.ca
  }

  console.log('\n\n💾 Upserting to Supabase...');
  const BATCH = 20;
  for (let i = 0; i < problemRows.length; i += BATCH) {
    const batch = problemRows.slice(i, i + BATCH);
    await upsertBatch(batch);
    console.log(`   Problems: ${Math.min(i + BATCH, problemRows.length)}/${problemRows.length}`);
  }

  if (progressRows.length > 0) {
    console.log(`\n📊 Seeding ${progressRows.length} progress rows (SOLVED/ATTEMPTED)...`);
    for (let i = 0; i < progressRows.length; i += BATCH) {
      await upsertProgressBatch(progressRows.slice(i, i + BATCH));
    }
  }

  console.log(`\n✅ Seed complete!`);
  console.log(`   Problems inserted: ${problemRows.length}`);
  console.log(`   Progress rows:     ${progressRows.length}`);
  console.log(`   Descriptions:      ${fetched} fetched, ${failed} null (will show LC link only)`);
}

main().catch(err => {
  console.error('\n❌ Seed failed:', err);
  process.exit(1);
});
