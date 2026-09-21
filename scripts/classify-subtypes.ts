/**
 * scripts/classify-subtypes.ts  (Source 3 — Gemini)
 *
 * Classifies problems that still have source='pending' after Source 1.
 * Uses Gemini API in batches of 25. Supports:
 *   - Resumable progress (data/subtypes-progress.json checkpoint every 50 batches)
 *   - Pass 2 retry for any failed/invalid responses
 *   - Pass 3 force-assign using keyword similarity for still-unresolved problems
 *   - Dumps unresolvable problems to data/manual-review.json
 *
 * Requires:
 *   GEMINI_API_KEY (or GEMINI_API_KEY_2 for second key — alternates keys)
 *
 * Run: npx tsx scripts/classify-subtypes.ts
 * Run (resume): npx tsx scripts/classify-subtypes.ts --resume
 * Run (pass2 only): npx tsx scripts/classify-subtypes.ts --pass2
 * Run (pass3 only): npx tsx scripts/classify-subtypes.ts --pass3
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

const BATCH_SIZE   = 25;
const RPM_LIMIT    = 14;          // requests/min per key (keep under 15)
const CHECKPOINT_EVERY = 50;      // save progress every N batches
const MIN_DELAY_MS = Math.ceil(60_000 / RPM_LIMIT); // ~4286ms

const GEMINI_API_KEY  = process.env.GEMINI_API_KEY  ?? '';
const GEMINI_API_KEY2 = process.env.GEMINI_API_KEY_2 ?? '';
const API_KEYS = [GEMINI_API_KEY, GEMINI_API_KEY2].filter(Boolean);

if (API_KEYS.length === 0) {
  console.error('No Gemini API key found. Set GEMINI_API_KEY in .env.local.');
  process.exit(1);
}

const GEMINI_MODEL = 'gemini-2.0-flash-lite';
const GEMINI_URL   = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

// ── Taxonomy (must match config/subtypes.ts exactly) ─────────────────────────

const TAXONOMY: Record<string, string[]> = {
  'dynamic-programming':  ['1d-dp','knapsack','subsequences','interval-dp','tree-dp','digit-dp','game-dp','bitmask-dp'],
  'graph':                ['bfs','dfs','topological-sort','sssp','mst','scc'],
  'depth-first-search':   ['tree-traversal','backtracking-dfs','grid-dfs','cycle-detection'],
  'breadth-first-search': ['grid-bfs','multi-source-bfs','level-order'],
  'tree':                 ['traversal','path-problems','lca','construction','bst','segment-tree'],
  'binary-search':        ['classic-search','search-on-answer','boundary-search'],
  'two-pointers':         ['opposite-ends','fast-slow','merge-style'],
  'sliding-window':       ['fixed-size','variable-size','at-most-k'],
  'backtracking':         ['permutations','combinations','constraint-search'],
  'heap-priority-queue':  ['top-k','merge-streams','scheduling'],
  'array':                ['prefix-suffix','sorting-tricks','matrix','intervals'],
  'stack':                ['monotonic-stack','bracket-matching','calculator'],
  'hash-table':           ['frequency-count','two-sum-style','design'],
  'greedy':               ['interval-scheduling','jump-game','sequence-construction'],
  'string':               ['pattern-matching','palindromes','anagram-sliding'],
  'linked-list':          ['reversal','two-pointer-list','reorder'],
  'union-find':           ['basic-connectivity','weighted-union','grid-union'],
  'trie':                 ['prefix-search','bitmask-trie'],
  'bit-manipulation':     ['xor-tricks','counting-bits','subset-bitmask'],
  'prefix-sum':           ['1d-prefix','2d-prefix'],
};

const ALL_SUBTYPES = new Set<string>(Object.values(TAXONOMY).flat());

// ── Paths ─────────────────────────────────────────────────────────────────────

const S1_PATH        = path.join(process.cwd(), 'data', 'subtypes-s1.json');
const PROGRESS_PATH  = path.join(process.cwd(), 'data', 'subtypes-progress.json');
const FINAL_PATH     = path.join(process.cwd(), 'data', 'subtypes-final.json');
const MANUAL_PATH    = path.join(process.cwd(), 'data', 'manual-review.json');
const MERGED_PATH    = path.join(process.cwd(), 'data', 'merged.json');

// ── Types ─────────────────────────────────────────────────────────────────────

interface SubtypeEntry {
  oltTopic: string;
  subtype: string;
  source: string;
}

interface PendingProblem {
  id: string;
  title: string;
  oltTopic: string;
  tags: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let keyIdx = 0;
function nextKey(): string {
  const key = API_KEYS[keyIdx % API_KEYS.length];
  keyIdx++;
  return key;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGemini(prompt: string, key: string): Promise<string> {
  const res = await fetch(GEMINI_URL(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

function buildPrompt(batch: PendingProblem[], strict = false): string {
  const taxStr = JSON.stringify(TAXONOMY);
  const strictNote = strict
    ? 'STRICT MODE: You must classify every problem. If unsure, pick the closest sub-type from the taxonomy.'
    : '';
  return `You are a competitive programming expert. Classify each LeetCode problem into EXACTLY one sub-type from the taxonomy below.

TAXONOMY:
${taxStr}

RULES:
1. The sub-type must belong to the problem's oltTopic.
2. Pick the MOST SPECIFIC matching sub-type.
3. If ambiguous, pick the more fundamental one.
4. Reply ONLY with a JSON array (no markdown fences): [{"id":"...","subtype":"..."},...]
${strictNote}

PROBLEMS:
${JSON.stringify(batch.map(p => ({ id: p.id, title: p.title, oltTopic: p.oltTopic, tags: p.tags })))}`;
}

function parseBatchResponse(text: string): Array<{ id: string; subtype: string }> {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  try {
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (x): x is { id: string; subtype: string } =>
        typeof x.id === 'string' && typeof x.subtype === 'string'
    );
  } catch {
    return [];
  }
}

/** Keyword-similarity force-assign (pass 3) */
function forceAssign(problem: PendingProblem): string | null {
  const haystack = `${problem.title} ${problem.tags.join(' ')}`.toLowerCase();
  const subtypes = TAXONOMY[problem.oltTopic] ?? [];

  let best = '';
  let bestScore = 0;

  for (const st of subtypes) {
    const keywords = st.split('-');
    const score = keywords.reduce((acc, kw) => acc + (haystack.includes(kw) ? 1 : 0), 0);
    const norm = score / keywords.length;
    if (norm > bestScore) { bestScore = norm; best = st; }
  }

  // Use first sub-type as absolute fallback
  return bestScore > 0 ? best : (subtypes[0] ?? null);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const resume  = args.includes('--resume');
  const pass2   = args.includes('--pass2');
  const pass3   = args.includes('--pass3');

  if (!fs.existsSync(S1_PATH)) {
    console.error('data/subtypes-s1.json not found. Run map-lc-tags.ts first.');
    process.exit(1);
  }

  const merged: Array<{ questionFrontendId: string; title: string; topicTags: Array<{ slug: string }> }> =
    JSON.parse(fs.readFileSync(MERGED_PATH, 'utf8'));
  const titleMap = new Map(merged.map(p => [p.questionFrontendId, p.title]));
  const tagsMap  = new Map(merged.map(p => [p.questionFrontendId, p.topicTags.map(t => t.slug)]));

  // Load S1 results (base)
  const s1: Record<string, SubtypeEntry> = JSON.parse(fs.readFileSync(S1_PATH, 'utf8'));

  // Load progress checkpoint if resuming
  let progress: Record<string, SubtypeEntry> = {};
  if ((resume || pass2 || pass3) && fs.existsSync(PROGRESS_PATH)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
    console.log(`Loaded checkpoint: ${Object.keys(progress).length} already classified`);
  }

  // Merge S1 + progress
  const current: Record<string, SubtypeEntry> = { ...s1, ...progress };

  if (pass3) {
    // Pass 3: force-assign anything still missing/invalid subtype
    let forced = 0;
    const manualReview: Array<{ id: string; title: string; oltTopic: string; reason: string }> = [];

    for (const [id, entry] of Object.entries(current)) {
      if (entry.subtype && ALL_SUBTYPES.has(entry.subtype)) continue;

      const problem: PendingProblem = {
        id,
        title: titleMap.get(id) ?? id,
        oltTopic: entry.oltTopic,
        tags: tagsMap.get(id) ?? [],
      };
      const assigned = forceAssign(problem);
      if (assigned) {
        current[id] = { ...entry, subtype: assigned, source: 'pass3-force' };
        forced++;
      } else {
        manualReview.push({ id, title: problem.title, oltTopic: entry.oltTopic, reason: 'no-keyword-match' });
      }
    }

    if (manualReview.length > 0) {
      fs.writeFileSync(MANUAL_PATH, JSON.stringify(manualReview, null, 2));
      console.log(`⚠️  ${manualReview.length} problems need manual review → ${MANUAL_PATH}`);
    }

    fs.writeFileSync(FINAL_PATH, JSON.stringify(current, null, 2));
    console.log(`Pass 3 done: ${forced} force-assigned. Total: ${Object.keys(current).length}`);
    return;
  }

  // Build pending list (pass 1 = pending source, pass 2 = invalid subtype from prev run)
  const pending: PendingProblem[] = [];
  for (const [id, entry] of Object.entries(current)) {
    const needsClassify = pass2
      ? entry.source !== 's1' && (!entry.subtype || !ALL_SUBTYPES.has(entry.subtype))
      : entry.source === 'pending';

    if (needsClassify) {
      pending.push({
        id,
        title: titleMap.get(id) ?? id,
        oltTopic: entry.oltTopic,
        tags: tagsMap.get(id) ?? [],
      });
    }
  }

  if (pending.length === 0) {
    console.log('Nothing to classify. All problems already have subtypes.');
    fs.writeFileSync(FINAL_PATH, JSON.stringify(current, null, 2));
    return;
  }

  const total = pending.length;
  const batches = Math.ceil(total / BATCH_SIZE);
  console.log(`\nClassifying ${total} problems in ${batches} batches of ${BATCH_SIZE}...`);
  console.log(`Keys: ${API_KEYS.length} × ${RPM_LIMIT} RPM = ${API_KEYS.length * RPM_LIMIT} RPM effective\n`);

  let batchesDone = 0;
  let classified  = 0;
  let failed      = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const key = nextKey();

    process.stdout.write(`Batch ${batchNum}/${batches}...`);

    try {
      const start = Date.now();
      const prompt = buildPrompt(batch, pass2);
      const text   = await callGemini(prompt, key);
      const results = parseBatchResponse(text);

      // Validate and apply results
      let batchOk = 0;
      for (const r of results) {
        if (!r.id || !r.subtype) continue;
        const entry = current[r.id];
        if (!entry) continue;
        if (!ALL_SUBTYPES.has(r.subtype)) {
          // Try to match by partial name (e.g. Gemini returns "dp-1d" instead of "1d-dp")
          const canonical = [...ALL_SUBTYPES].find(
            st => st.replace(/-/g, '') === r.subtype.replace(/-/g, '')
          );
          if (canonical) {
            current[r.id] = { ...entry, subtype: canonical, source: pass2 ? 'pass2' : 'gemini' };
            batchOk++;
          } else {
            // Invalid — leave as pending, will be caught in pass2/pass3
            failed++;
          }
        } else {
          current[r.id] = { ...entry, subtype: r.subtype, source: pass2 ? 'pass2' : 'gemini' };
          batchOk++;
        }
      }

      classified += batchOk;
      process.stdout.write(` ✓ ${batchOk}/${batch.length} ok\n`);

      batchesDone++;
      if (batchesDone % CHECKPOINT_EVERY === 0) {
        fs.writeFileSync(PROGRESS_PATH, JSON.stringify(current, null, 2));
        console.log(`  [checkpoint saved at batch ${batchNum}]`);
      }

      // Rate limiting — wait for remaining time in the per-request window
      const elapsed = Date.now() - start;
      const wait    = Math.max(0, MIN_DELAY_MS - elapsed);
      if (wait > 0) await sleep(wait);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(` ✗ ERROR: ${msg.slice(0, 80)}\n`);
      failed++;
      await sleep(MIN_DELAY_MS * 2); // back-off on error
    }
  }

  // Save final checkpoint
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(current, null, 2));
  fs.writeFileSync(FINAL_PATH, JSON.stringify(current, null, 2));

  const stillPending = Object.values(current).filter(
    e => !e.subtype || !ALL_SUBTYPES.has(e.subtype)
  ).length;

  console.log(`\n=== DONE ===`);
  console.log(`Classified: ${classified}`);
  console.log(`Failed/invalid: ${failed}`);
  console.log(`Still pending: ${stillPending}`);
  console.log(`Saved to ${FINAL_PATH}`);

  if (stillPending > 0) {
    console.log(`\nRun with --pass2 to retry failed, then --pass3 to force-assign remaining.`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
