/**
 * scripts/fetch-descriptions.ts
 *
 * Fetches missing problem descriptions and updates the DB.
 *   LC  → LeetCode GraphQL API (free, no auth needed for non-premium)
 *   CSES → cses.fi task page (scrape .content div)
 *
 * Usage:
 *   DRY_RUN=true npx ts-node scripts/fetch-descriptions.ts   # preview only
 *   npx ts-node scripts/fetch-descriptions.ts                # run for real
 *
 * Safe to re-run: only fetches problems where description IS NULL.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// ── env loading ────────────────────────────────────────────────────────────────
for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.trim().match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  break;
}

const DRY_RUN = process.env.DRY_RUN === 'true';
const SOURCE  = process.env.SOURCE ?? 'all';  // 'lc' | 'cses' | 'all'
const DELAY_MS = 400;     // ms between requests (be polite to both APIs)
const BATCH_SIZE = 50;    // DB update batch size
const MAX_ERRORS = 20;    // abort if too many consecutive errors

// ── supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ── LeetCode GraphQL ──────────────────────────────────────────────────────────
// Works without auth for all free problems — just needs Referer header.
const LC_GRAPHQL = 'https://leetcode.com/graphql/';
const LC_QUERY = `
  query questionContent($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      content
    }
  }
`;

async function fetchLCDescription(titleSlug: string): Promise<string | null> {
  try {
    const res = await fetch(LC_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://leetcode.com',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        query: LC_QUERY,
        variables: { titleSlug },
        operationName: 'questionContent',
      }),
    });
    if (!res.ok) return null;
    const json = await res.json() as { data?: { question?: { content?: string } } };
    return json.data?.question?.content ?? null;
  } catch {
    return null;
  }
}

// ── CSES scraper ──────────────────────────────────────────────────────────────
// CSES renders the problem statement in <div class="md"> (confirmed working).
// Includes the constraints block for completeness.
async function fetchCSESDescription(csesId: number): Promise<string | null> {
  try {
    const url = `https://cses.fi/problemset/task/${csesId}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Main problem body
    const bodyMatch = html.match(/<div class="md">([\s\S]*?)<\/div>\s*<\/div>/);
    // Constraints box (Time limit, Memory limit, etc.)
    const constraintsMatch = html.match(/<div class="task-constraints">([\s\S]*?)<\/div>/);

    if (!bodyMatch) return null;
    const body = `<div class="md">${bodyMatch[1]}</div>`;
    const constraints = constraintsMatch
      ? `<div class="task-constraints">${constraintsMatch[1]}</div>`
      : '';
    return constraints + body;
  } catch {
    return null;
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
interface Problem {
  id: number;
  title_slug: string;
  source: string | null;
  external_url: string | null;
}

async function main() {
  console.log(`\n🔍 fetch-descriptions — DRY_RUN=${DRY_RUN} SOURCE=${SOURCE}\n`);

  // Fetch all problems missing descriptions (paginated)
  const nullProblems: Problem[] = [];
  const PAGE = 1000;
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('problems')
      .select('id, title_slug, source, external_url')
      .is('description', null)
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) { console.error('DB error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    nullProblems.push(...(data as Problem[]));
    if (data.length < PAGE) break;
  }

  const lcProblems   = SOURCE !== 'cses'
    ? nullProblems.filter(p => !p.source || p.source === 'leetcode')
    : [];
  const csesProblems = SOURCE !== 'lc'
    ? nullProblems.filter(p => p.source === 'cses')
    : [];

  console.log(`📦 Problems needing descriptions:`);
  console.log(`   LC  : ${lcProblems.length}`);
  console.log(`   CSES: ${csesProblems.length}`);
  console.log(`   Total: ${nullProblems.length}\n`);

  if (DRY_RUN) {
    console.log('[DRY RUN] First 5 LC:', lcProblems.slice(0,5).map(p => p.title_slug));
    console.log('[DRY RUN] First 5 CSES:', csesProblems.slice(0,5).map(p => p.external_url));
    return;
  }

  // Log file for failures
  const logPath = path.join('scripts', 'fetch-descriptions-failures.jsonl');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  let updated = 0;
  let failed  = 0;
  let consecutiveErrors = 0;
  const updates: { id: number; description: string }[] = [];

  async function flushUpdates() {
    if (updates.length === 0) return;
    const batch = updates.splice(0);
    for (const { id, description } of batch) {
      const { error } = await supabase
        .from('problems')
        .update({ description })
        .eq('id', id);
      if (error) console.error(`  ⚠ DB update failed for id=${id}:`, error.message);
      else updated++;
    }
  }

  // ── LC problems ──────────────────────────────────────────────────────────
  console.log('── Fetching LC descriptions ─────────────────────────────────');
  for (let i = 0; i < lcProblems.length; i++) {
    const p = lcProblems[i];
    process.stdout.write(`\r[${i+1}/${lcProblems.length}] ${p.title_slug.slice(0,40).padEnd(40)} `);

    const desc = await fetchLCDescription(p.title_slug);
    if (desc) {
      updates.push({ id: p.id, description: desc });
      consecutiveErrors = 0;
      process.stdout.write('✅');
    } else {
      failed++;
      consecutiveErrors++;
      logStream.write(JSON.stringify({ source: 'lc', id: p.id, slug: p.title_slug }) + '\n');
      process.stdout.write('❌');
      if (consecutiveErrors >= MAX_ERRORS) {
        console.log(`\n\n⛔ ${MAX_ERRORS} consecutive errors — aborting LC fetch.`);
        break;
      }
    }

    if (updates.length >= BATCH_SIZE) await flushUpdates();
    await sleep(DELAY_MS);
  }
  await flushUpdates();
  console.log(`\nLC done. Updated: ${updated}  Failed: ${failed}\n`);

  const lcUpdated = updated;
  updated = 0; failed = 0; consecutiveErrors = 0;

  // ── CSES problems ─────────────────────────────────────────────────────────
  console.log('── Fetching CSES descriptions ───────────────────────────────');
  for (let i = 0; i < csesProblems.length; i++) {
    const p = csesProblems[i];
    // Extract CSES task ID from external_url or negative DB id
    const csesId = p.external_url
      ? Number(p.external_url.match(/task\/(\d+)/)?.[1])
      : Math.abs(p.id);

    process.stdout.write(`\r[${i+1}/${csesProblems.length}] id=${csesId} `);

    if (!csesId) { failed++; continue; }

    const desc = await fetchCSESDescription(csesId);
    if (desc) {
      updates.push({ id: p.id, description: desc });
      consecutiveErrors = 0;
      process.stdout.write('✅');
    } else {
      failed++;
      consecutiveErrors++;
      logStream.write(JSON.stringify({ source: 'cses', id: p.id, csesId }) + '\n');
      process.stdout.write('❌');
    }

    if (updates.length >= BATCH_SIZE) await flushUpdates();
    await sleep(DELAY_MS);
  }
  await flushUpdates();
  console.log(`\nCSES done. Updated: ${updated}  Failed: ${failed}\n`);

  console.log(`\n🎉 Summary:`);
  console.log(`   LC  updated: ${lcUpdated}`);
  console.log(`   CSES updated: ${updated}`);
  console.log(`   Total failures: ${failed} (logged to ${logPath})`);
  logStream.end();
}

main().catch(e => { console.error(e); process.exit(1); });
