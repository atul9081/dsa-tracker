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
