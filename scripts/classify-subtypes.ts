/**
 * scripts/classify-subtypes.ts  (Source 3 — Gemini)
 *
 * Classifies problems that still have source='pending' after Source 1.
 *
 * Speed design:
 *   - Batch size 50 problems/request (cuts request count in half vs 25)
 *   - Parallel streams — one per API key, running simultaneously
 *     (Key 1 handles first half of pending list, Key 2 handles second half)
 *   - Each stream rate-limits to 14 RPM independently
 *   → With 2 keys: ~2× throughput. 1,530 problems ≈ 4-6 minutes.
 *   → With 1 key:  1 stream, ~7-9 minutes.
 *
 * Supports:
 *   - Resumable progress (data/subtypes-progress.json checkpoint every 20 batches)
 *   - Pass 2 retry for any failed/invalid responses (strict prompt)
 *   - Pass 3 force-assign using keyword similarity for still-unresolved problems
 *   - Dumps unresolvable problems to data/manual-review.json
 *
 * Requires:
 *   GEMINI_API_KEY (required)
 *   GEMINI_API_KEY_2 (optional second key — parallel second stream)
 *
 * Run:          source .env.local && npx tsx scripts/classify-subtypes.ts
 * Run (resume): source .env.local && npx tsx scripts/classify-subtypes.ts --resume
 * Run (pass2):  source .env.local && npx tsx scripts/classify-subtypes.ts --pass2
 * Run (pass3):  source .env.local && npx tsx scripts/classify-subtypes.ts --pass3
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

const BATCH_SIZE       = 50;  // larger batches = fewer API calls
const RPM_LIMIT        = 14;  // per-key limit (stay under 15 for safety)
const CHECKPOINT_EVERY = 20;  // batches between progress saves
const PER_KEY_DELAY_MS = Math.ceil(60_000 / RPM_LIMIT); // ~4286ms between same-key requests

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

// ── Taxonomy ──────────────────────────────────────────────────────────────────

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

const S1_PATH       = path.join(process.cwd(), 'data', 'subtypes-s1.json');
const PROGRESS_PATH = path.join(process.cwd(), 'data', 'subtypes-progress.json');
const FINAL_PATH    = path.join(process.cwd(), 'data', 'subtypes-final.json');
const MANUAL_PATH   = path.join(process.cwd(), 'data', 'manual-review.json');
const MERGED_PATH   = path.join(process.cwd(), 'data', 'merged.json');

// ── Types ─────────────────────────────────────────────────────────────────────

interface SubtypeEntry { oltTopic: string; subtype: string; source: string; }
interface PendingProblem { id: string; title: string; oltTopic: string; tags: string[]; }

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function callGemini(prompt: string, key: string): Promise<string> {
  const res = await fetch(GEMINI_URL(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

function buildPrompt(batch: PendingProblem[], strict = false): string {
  return `You are a competitive programming expert. Classify each problem into EXACTLY one sub-type from the taxonomy.

TAXONOMY: ${JSON.stringify(TAXONOMY)}

RULES:
1. Sub-type MUST belong to the problem's oltTopic field.
2. Pick the MOST SPECIFIC matching sub-type.
3. Reply ONLY as a JSON array (no markdown): [{"id":"...","subtype":"..."},...]
${strict ? '4. STRICT: You must classify every problem. If unsure, pick the closest.' : ''}

PROBLEMS: ${JSON.stringify(batch.map(p => ({ id: p.id, title: p.title, oltTopic: p.oltTopic, tags: p.tags })))}`;
}

function parseBatchResponse(text: string): Array<{ id: string; subtype: string }> {
  const cleaned = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  try {
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is { id: string; subtype: string } =>
      typeof x.id === 'string' && typeof x.subtype === 'string'
    );
  } catch { return []; }
}

function forceAssign(problem: PendingProblem): string | null {
  const haystack = `${problem.title} ${problem.tags.join(' ')}`.toLowerCase();
  const subtypes = TAXONOMY[problem.oltTopic] ?? [];
  let best = ''; let bestScore = 0;
  for (const st of subtypes) {
    const score = st.split('-').reduce((acc, kw) => acc + (haystack.includes(kw) ? 1 : 0), 0) / st.split('-').length;
    if (score > bestScore) { bestScore = score; best = st; }
  }
  return best || subtypes[0] || null;
}

// ── Core batch processor (per-key stream) ─────────────────────────────────────

async function processBatches(
  batches: PendingProblem[][],
  key: string,
  keyLabel: string,
  current: Record<string, SubtypeEntry>,
  strict: boolean,
  counters: { classified: number; failed: number; done: number; total: number }
): Promise<void> {
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const start = Date.now();

    try {
      const text    = await callGemini(buildPrompt(batch, strict), key);
      const results = parseBatchResponse(text);

      for (const r of results) {
        if (!r.id || !r.subtype || !current[r.id]) continue;
        if (ALL_SUBTYPES.has(r.subtype)) {
          current[r.id] = { ...current[r.id], subtype: r.subtype, source: strict ? 'pass2' : 'gemini' };
          counters.classified++;
        } else {
          // Try canonical normalization (e.g., "dp1d" → "1d-dp")
          const canon = [...ALL_SUBTYPES].find(st => st.replace(/-/g, '') === r.subtype.replace(/-/g, ''));
          if (canon) {
            current[r.id] = { ...current[r.id], subtype: canon, source: strict ? 'pass2' : 'gemini' };
            counters.classified++;
          } else {
            counters.failed++;
          }
        }
      }

      counters.done++;
      const pct = Math.round((counters.done / counters.total) * 100);
      process.stdout.write(`\r[${keyLabel}] batch ${i+1}/${batches.length} | total ${counters.done}/${counters.total} (${pct}%) | ok:${counters.classified} fail:${counters.failed}  `);

      // Save checkpoint every CHECKPOINT_EVERY batches (shared across streams)
      if (counters.done % CHECKPOINT_EVERY === 0) {
        fs.writeFileSync(PROGRESS_PATH, JSON.stringify(current, null, 2));
      }

      // Rate limit: wait for remaining time in per-key window
      const wait = Math.max(0, PER_KEY_DELAY_MS - (Date.now() - start));
      if (wait > 0) await sleep(wait);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\n[${keyLabel}] ERROR batch ${i+1}: ${msg.slice(0, 100)}\n`);
      counters.failed++;
      counters.done++;
      await sleep(PER_KEY_DELAY_MS * 2); // back-off
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args   = process.argv.slice(2);
  const resume = args.includes('--resume');
  const pass2  = args.includes('--pass2');
  const pass3  = args.includes('--pass3');

  if (!fs.existsSync(S1_PATH)) {
    console.error('data/subtypes-s1.json not found. Run map-lc-tags.ts first.');
    process.exit(1);
  }

  const merged: Array<{ questionFrontendId: string; title: string; topicTags: Array<{ slug: string }> }> =
    JSON.parse(fs.readFileSync(MERGED_PATH, 'utf8'));
  const titleMap = new Map(merged.map(p => [p.questionFrontendId, p.title]));
  const tagsMap  = new Map(merged.map(p => [p.questionFrontendId, p.topicTags.map(t => t.slug)]));

  const s1: Record<string, SubtypeEntry> = JSON.parse(fs.readFileSync(S1_PATH, 'utf8'));
  let progress: Record<string, SubtypeEntry> = {};
  if ((resume || pass2 || pass3) && fs.existsSync(PROGRESS_PATH)) {
    progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
    console.log(`Loaded checkpoint: ${Object.keys(progress).length} already classified`);
  }

  const current: Record<string, SubtypeEntry> = { ...s1, ...progress };

  // ── Pass 3: force-assign ───────────────────────────────────────────────────
  if (pass3) {
    const manualReview: Array<{ id: string; title: string; oltTopic: string }> = [];
    let forced = 0;
    for (const [id, entry] of Object.entries(current)) {
      if (entry.subtype && ALL_SUBTYPES.has(entry.subtype)) continue;
      const problem = { id, title: titleMap.get(id) ?? id, oltTopic: entry.oltTopic, tags: tagsMap.get(id) ?? [] };
      const assigned = forceAssign(problem);
      if (assigned) { current[id] = { ...entry, subtype: assigned, source: 'pass3-force' }; forced++; }
      else manualReview.push({ id, title: problem.title, oltTopic: entry.oltTopic });
    }
    if (manualReview.length) {
      fs.writeFileSync(MANUAL_PATH, JSON.stringify(manualReview, null, 2));
      console.log(`⚠️  ${manualReview.length} need manual review → ${MANUAL_PATH}`);
    }
    fs.writeFileSync(FINAL_PATH, JSON.stringify(current, null, 2));
    console.log(`Pass 3: ${forced} force-assigned. Saved to ${FINAL_PATH}`);
    return;
  }

  // ── Pass 1 / Pass 2: Gemini classification ────────────────────────────────
  const pending: PendingProblem[] = [];
  for (const [id, entry] of Object.entries(current)) {
    const needs = pass2
      ? entry.source !== 's1' && (!entry.subtype || !ALL_SUBTYPES.has(entry.subtype))
      : entry.source === 'pending';
    if (needs) pending.push({
      id,
      title:    titleMap.get(id) ?? id,
      oltTopic: entry.oltTopic,
      tags:     tagsMap.get(id) ?? [],
    });
  }

  if (pending.length === 0) {
    console.log('Nothing to classify. Writing final output.');
    fs.writeFileSync(FINAL_PATH, JSON.stringify(current, null, 2));
    return;
  }

  // Split pending list into per-key chunks for parallel processing
  const numKeys   = API_KEYS.length;
  const chunkSize = Math.ceil(pending.length / numKeys);
  const chunks    = API_KEYS.map((_, i) => {
    const slice = pending.slice(i * chunkSize, (i + 1) * chunkSize);
    // Convert to batches of BATCH_SIZE
    const batches: PendingProblem[][] = [];
    for (let j = 0; j < slice.length; j += BATCH_SIZE) batches.push(slice.slice(j, j + BATCH_SIZE));
    return batches;
  }).filter(c => c.length > 0);

  const totalBatches = chunks.reduce((s, c) => s + c.length, 0);
  const estSecsPerKey = Math.ceil(chunkSize / BATCH_SIZE) * (PER_KEY_DELAY_MS / 1000);
  const estMins = Math.ceil(estSecsPerKey / 60);

  console.log(`\nClassifying ${pending.length} problems`);
  console.log(`Batch size: ${BATCH_SIZE} | Keys: ${numKeys} | Batches: ${totalBatches} | Est: ~${estMins} min`);
  if (numKeys > 1) console.log(`Running ${numKeys} parallel streams (one per key)\n`);

  const counters = { classified: 0, failed: 0, done: 0, total: totalBatches };

  // Run all key streams in parallel
  await Promise.all(
    chunks.map((batches, i) =>
      processBatches(batches, API_KEYS[i], `key${i + 1}`, current, pass2, counters)
    )
  );

  process.stdout.write('\n');

  // Final checkpoint + output
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(current, null, 2));
  fs.writeFileSync(FINAL_PATH, JSON.stringify(current, null, 2));

  const stillPending = Object.values(current).filter(e => !e.subtype || !ALL_SUBTYPES.has(e.subtype)).length;
  console.log(`\n=== DONE ===`);
  console.log(`Classified: ${counters.classified} | Failed: ${counters.failed} | Still pending: ${stillPending}`);
  console.log(`Saved to ${FINAL_PATH}`);
  if (stillPending > 0) console.log(`\nNext: npx tsx scripts/classify-subtypes.ts --pass2\nThen: npx tsx scripts/classify-subtypes.ts --pass3`);
}

main().catch(err => { console.error(err); process.exit(1); });
