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
  enabledSources: Array<'leetcode' | 'cses'>;
  weightOverrides: Record<string, number>;
  cooldownDays: number;
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
    enabledSources: settings?.enabled_sources ?? ['leetcode'],
    weightOverrides: settings?.topic_weight_overrides ?? {},
    cooldownDays:   settings?.cooldown_days ?? 7,
  };
}

// ── staleness computation ─────────────────────────────────────────────────────

/**
 * Build a map from sub_type → staleness score ∈ [0, 1].
 *   1.0 = never practiced, or last solved ≥ cooldownDays ago (highest priority)
 *   0.0 = solved today (lowest priority, effectively on cooldown)
 */
async function buildStalenessMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  cooldownDays: number
): Promise<Record<string, number>> {
  const today = new Date();
  const since = new Date(today.getTime() - 30 * 86_400_000).toISOString();

  // Fetch recent SOLVED progress joined to problem sub_type
  const { data: solves } = await supabase
    .from('user_progress')
    .select('updated_at, problems!inner(sub_type)')
    .eq('user_id', userId)
    .eq('status', 'SOLVED')
    .gte('updated_at', since);

  const lastSolvedBySubtype: Record<string, Date> = {};
  for (const row of solves ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const st = (row as any).problems?.sub_type as string | null;
    if (!st) continue;
    const d = new Date(row.updated_at as string);
    if (!lastSolvedBySubtype[st] || d > lastSolvedBySubtype[st])
      lastSolvedBySubtype[st] = d;
  }

  return new Proxy({} as Record<string, number>, {
    get(_, subtype: string) {
      const last = lastSolvedBySubtype[subtype];
      if (!last) return 1.0; // never practiced → fully stale → highest priority
      const days = (today.getTime() - last.getTime()) / 86_400_000;
      return Math.min(days, cooldownDays) / cooldownDays;
    },
  });
}

// ── 3-stage weighted sampler ──────────────────────────────────────────────────

const MAX_PER_TOPIC   = 3; // max problems per topic in a single day's queue
const MAX_PER_SUBTYPE = 1; // max problems per sub-type in a single day's queue

/**
 * 3-Stage selection algorithm:
 *   Stage 1 — Pick topic (weighted by olt_score² × weight_override)
 *   Stage 2 — Pick sub-type within topic (weighted by staleness)
 *   Stage 3 — Pick problem within sub-type (uniform, filtered by difficulty pool)
 *
 * Falls back gracefully when sub-types or topics are exhausted.
 */
