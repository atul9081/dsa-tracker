/**
 * scripts/map-lc-tags.ts  (Source 1)
 *
 * Applies zero-cost sub-type assignment from existing LC topic tags.
 * Reads data/merged.json → writes data/subtypes-s1.json.
 *
 * Format: { [questionFrontendId]: { oltTopic: string, subtype: string, source: 's1' } }
 *
 * Run: npx tsx scripts/map-lc-tags.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { TOPIC_SCORE_MAP } from '../config/topics';

// Map from LC topic tag slug → [oltTopic, subtype]
// Only include mappings specific enough to narrow to a sub-type
const LC_TAG_TO_SUBTYPE: Record<string, [string, string]> = {
  // DP
  'bitmask':                       ['dynamic-programming',  'bitmask-dp'],
  'game-theory':                   ['dynamic-programming',  'game-dp'],
  'digit-dp':                      ['dynamic-programming',  'digit-dp'],
  'knapsack':                      ['dynamic-programming',  'knapsack'],

  // Graph
  'topological-sort':              ['graph',                'topological-sort'],
  'dijkstra':                      ['graph',                'sssp'],
  'bellman-ford':                  ['graph',                'sssp'],
  'minimum-spanning-tree':         ['graph',                'mst'],
  'strongly-connected-component':  ['graph',                'scc'],

  // Tree
  'segment-tree':                  ['tree',                 'segment-tree'],
  'binary-indexed-tree':           ['tree',                 'segment-tree'],

  // Stack
  'monotonic-stack':               ['stack',                'monotonic-stack'],

  // Prefix Sum
  'prefix-sum':                    ['prefix-sum',           '1d-prefix'],

  // Union-Find
  'union-find':                    ['union-find',           'basic-connectivity'],

  // Trie
  'trie':                          ['trie',                 'prefix-search'],

  // Sliding Window
  'sliding-window':                ['sliding-window',       'variable-size'],

  // Array — matrix tag maps to matrix subtype
  'matrix':                        ['array',                'matrix'],

  // Bit manipulation
  'counting':                      ['bit-manipulation',     'counting-bits'],
};

// OLT topic slug lookup (highest-score tag wins)
function getPrimaryTopic(tags: Array<{ slug: string }>): string {
  let best = '';
  let bestScore = -1;
  for (const t of tags) {
    const score = TOPIC_SCORE_MAP[t.slug] ?? 0;
    if (score > bestScore) { bestScore = score; best = t.slug; }
  }
  return best;
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface MergedProblem {
  questionFrontendId: string;
  topicTags: Array<{ slug: string }>;
}

const mergedPath = path.join(process.cwd(), 'data', 'merged.json');
if (!fs.existsSync(mergedPath)) {
  console.error('data/merged.json not found. Run parse-new-data.ts first.');
  process.exit(1);
}

const merged: MergedProblem[] = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));

const subtypes: Record<string, { oltTopic: string; subtype: string; source: string }> = {};
let mapped = 0;

for (const p of merged) {
  const primaryTopic = getPrimaryTopic(p.topicTags);

  // Try each tag in order of OLT score (highest first) to find a subtype mapping
  const sortedTags = [...p.topicTags].sort(
    (a, b) => (TOPIC_SCORE_MAP[b.slug] ?? 0) - (TOPIC_SCORE_MAP[a.slug] ?? 0)
  );

  let assigned = false;
  for (const tag of sortedTags) {
    const mapping = LC_TAG_TO_SUBTYPE[tag.slug];
    if (mapping) {
      const [oltTopic, subtype] = mapping;
      // Ensure the subtype's oltTopic matches the primary topic (prevent cross-topic assignment)
      if (oltTopic === primaryTopic || TOPIC_SCORE_MAP[oltTopic] === TOPIC_SCORE_MAP[primaryTopic]) {
        subtypes[p.questionFrontendId] = { oltTopic, subtype, source: 's1' };
        assigned = true;
        mapped++;
        break;
      }
    }
  }

  if (!assigned && primaryTopic) {
    // No specific subtype from tags — record primary topic for Gemini to classify later
    subtypes[p.questionFrontendId] = { oltTopic: primaryTopic, subtype: '', source: 'pending' };
  }
}

const outPath = path.join(process.cwd(), 'data', 'subtypes-s1.json');
fs.writeFileSync(outPath, JSON.stringify(subtypes, null, 2));

const total = Object.keys(subtypes).length;
const pending = Object.values(subtypes).filter(v => v.source === 'pending').length;
console.log(`\nSource 1 (LC tags): ${mapped}/${total} classified (${Math.round(mapped/total*100)}%)`);
console.log(`Pending (needs Gemini): ${pending}`);
console.log(`Saved to ${outPath}`);
