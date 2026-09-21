/**
 * scripts/parse-cses.ts
 *
 * Parses CSES problem list from:
 *   - context/cses_tags.txt — priority/difficulty tags per problem
 *   - data/cses/1.html     — CSES problem IDs (from href="/problemset/task/{id}")
 *
 * Outputs data/cses-parsed.json — array of CSES problems to seed.
 * Only Priority A and B problems are included.
 *
 * Run: npx tsx scripts/parse-cses.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Section → OLT Topic + Sub-type mapping ───────────────────────────────────

const SECTION_MAP: Record<string, { oltTopic: string; subtype: string }> = {
  '1. Introductory Problems':  { oltTopic: 'array',            subtype: 'sorting-tricks' },
  '2. Sorting and Searching':  { oltTopic: 'binary-search',    subtype: 'boundary-search' },
  '3. Dynamic Programming':    { oltTopic: 'dynamic-programming', subtype: '' }, // fine-grained below
  '4. Graph Algorithms':       { oltTopic: 'graph',            subtype: '' },
  '5. Range Queries':          { oltTopic: 'prefix-sum',       subtype: '1d-prefix' },
  '6. Tree Algorithms':        { oltTopic: 'tree',             subtype: 'traversal' },
  '8. String Algorithms':      { oltTopic: 'string',           subtype: 'pattern-matching' },
  '10. Advanced Techniques':   { oltTopic: 'dynamic-programming', subtype: 'bitmask-dp' },
  '11. Sliding Window Problems': { oltTopic: 'sliding-window', subtype: 'variable-size' },
  '13. Bitwise Operations':    { oltTopic: 'bit-manipulation',  subtype: 'xor-tricks' },
};

// Keyword-based sub-type hints for DP and Graph sections
function refineDPSubtype(title: string): string {
  const t = title.toLowerCase();
  if (/knapsack|subset sum|partition/.test(t))       return 'knapsack';
  if (/subsequence|lcs|lis|edit distance/.test(t))   return 'subsequences';
  if (/interval|matrix chain|balloon|burst/.test(t)) return 'interval-dp';
  if (/tree|rod|forest|path/.test(t))                return 'tree-dp';
  if (/digit/.test(t))                               return 'digit-dp';
  if (/game|nim|stone/.test(t))                      return 'game-dp';
  if (/coin|count paths|grid|stairs|house/.test(t))  return '1d-dp';
  return '1d-dp'; // default
}

function refineGraphSubtype(title: string): string {
  const t = title.toLowerCase();
  if (/dijkstra|shortest path|distance/.test(t))             return 'sssp';
  if (/topological|course|alien|order/.test(t))              return 'topological-sort';
  if (/spanning tree|mst|kruskal|prim/.test(t))              return 'mst';
  if (/strongly connected|scc|tarjan/.test(t))               return 'scc';
  if (/bfs|breadth|level|flood|0-1/.test(t))                 return 'bfs';
  return 'dfs'; // default
}

// ── Parse cses_tags.txt ───────────────────────────────────────────────────────

interface ParsedCSESProblem {
  name: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  priority: 'A' | 'B' | 'C';
  section: string;
  oltTopic: string;
  subtype: string;
}

function parseTags(): ParsedCSESProblem[] {
  const tagsPath = path.join(process.cwd(), 'context', 'cses_tags.txt');
  const content  = fs.readFileSync(tagsPath, 'utf8');
  const lines    = content.split('\n');

  const problems: ParsedCSESProblem[] = [];
  let currentSection = '';
  let mapping: { oltTopic: string; subtype: string } | null = null;

  // Markdown table row pattern: | Name | Level | Priority |
  const tableRow = /^\|\s*([^|]+?)\s*\|\s*(Easy|Medium|Hard)\s*\|\s*([ABC])\s*\|/i;
  const sectionHeader = /^#\s+(\d+\..+)$/;

  for (const line of lines) {
    const secMatch = line.match(sectionHeader);
    if (secMatch) {
      currentSection = secMatch[1].trim();
      mapping = SECTION_MAP[currentSection] ?? null;
      continue;
    }

    if (!mapping) continue; // skip sections we don't seed

    const rowMatch = line.match(tableRow);
    if (rowMatch) {
      const name       = rowMatch[1].trim();
      const difficulty = rowMatch[2].toUpperCase() as 'EASY' | 'MEDIUM' | 'HARD';
      const priority   = rowMatch[3].toUpperCase() as 'A' | 'B' | 'C';

      // Skip header rows and separator lines
      if (name === 'Problem' || name.startsWith('-')) continue;

      // Fine-grained sub-type for DP and Graph
      let subtype = mapping.subtype;
      if (mapping.oltTopic === 'dynamic-programming' && !subtype) {
        subtype = refineDPSubtype(name);
      } else if (mapping.oltTopic === 'graph' && !subtype) {
        subtype = refineGraphSubtype(name);
      }

      problems.push({
        name,
        difficulty,
        priority,
        section: currentSection,
        oltTopic: mapping.oltTopic,
        subtype,
      });
    }
  }

  return problems;
}

// ── Parse data/cses/1.html for problem IDs ────────────────────────────────────

function parseHTML(): Map<string, number> {
  const htmlPath = path.join(process.cwd(), 'data', 'cses', '1.html');
  if (!fs.existsSync(htmlPath)) {
    console.warn('⚠️  data/cses/1.html not found — IDs will be null (set manually later).');
    return new Map();
  }

  const html    = fs.readFileSync(htmlPath, 'utf8');
  const nameToId = new Map<string, number>();

  // Match: <a href="/problemset/task/1234">Problem Name</a>
  const linkRe = /<a[^>]+href="\/problemset\/task\/(\d+)"[^>]*>\s*([^<]+?)\s*<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const id   = parseInt(m[1]);
    const name = m[2].trim();
    nameToId.set(name.toLowerCase(), id);
  }

  return nameToId;
}

// ── Fuzzy name match ─────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findId(name: string, idMap: Map<string, number>): number | null {
  const norm = normalize(name);
  // Exact (normalized) match
  for (const [k, v] of idMap) {
    if (normalize(k) === norm) return v;
  }
  // Prefix match (handles minor naming differences)
  for (const [k, v] of idMap) {
    if (normalize(k).startsWith(norm.slice(0, 8))) return v;
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const parsed = parseTags();
const idMap  = parseHTML();

const seedable = parsed.filter(p => p.priority === 'A' || p.priority === 'B');
console.log(`Parsed: ${parsed.length} total, ${seedable.length} Priority A+B`);

const result = seedable.map(p => {
  const id = findId(p.name, idMap);
  return {
    cses_id:      id,
    title:        p.name,
    difficulty:   p.difficulty,
    priority:     p.priority,
    section:      p.section,
    olt_topic:    p.oltTopic,
    sub_type:     p.subtype,
    external_url: id ? `https://cses.fi/problemset/task/${id}` : null,
    source:       'cses',
    topic_tags:   [p.oltTopic],
  };
});

const noId = result.filter(p => !p.cses_id).length;
if (noId > 0) console.warn(`⚠️  ${noId} problems without a CSES ID — check data/cses/1.html`);

const diffStats = result.reduce((acc, p) => {
  acc[p.difficulty] = (acc[p.difficulty] || 0) + 1;
  return acc;
}, {} as Record<string, number>);
console.log('Difficulty:', diffStats);

const sectionStats = result.reduce((acc, p) => {
  acc[p.section] = (acc[p.section] || 0) + 1;
  return acc;
}, {} as Record<string, number>);
console.log('By section:', sectionStats);

const outPath = path.join(process.cwd(), 'data', 'cses-parsed.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`\nSaved ${result.length} problems to ${outPath}`);
