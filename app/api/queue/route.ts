import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import type { ProblemWithStatus } from '@/types';
import type { UserSettings } from '@/types';
import { QUEUE_CONFIG } from '@/config/queue';
import { TOPIC_SCORE_MAP } from '@/config/topics';

// ── helpers ───────────────────────────────────────────────────────────────────

function getTodayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Pick one item from `items` using weighted random selection. */
function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + w, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Returns the OLT topic slug with the highest score among a problem's tags.
 * Problems with no OLT tag should have been filtered out at seed time,
 * but we default to 'other' as a safety net.
 */
function getPrimaryTopic(topicTags: string[]): string {
  let best = '';
  let bestScore = -1;
  for (const tag of topicTags) {
    const score = TOPIC_SCORE_MAP[tag] ?? 0;
    if (score > bestScore) { bestScore = score; best = tag; }
  }
  return best || 'other';
}

/**
 * Topic-normalized 2-stage weighted sample within a difficulty bucket.
 *
 * Stage 1: pick a topic (weighted by olt_score^2 × weight_override).
 * Stage 2: pick a problem uniformly from that topic.
 * Guard:   no topic appears more than MAX_PER_TOPIC times in the final queue.
 *
 * Falls back to uniform random if all eligible topics are exhausted.
 */
function topicNormalizedSample(
  pool: ProblemWithStatus[],
  count: number,
  enabledSlugs: string[] | null,
  weightOverrides: Record<string, number>,
  topicUsedCounts: Record<string, number>,  // mutated in-place, shared across difficulty calls
  MAX_PER_TOPIC: number
): ProblemWithStatus[] {
  if (count <= 0 || pool.length === 0) return [];

  // Filter by enabled topics (if Focus Mode is set)
  const eligible = enabledSlugs
    ? pool.filter(p => p.topic_tags.some(t => enabledSlugs.includes(t)))
    : pool;

  if (eligible.length === 0) return [];

  // Group by primary topic
  const groups = new Map<string, ProblemWithStatus[]>();
  for (const p of eligible) {
    const topic = getPrimaryTopic(p.topic_tags);
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic)!.push(p);
  }

  const selected: ProblemWithStatus[] = [];
  const usedIds = new Set<number>();

  for (let i = 0; i < count; i++) {
    // Eligible topics: not at max, has remaining problems not yet picked
    const eligibleTopics = Array.from(groups.entries()).filter(
      ([slug, probs]) =>
        (topicUsedCounts[slug] ?? 0) < MAX_PER_TOPIC &&
        probs.some(p => !usedIds.has(p.id))
    );

    if (eligibleTopics.length === 0) {
      // All topics exhausted or at max — fall back to uniform from remaining pool
      const remaining = eligible.filter(p => !usedIds.has(p.id));
      if (remaining.length === 0) break;
      const pick = remaining[Math.floor(Math.random() * remaining.length)];
      selected.push(pick);
      usedIds.add(pick.id);
      continue;
    }

    // Stage 1: weighted topic pick
    const topicWeights = eligibleTopics.map(([slug]) => {
      const baseScore = TOPIC_SCORE_MAP[slug] ?? 1;
      const override = weightOverrides[slug] ?? 1;
      return Math.pow(baseScore * override, 2);
    });
    const [pickedSlug, pickedProbs] = weightedPick(eligibleTopics, topicWeights);

    // Stage 2: uniform pick within topic (problems not yet used)
    const available = pickedProbs.filter(p => !usedIds.has(p.id));
    const pick = available[Math.floor(Math.random() * available.length)];

    selected.push(pick);
    usedIds.add(pick.id);
    topicUsedCounts[pickedSlug] = (topicUsedCounts[pickedSlug] ?? 0) + 1;
  }

  return selected;
}

// ── settings + mode resolution ────────────────────────────────────────────────

type DiffMode = 'chill' | 'standard' | 'grind' | 'custom';

const MODE_PRESETS: Record<Exclude<DiffMode, 'custom'>, { hard: number; medium: number; easy: number }> = {
  chill:    { hard: 0, medium: 3, easy: 2 },
  standard: { hard: 2, medium: 3, easy: 0 },
  grind:    { hard: 3, medium: 2, easy: 0 },
};

interface QueueCfg {
  dailyCount: number;
  hardCount: number;
  mediumCount: number;
  easyCount: number;
  enabledSlugs: string[] | null;
  weightOverrides: Record<string, number>;
}

