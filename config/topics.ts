export type OltTopic = {
  slug: string;
  name: string;
  score: number;
};

export const OLT_TOPICS: OltTopic[] = [
  { slug: 'dynamic-programming',  name: 'Dynamic Programming',  score: 10 },
  { slug: 'graph',                name: 'Graphs',               score: 10 },
  { slug: 'depth-first-search',   name: 'DFS',                  score: 9  },
  { slug: 'breadth-first-search', name: 'BFS',                  score: 9  },
  { slug: 'tree',                 name: 'Trees',                score: 9  },
  { slug: 'binary-search',        name: 'Binary Search',        score: 9  },
  { slug: 'two-pointers',         name: 'Two Pointers',         score: 8  },
  { slug: 'sliding-window',       name: 'Sliding Window',       score: 8  },
  { slug: 'backtracking',         name: 'Backtracking',         score: 8  },
  { slug: 'heap-priority-queue',  name: 'Heap / Priority Queue', score: 8 },
  { slug: 'array',                name: 'Arrays',               score: 7  },
  { slug: 'stack',                name: 'Stack',                score: 7  },
  { slug: 'hash-table',           name: 'Hash Table',           score: 7  },
  { slug: 'greedy',               name: 'Greedy',               score: 7  },
  { slug: 'string',               name: 'String',               score: 6  },
  { slug: 'linked-list',          name: 'Linked List',          score: 6  },
  { slug: 'union-find',           name: 'Union-Find (DSU)',      score: 6 },
  { slug: 'trie',                 name: 'Trie',                 score: 5  },
  { slug: 'bit-manipulation',     name: 'Bit Manipulation',     score: 5  },
  { slug: 'prefix-sum',           name: 'Prefix Sum',           score: 5  },
];

export const OLT_TOPIC_SLUGS = new Set(OLT_TOPICS.map(t => t.slug));
export const TOPIC_SCORE_MAP = Object.fromEntries(OLT_TOPICS.map(t => [t.slug, t.score]));

// ── Sub-type catalogue ────────────────────────────────────────────────────────
// Derived from data/subtypes-final.json classification run.
// Sub-types are dataset-level stable values — not user-generated.
export const SUB_TYPES_BY_TOPIC: Record<string, string[]> = {
  'array':                ['design', 'frequency-count', 'interval-scheduling', 'intervals', 'matrix', 'prefix-search', 'prefix-suffix', 'sequence-construction', 'sorting-tricks', 'two-sum-style'],
  'backtracking':         ['backtracking-dfs', 'combinations', 'constraint-search', 'permutations'],
  'binary-search':        ['boundary-search', 'classic-search', 'search-on-answer'],
  'bit-manipulation':     ['counting-bits', 'subset-bitmask', 'xor-tricks'],
  'breadth-first-search': ['grid-bfs', 'level-order', 'multi-source-bfs'],
  'depth-first-search':   ['backtracking-dfs', 'cycle-detection', 'grid-dfs', 'tree-traversal'],
  'dynamic-programming':  ['1d-dp', 'bitmask-dp', 'digit-dp', 'game-dp', 'interval-dp', 'knapsack', 'subsequences', 'tree-dp'],
  'graph':                ['basic-connectivity', 'bfs', 'dfs', 'mst', 'scc', 'sssp', 'topological-sort'],
  'greedy':               ['interval-scheduling', 'jump-game', 'sequence-construction'],
  'hash-table':           ['design', 'frequency-count', 'pattern-matching', 'two-sum-style'],
  'heap-priority-queue':  ['merge-streams', 'scheduling', 'top-k'],
  'linked-list':          ['reversal', 'two-pointer-list'],
  'sliding-window':       ['variable-size'],
  'stack':                ['bracket-matching', 'calculator', 'monotonic-stack'],
  'string':               ['anagram-sliding', 'palindromes', 'pattern-matching'],
  'tree':                 ['bst', 'construction', 'lca', 'level-order', 'path-problems', 'segment-tree', 'top-k', 'traversal', 'tree-dp', 'tree-traversal'],
  'trie':                 ['prefix-search'],
  'two-pointers':         ['bracket-matching', 'fast-slow', 'merge-style', 'opposite-ends', 'two-pointer-list'],
  'union-find':           ['basic-connectivity'],
};

// Acronyms and abbreviations that should stay uppercase
const ACRONYMS = new Set(['dp', 'bfs', 'dfs', 'bst', 'lca', 'mst', 'scc', 'sssp', 'dsu']);

/**
 * Converts a sub-type slug to a human-readable label.
 * e.g. 'two-sum-style' → 'Two Sum Style', '1d-dp' → '1D DP', 'bst' → 'BST'
 */
export function prettifySubtype(slug: string): string {
  return slug
    .split('-')
    .map(word => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      // Handle leading digit prefixes: '1d' → '1D', '2d' → '2D'
      const digitPrefix = lower.match(/^(\d+)([a-z]+)$/);
      if (digitPrefix) {
        const suffix = digitPrefix[2];
        return digitPrefix[1] + (ACRONYMS.has(suffix) ? suffix.toUpperCase() : suffix.charAt(0).toUpperCase() + suffix.slice(1));
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