function threeStageSample(
  pool: ProblemWithStatus[],             // pre-filtered by difficulty
  count: number,
  enabledSlugs: string[] | null,
  weightOverrides: Record<string, number>,
  stalenessMap: Record<string, number>,
  topicUsedCounts: Record<string, number>,  // mutated in-place (shared across difficulty calls)
  subtypeUsedSet: Set<string>               // mutated in-place (shared across difficulty calls)
): ProblemWithStatus[] {
  if (count <= 0 || pool.length === 0) return [];

  // Filter by enabled topics
  const eligible = enabledSlugs
    ? pool.filter(p => p.topic_tags.some(t => enabledSlugs.includes(t)))
    : pool;

  if (eligible.length === 0) return [];

  // Group problems by (primary_topic, sub_type) — 2-level map
  // Map<topic, Map<subtype, problem[]>>
  const byTopicSubtype = new Map<string, Map<string, ProblemWithStatus[]>>();
  for (const p of eligible) {
    const topic   = getPrimaryTopic(p.topic_tags);
    const subtype = p.sub_type ?? '__unknown__';
    if (!byTopicSubtype.has(topic))    byTopicSubtype.set(topic, new Map());
    if (!byTopicSubtype.get(topic)!.has(subtype)) byTopicSubtype.get(topic)!.set(subtype, []);
    byTopicSubtype.get(topic)!.get(subtype)!.push(p);
  }

  const selected: ProblemWithStatus[] = [];
  const usedIds = new Set<number>();

  // Helper: can this sub-type still contribute?
  function subtypeHasRemaining(stMap: Map<string, ProblemWithStatus[]>, st: string): boolean {
    return (stMap.get(st) ?? []).some(p => !usedIds.has(p.id));
  }

  for (let i = 0; i < count; i++) {
    // ── Stage 1: pick topic ───────────────────────────────────────────────────
    const eligibleTopics = Array.from(byTopicSubtype.entries()).filter(([slug, stMap]) => {
      if ((topicUsedCounts[slug] ?? 0) >= MAX_PER_TOPIC) return false;
      // Topic must have at least one eligible sub-type with remaining problems
      return Array.from(stMap.keys()).some(
        st => !subtypeUsedSet.has(st) && subtypeHasRemaining(stMap, st)
      );
    });

    if (eligibleTopics.length === 0) {
      // Fallback A: relax sub-type uniqueness — allow any sub-type already used
      const relaxedTopics = Array.from(byTopicSubtype.entries()).filter(([slug, stMap]) => {
        if ((topicUsedCounts[slug] ?? 0) >= MAX_PER_TOPIC) return false;
        return Array.from(stMap.values()).some(probs => probs.some(p => !usedIds.has(p.id)));
      });

      if (relaxedTopics.length === 0) {
        // Fallback B: relax topic-per-day limit too
        const remaining = eligible.filter(p => !usedIds.has(p.id));
        if (remaining.length === 0) break; // truly exhausted
        const pick = remaining[Math.floor(Math.random() * remaining.length)];
        selected.push(pick);
        usedIds.add(pick.id);
        topicUsedCounts[getPrimaryTopic(pick.topic_tags)] = (topicUsedCounts[getPrimaryTopic(pick.topic_tags)] ?? 0) + 1;
        continue;
      }

      // Pick from relaxed topic list (uniform, ignore sub-type used constraint)
      const [rSlug, rStMap] = relaxedTopics[Math.floor(Math.random() * relaxedTopics.length)];
      const allRemaining = Array.from(rStMap.values()).flat().filter(p => !usedIds.has(p.id));
      const pick = allRemaining[Math.floor(Math.random() * allRemaining.length)];
      selected.push(pick);
      usedIds.add(pick.id);
      topicUsedCounts[rSlug] = (topicUsedCounts[rSlug] ?? 0) + 1;
      continue;
    }

    // Weighted topic pick (olt_score² × weight_override)
    const topicWeights = eligibleTopics.map(([slug]) => {
      const base     = TOPIC_SCORE_MAP[slug] ?? 1;
      const override = weightOverrides[slug] ?? 1;
      return Math.pow(base * override, 2);
    });
    const [pickedTopic, pickedStMap] = weightedPick(eligibleTopics, topicWeights);

    // ── Stage 2: pick sub-type (weighted by staleness) ────────────────────────
    const eligibleSubtypes = Array.from(pickedStMap.entries()).filter(
      ([st]) => !subtypeUsedSet.has(st) && subtypeHasRemaining(pickedStMap, st)
    );

    let pickedSubtype: string;
    let pickedSubtypeProbs: ProblemWithStatus[];

    if (eligibleSubtypes.length === 0) {
      // Shouldn't reach here (filtered in Stage 1), but handle defensively
      i--; continue;
    }

    const subtypeWeights = eligibleSubtypes.map(([st]) => {
      const s = stalenessMap[st];
      // Ensure there's always a non-zero weight even for just-solved sub-types
      return Math.max(s, 0.05);
    });
    [pickedSubtype, pickedSubtypeProbs] = weightedPick(eligibleSubtypes, subtypeWeights);

    // ── Stage 3: pick problem uniformly within sub-type ───────────────────────
    const available = pickedSubtypeProbs.filter(p => !usedIds.has(p.id));
    if (available.length === 0) { i--; continue; }

    const pick = available[Math.floor(Math.random() * available.length)];
    selected.push(pick);
    usedIds.add(pick.id);
    topicUsedCounts[pickedTopic]  = (topicUsedCounts[pickedTopic] ?? 0) + 1;
    subtypeUsedSet.add(pickedSubtype);
  }

  return selected;
}

// ── queue generation ──────────────────────────────────────────────────────────

