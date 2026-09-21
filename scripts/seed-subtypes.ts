/**
 * scripts/seed-subtypes.ts
 *
 * Reads data/subtypes-final.json and bulk-updates problems.sub_type in Supabase.
 *
 * Run: source .env.local && npx tsx scripts/seed-subtypes.ts
 * Dry-run: source .env.local && npx tsx scripts/seed-subtypes.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DRY_RUN      = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars. Run: source .env.local && npx tsx scripts/seed-subtypes.ts');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

interface SubtypeEntry {
  oltTopic: string;
  subtype: string;
  source: string;
}

async function main() {
  const finalPath = path.join(process.cwd(), 'data', 'subtypes-final.json');
  if (!fs.existsSync(finalPath)) {
    console.error('data/subtypes-final.json not found. Run classify-subtypes.ts first.');
    process.exit(1);
  }

  const subtypes: Record<string, SubtypeEntry> = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
  const entries = Object.entries(subtypes);
  console.log(`Loaded ${entries.length} sub-type assignments`);

  // Check for remaining blanks
  const blanks = entries.filter(([, v]) => !v.subtype);
  if (blanks.length > 0) {
    console.warn(`⚠️  ${blanks.length} problems still have no subtype. Run classify-subtypes.ts --pass3 first.`);
    if (!DRY_RUN) {
      console.error('Aborting — do not seed with null subtypes.');
      process.exit(1);
    }
  }

  const sourceStats = entries.reduce((acc, [, v]) => {
    acc[v.source] = (acc[v.source] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('Source breakdown:', sourceStats);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] First 10:');
    entries.slice(0, 10).forEach(([id, v]) =>
      console.log(`  #${id} → ${v.oltTopic} / ${v.subtype} [${v.source}]`)
    );
    return;
  }

  // Bulk update in batches of 200
  const BATCH = 200;
  let updated = 0;

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);

    // Use individual upsert calls (Supabase doesn't support bulk UPDATE with different values)
    const promises = batch.map(([id, v]) =>
      supabase
        .from('problems')
        .update({ sub_type: v.subtype })
        .eq('id', parseInt(id))
    );

    const results = await Promise.all(promises);
    const errors = results.filter(r => r.error);
    if (errors.length > 0) {
      console.error(`Errors in batch ${Math.floor(i/BATCH)+1}:`, errors[0].error);
    }
    updated += batch.length - errors.length;
    process.stdout.write(`\rUpdated: ${updated}/${entries.length}`);
  }

  console.log(`\n\nDone! Updated sub_type for ${updated} problems.`);
}

main().catch(err => { console.error(err); process.exit(1); });
