/**
 * scripts/parse-new-data.ts
 *
 * Parses all LeetCode data files (new/ and old/) into a single deduplicated
 * JSON array and saves to data/merged.json.
 *
 * New files may contain multiple JSON blobs separated by "// comment" lines.
 * Old files are standard single-blob JSON.
 *
 * Deduplication rules:
 *   - Prefer newer entry when both old and new have the same questionFrontendId
 *   - Only free (paidOnly=false) problems are kept
 *   - Only problems with at least one OLT topic tag are kept
 *
 * Run: npx tsx scripts/parse-new-data.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// OLT topic slugs (from config/topics.ts — keep in sync)
const OLT_TOPIC_SLUGS = new Set([
  'dynamic-programming', 'graph', 'depth-first-search', 'breadth-first-search',
  'tree', 'binary-search', 'two-pointers', 'sliding-window', 'backtracking',
  'heap-priority-queue', 'array', 'stack', 'hash-table', 'greedy',
  'string', 'linked-list', 'union-find', 'trie', 'bit-manipulation', 'prefix-sum',
]);

interface LCProblem {
  id: number;
  questionFrontendId: string;
  title: string;
  titleSlug: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  paidOnly: boolean;
  topicTags: Array<{ name: string; slug: string }>;
  acRate: number | null;
  status: string;
}

function parseFile(filePath: string): LCProblem[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');

  // Split on comment lines (handles multi-blob new files)
  const sections = content.split(/^\/\/[^\n]*\n/m).filter(s => s.trim());
  const problems: LCProblem[] = [];

  for (const sec of sections) {
    try {
      const d = JSON.parse(sec.trim());
      const qs = d?.data?.problemsetQuestionListV2?.questions ?? [];
      problems.push(...qs);
    } catch {
      // skip malformed blobs
    }
  }
  return problems;
}

function hasOltTag(problem: LCProblem): boolean {
  return problem.topicTags?.some(t => OLT_TOPIC_SLUGS.has(t.slug)) ?? false;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const dataRoot = path.join(process.cwd(), 'data', 'leeetcode');

// 1. Parse all files
const allNew: LCProblem[] = [];
const allOld: LCProblem[] = [];

for (let i = 1; i <= 8; i++) {
  const newProblems = parseFile(path.join(dataRoot, 'new', `${i}.json`));
  const oldProblems = parseFile(path.join(dataRoot, 'old', `${i}.json`));
  if (newProblems.length) console.log(`new/${i}.json: ${newProblems.length} problems`);
  if (oldProblems.length) console.log(`old/${i}.json: ${oldProblems.length} problems`);
  allNew.push(...newProblems);
  allOld.push(...oldProblems);
}

// 2. Build deduplication map: prefer newer data when IDs overlap
const merged = new Map<string, LCProblem>();

// Insert old first (lower priority)
for (const p of allOld) {
  merged.set(p.questionFrontendId, p);
}
// Overwrite with new (higher priority — may have updated status/tags)
for (const p of allNew) {
  merged.set(p.questionFrontendId, p);
}

// 3. Filter
const filtered = [...merged.values()].filter(p => !p.paidOnly && hasOltTag(p));

// 4. Sort by numeric problem ID
filtered.sort((a, b) => parseInt(a.questionFrontendId) - parseInt(b.questionFrontendId));

// 5. Stats
const diffCount = { EASY: 0, MEDIUM: 0, HARD: 0 };
for (const p of filtered) diffCount[p.difficulty] = (diffCount[p.difficulty] || 0) + 1;

console.log('\n=== MERGE RESULT ===');
console.log(`Total raw: new=${allNew.length}, old=${allOld.length}`);
console.log(`After merge+dedup (all): ${merged.size}`);
console.log(`After filter (free + OLT): ${filtered.length}`);
console.log('Difficulty split:', diffCount);

// 6. Save
const outPath = path.join(process.cwd(), 'data', 'merged.json');
fs.writeFileSync(outPath, JSON.stringify(filtered, null, 2));
console.log(`\nSaved to ${outPath}`);