function resolveConfig(settings: UserSettings | null, modeOverride?: DiffMode): QueueCfg {
  const mode: DiffMode = modeOverride ?? (settings?.difficulty_mode as DiffMode) ?? 'standard';

  let hardCount: number;
  let mediumCount: number;
  let easyCount: number;

  if (mode === 'custom' && settings) {
    hardCount   = settings.hard_count   ?? QUEUE_CONFIG.hardCount;
    mediumCount = settings.medium_count ?? QUEUE_CONFIG.mediumCount;
    easyCount   = settings.easy_count   ?? QUEUE_CONFIG.easyCount;
  } else if (mode !== 'custom') {
    const preset = MODE_PRESETS[mode];
    hardCount   = preset.hard;
    mediumCount = preset.medium;
    easyCount   = preset.easy;
  } else {
    // custom with no settings — fall back to standard
    hardCount   = QUEUE_CONFIG.hardCount;
    mediumCount = QUEUE_CONFIG.mediumCount;
    easyCount   = QUEUE_CONFIG.easyCount;
  }

  return {
    dailyCount:     hardCount + mediumCount + easyCount,
    hardCount,
    mediumCount,
    easyCount,
    enabledSlugs:   settings?.enabled_topic_slugs ?? null,
    weightOverrides: settings?.topic_weight_overrides ?? {},
  };
}

// ── queue generation ──────────────────────────────────────────────────────────

const MAX_PER_TOPIC = 3; // no topic more than 3 times in a single day's queue

async function generateQueue(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  date: string,
  settings: UserSettings | null,
  modeOverride?: DiffMode
): Promise<ProblemWithStatus[]> {
  const cfg = resolveConfig(settings, modeOverride);

  const { data: problems, error } = await supabase
    .from('problems_with_status')
    .select('*')
    .eq('paid_only', false)
    .neq('status', 'SOLVED');

  if (error) throw error;
  const pool = problems as ProblemWithStatus[];

  const hard   = pool.filter(p => p.difficulty === 'HARD');
  const medium = pool.filter(p => p.difficulty === 'MEDIUM');
  const easy   = pool.filter(p => p.difficulty === 'EASY');

  // Shared topic-use counter across all difficulty buckets
  const topicUsedCounts: Record<string, number> = {};

  const hardPicked   = topicNormalizedSample(hard,   cfg.hardCount,   cfg.enabledSlugs, cfg.weightOverrides, topicUsedCounts, MAX_PER_TOPIC);
  const mediumPicked = topicNormalizedSample(medium, cfg.mediumCount, cfg.enabledSlugs, cfg.weightOverrides, topicUsedCounts, MAX_PER_TOPIC);
  const easyPicked   = topicNormalizedSample(easy,   cfg.easyCount,   cfg.enabledSlugs, cfg.weightOverrides, topicUsedCounts, MAX_PER_TOPIC);

  let selected = [...hardPicked, ...mediumPicked, ...easyPicked];

  // Fill up to dailyCount if any bucket came up short
  if (selected.length < cfg.dailyCount) {
    const usedIds = new Set(selected.map(p => p.id));
    const remaining = pool.filter(
      p => !usedIds.has(p.id) &&
        (!cfg.enabledSlugs || p.topic_tags.some(t => cfg.enabledSlugs!.includes(t)))
    );
    const filler = topicNormalizedSample(
      remaining, cfg.dailyCount - selected.length,
      null, cfg.weightOverrides, topicUsedCounts, MAX_PER_TOPIC
    );
    selected = [...selected, ...filler];
  }

  selected = shuffle(selected);

  await supabase.from('daily_queues').upsert(
    { date, user_id: userId, problem_ids: selected.map(p => p.id) },
    { onConflict: 'date,user_id' }
  );

  return selected;
}

// ── GET /api/queue ─────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const today = getTodayIST();

    const { data: existing } = await supabase
      .from('daily_queues')
      .select('problem_ids')
      .eq('date', today)
      .eq('user_id', user.id)
      .single();

    let problems: ProblemWithStatus[];

    if (existing?.problem_ids?.length) {
      const { data, error } = await supabase
        .from('problems_with_status')
        .select('*')
        .in('id', existing.problem_ids);
      if (error) throw error;
      const map = new Map((data as ProblemWithStatus[]).map(p => [p.id, p]));
      problems = existing.problem_ids.map((id: number) => map.get(id)!).filter(Boolean);
    } else {
      // Load user settings for generation
      const { data: settingsRow } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();
      problems = await generateQueue(supabase, user.id, today, settingsRow as UserSettings | null);
    }

    return NextResponse.json({ date: today, problems });
  } catch (err: unknown) {
    console.error('[GET /api/queue]', err);
    return NextResponse.json({ error: 'Failed to load queue' }, { status: 500 });
  }
}

// ── POST /api/queue — force regenerate ────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const date = body.date ?? getTodayIST();
    const modeOverride: DiffMode | undefined = body.mode;

    // Load user settings
    const { data: settingsRow } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    await supabase.from('daily_queues').delete()
      .eq('date', date)
      .eq('user_id', user.id);

    const problems = await generateQueue(
      supabase, user.id, date,
      settingsRow as UserSettings | null,
      modeOverride
    );

    return NextResponse.json({ date, problems, regenerated: true });
  } catch (err: unknown) {
    console.error('[POST /api/queue]', err);
    return NextResponse.json({ error: 'Failed to regenerate queue' }, { status: 500 });
  }
}