async function generateQueue(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  date: string,
  settings: UserSettings | null,
  modeOverride?: DiffMode
): Promise<{ problems: ProblemWithStatus[]; exhausted: boolean }> {
  const cfg = resolveConfig(settings, modeOverride);

  // Fetch staleness map (sub-type → score) from last 30 days of SOLVED history
  const stalenessMap = await buildStalenessMap(supabase, userId, cfg.cooldownDays);

  // Fetch all eligible problems (not SOLVED, not paid).
  // Paginate in batches of 1000 — PostgREST's server-side max-rows cap
  // silently overrides any higher client .limit(), so a single query can
  // never return more than 1000 rows regardless of what the client requests.
  const allPool: ProblemWithStatus[] = [];
  const PAGE = 1000;
  for (let page = 0; ; page++) {
    const { data: batch, error } = await supabase
      .from('problems_with_status')
      .select('*')
      .eq('paid_only', false)
      .neq('status', 'SOLVED')
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    if (!batch || batch.length === 0) break;
    allPool.push(...(batch as ProblemWithStatus[]));
    if (batch.length < PAGE) break; // last page
  }

  // Split by platform source
  const lcPool   = allPool.filter(p => !p.source || p.source === 'leetcode');
  const csesPool = allPool.filter(p => p.source === 'cses');

  // Determine platform slots (proportional to unsolved counts in enabled sources)
  const enabledSources = cfg.enabledSources;
  const useLc   = enabledSources.includes('leetcode');
  const useCses = enabledSources.includes('cses');

  let lcSlots   = cfg.dailyCount;
  let csesSlots = 0;

  if (useLc && useCses && csesPool.length > 0 && lcPool.length > 0) {
    const lcCount   = lcPool.length;
    const csesCount = csesPool.length;
    // Guarantee at least 1 CSES slot even when proportional share rounds to 0
    csesSlots = Math.max(1, Math.round(cfg.dailyCount * csesCount / (lcCount + csesCount)));
    lcSlots   = cfg.dailyCount - csesSlots;
  } else if (!useLc && useCses) {
    lcSlots   = 0;
    csesSlots = cfg.dailyCount;
  }

  // Shared state across difficulty buckets (topic + sub-type usage guards)
  const topicUsedCounts: Record<string, number> = {};
  const subtypeUsedSet   = new Set<string>();

  function sampleFromPool(
    pool: ProblemWithStatus[],
    totalSlots: number,
    hardC: number,
    medC: number,
    easyC: number
  ): ProblemWithStatus[] {
    if (totalSlots <= 0) return [];

    const hard   = pool.filter(p => p.difficulty === 'HARD');
    const medium = pool.filter(p => p.difficulty === 'MEDIUM');
    const easy   = pool.filter(p => p.difficulty === 'EASY');

    const hardPicked   = threeStageSample(hard,   hardC,  cfg.enabledSlugs, cfg.weightOverrides, stalenessMap, topicUsedCounts, subtypeUsedSet);
    const mediumPicked = threeStageSample(medium, medC,   cfg.enabledSlugs, cfg.weightOverrides, stalenessMap, topicUsedCounts, subtypeUsedSet);
    const easyPicked   = threeStageSample(easy,   easyC,  cfg.enabledSlugs, cfg.weightOverrides, stalenessMap, topicUsedCounts, subtypeUsedSet);

    let picked = [...hardPicked, ...mediumPicked, ...easyPicked];

    // Fill up if buckets came short (pool might not have enough hard problems etc.)
    if (picked.length < totalSlots) {
      const usedIds    = new Set(picked.map(p => p.id));
      const remaining  = pool.filter(p => !usedIds.has(p.id));
      const filler     = threeStageSample(
        remaining, totalSlots - picked.length,
        cfg.enabledSlugs, cfg.weightOverrides, stalenessMap, topicUsedCounts, subtypeUsedSet
      );
      picked = [...picked, ...filler];
    }

    return picked;
  }

  // LC difficulty ratios (applied to both LC and CSES slots proportionally)
  const totalPreset  = cfg.hardCount + cfg.mediumCount + cfg.easyCount || 1;
  const lcHard       = Math.round(lcSlots   * cfg.hardCount   / totalPreset);
  const lcMedium     = Math.round(lcSlots   * cfg.mediumCount / totalPreset);
  const lcEasy       = lcSlots   - lcHard - lcMedium;
  const csesHard     = Math.round(csesSlots * cfg.hardCount   / totalPreset);
  const csesMedium   = Math.round(csesSlots * cfg.mediumCount / totalPreset);
  const csesEasy     = csesSlots - csesHard - csesMedium;

  const lcPicked     = useLc   ? sampleFromPool(lcPool,   lcSlots,   lcHard,   lcMedium,   lcEasy)   : [];
  const csesPicked   = useCses ? sampleFromPool(csesPool, csesSlots, csesHard, csesMedium, csesEasy) : [];

  const selected = shuffle([...lcPicked, ...csesPicked]);
  const exhausted = selected.length < cfg.dailyCount;

  // Persist: upsert daily_queues + append queue_history
  await supabase.from('daily_queues').upsert(
    { date, user_id: userId, problem_ids: selected.map(p => p.id) },
    { onConflict: 'date,user_id' }
  );

  try {
    const { data: versionRow } = await supabase
      .from('queue_history')
      .select('version')
      .eq('user_id', userId)
      .eq('date', date)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    const nextVersion = (versionRow?.version ?? 0) + 1;
    await supabase.from('queue_history').insert({
      user_id: userId,
      date,
      problem_ids: selected.map(p => p.id),
      version: nextVersion,
    });
  } catch {
    // queue_history table not yet created — silently skip
  }

  return { problems: selected, exhausted };
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
    let exhausted = false;

    if (existing?.problem_ids?.length) {
      const { data, error } = await supabase
        .from('problems_with_status')
        .select('*')
        .in('id', existing.problem_ids)
        .limit(existing.problem_ids.length + 10);
      if (error) throw error;
      const map = new Map((data as ProblemWithStatus[]).map(p => [p.id, p]));
      problems = existing.problem_ids.map((id: number) => map.get(id)!).filter(Boolean);
    } else {
      const { data: settingsRow } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();
      const result = await generateQueue(supabase, user.id, today, settingsRow as UserSettings | null);
      problems = result.problems;
      exhausted = result.exhausted;
    }

    return NextResponse.json({ date: today, problems, exhausted });
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

    const { data: settingsRow } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    const { problems, exhausted } = await generateQueue(
      supabase, user.id, date,
      settingsRow as UserSettings | null,
      modeOverride
    );

    return NextResponse.json({ date, problems, exhausted, regenerated: true });
  } catch (err: unknown) {
    console.error('[POST /api/queue]', err);
    return NextResponse.json({ error: 'Failed to regenerate queue' }, { status: 500 });
  }
}
