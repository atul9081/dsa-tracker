/**
 * scripts/check-gemini.ts
 *
 * Diagnostic: lists available Gemini models for each API key
 * and sends a tiny test prompt to find which models actually work.
 *
 * Run: npx tsx scripts/check-gemini.ts
 */

import * as fs from 'fs';

// ── Load .env.local ───────────────────────────────────────────────────────────
for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.trim().match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const val = m[2].replace(/^['"]|['"]$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
  break;
}

const KEYS: Record<string, string> = {};
if (process.env.GEMINI_API_KEY)   KEYS['key1'] = process.env.GEMINI_API_KEY;
if (process.env.GEMINI_API_KEY_2) KEYS['key2'] = process.env.GEMINI_API_KEY_2;

if (Object.keys(KEYS).length === 0) {
  console.error('No GEMINI_API_KEY found in .env.local');
  process.exit(1);
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const TEST_MODELS = [
  // Aliases
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-pro-latest',
  // Gemini 2.5
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  // Gemini 3.x
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
];

const TEST_PROMPT = 'Reply with exactly: {"ok":true}';

async function listModels(label: string, key: string): Promise<string[]> {
  console.log(`\n── ${label} ── Fetching available models…`);
  try {
    const res = await fetch(`${BASE}/models?key=${key}`);
    const json = await res.json() as { models?: Array<{ name: string; displayName?: string }> };
    if (!res.ok) {
      console.log(`  ✗ List failed: ${JSON.stringify(json).slice(0, 200)}`);
      return [];
    }
    const models = (json.models ?? []).map(m => m.name.replace('models/', ''));
    console.log(`  Found ${models.length} models:`);
    for (const m of models) console.log(`    • ${m}`);
    return models;
  } catch (e) {
    console.log(`  ✗ Network error: ${e}`);
    return [];
  }
}

async function testModel(label: string, key: string, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: TEST_PROMPT }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 32 },
      }),
    });
    const json = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { code: number; message: string };
    };
    if (!res.ok || json.error) {
      const msg = json.error?.message ?? JSON.stringify(json).slice(0, 120);
      console.log(`  [${label}] ${model.padEnd(30)} ✗ ${res.status} — ${msg.slice(0, 80)}`);
      return false;
    }
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    console.log(`  [${label}] ${model.padEnd(30)} ✓ response: ${text.trim().slice(0, 60)}`);
    return true;
  } catch (e) {
    console.log(`  [${label}] ${model.padEnd(30)} ✗ Network error: ${e}`);
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Gemini API Diagnostic');
  console.log('═══════════════════════════════════════════════');
  console.log(`Keys found: ${Object.keys(KEYS).join(', ')}`);
  console.log(`Key1 prefix: ${Object.values(KEYS)[0]?.slice(0, 8)}...`);
  if (Object.keys(KEYS).length > 1)
    console.log(`Key2 prefix: ${Object.values(KEYS)[1]?.slice(0, 8)}...`);

  // Step 1: list available models per key
  const availableByKey: Record<string, string[]> = {};
  for (const [label, key] of Object.entries(KEYS)) {
    availableByKey[label] = await listModels(label, key);
  }

  // Step 2: test all candidate models against each key
  console.log('\n── Testing models with a real request ──');
  const working: Record<string, string[]> = {};

  for (const [label, key] of Object.entries(KEYS)) {
    working[label] = [];
    for (const model of TEST_MODELS) {
      const ok = await testModel(label, key, model);
      if (ok) working[label].push(model);
    }
  }

  // Step 3: summary
  console.log('\n═══════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════');
  for (const [label, models] of Object.entries(working)) {
    if (models.length === 0) {
      console.log(`${label}: ✗ NO WORKING MODELS`);
    } else {
      console.log(`${label}: ✓ Working models: ${models.join(', ')}`);
      console.log(`       → Recommended: ${models[0]}`);
    }
  }

  // Cross-key agreement
  const key1 = working['key1'] ?? [];
  const key2 = working['key2'] ?? [];
  if (key2.length > 0) {
    const shared = key1.filter(m => key2.includes(m));
    console.log(`\nShared working models: ${shared.join(', ') || 'none'}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
