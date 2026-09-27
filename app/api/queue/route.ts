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

/** Convert any UTC ISO timestamp to an IST YYYY-MM-DD date string. */
function toISTDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Calendar-day gap between two YYYY-MM-DD strings (treated as UTC midnight). */
function daysBetweenDates(earlier: string, later: string): number {
  return (
    new Date(later   + 'T00:00:00Z').getTime() -
    new Date(earlier + 'T00:00:00Z').getTime()
  ) / 86_400_000;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pick one item from `items` using weighted random selection.
 * Falls back to uniform random if all weights are 0 (prevents always picking items[0]).
 */
function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total === 0) return items[Math.floor(Math.random() * items.length)]; // uniform fallback
  let rand = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Returns the OLT topic slug with the highest score among a problem's tags.
 * Falls back to 'other' if no recognized tag found.
 */
function getPrimaryTopic(topicTags: string[]): string {
  let best = '';
  let bestScore = -1;
  for (const tag of topicTags ?? []) {
    const score = TOPIC_SCORE_MAP[tag] ?? 0;
    if (score > bestScore) { bestScore = score; best = tag; }
  }
  return best || 'other';
}

/**
 * Returns a deterministic sub-type bucket key for a problem.
 *
 * Fix for Issues 2 & 4: previously all problems with sub_type=null shared a single
 * '__unknown__' bucket, which meant MAX_PER_SUBTYPE=1 capped the entire 681-problem
 * null pool at 1 per queue, and solving one null-subtype problem blocked all others.
 *
 * Fix for Issue 12: previously two topics that shared the same sub_type string (e.g.
 * 'prefix-sum' appears in both 'array' and 'tree') would collide in subtypeUsedSet,
 * causing a solve in one topic to cool down an unrelated topic. Keys are now
 * topic-qualified as `${primaryTopic}:${sub_type}`.
 */
function getSubtypeKey(p: ProblemWithStatus): string {
  if (!p.sub_type) return `__solo_${p.id}__`;
  return `${getPrimaryTopic(p.topic_tags)}:${p.sub_type}`;
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
  csesRatio: number | null;   // null = auto (proportional to pool sizes)
}

/**
 * Fix for Issue 1: previously daily_count from user_settings was loaded but
 * discarded — resolveConfig always computed dailyCount = preset sum (always 5).
 *
 * Now: for non-custom modes, scale the preset difficulty ratio to match the
 * user's chosen daily_count. E.g. Standard (2H+3M) at daily_count=7 →
 * 3H+4M (rounding, with remainder absorbed into easy).
 */
function resolveConfig(settings: UserSettings | null, modeOverride?: DiffMode): QueueCfg {
  const mode: DiffMode = modeOverride ?? (settings?.difficulty_mode as DiffMode) ?? 'standard';

  let hardCount: number;
  let mediumCount: number;
  let easyCount: number;

  if (mode === 'custom' && settings) {
    // Custom mode: use the explicit per-difficulty counts directly
    hardCount   = settings.hard_count   ?? QUEUE_CONFIG.hardCount;
    mediumCount = settings.medium_count ?? QUEUE_CONFIG.mediumCount;
    easyCount   = settings.easy_count   ?? QUEUE_CONFIG.easyCount;
  } else if (mode !== 'custom') {
    const preset     = MODE_PRESETS[mode];
    const presetSum  = preset.hard + preset.medium + preset.easy || 1;
    const target     = settings?.daily_count ?? presetSum;

    if (target === presetSum) {
      // No scaling needed
      hardCount   = preset.hard;
      mediumCount = preset.medium;
      easyCount   = preset.easy;
    } else {
      // Scale preset ratio to the user's requested daily count
      hardCount   = Math.round(target * preset.hard   / presetSum);
      mediumCount = Math.round(target * preset.medium / presetSum);
      easyCount   = target - hardCount - mediumCount; // absorb rounding into easy
      // Guard against negative counts from rounding edge cases
      if (easyCount   < 0) { mediumCount += easyCount;   easyCount   = 0; }
      if (mediumCount < 0) { hardCount   += mediumCount; mediumCount = 0; }
    }
  } else {
    hardCount   = QUEUE_CONFIG.hardCount;
    mediumCount = QUEUE_CONFIG.mediumCount;
    easyCount   = QUEUE_CONFIG.easyCount;
  }

  return {
    dailyCount:      hardCount + mediumCount + easyCount,
    hardCount,
    mediumCount,
    easyCount,
    enabledSlugs:    settings?.enabled_topic_slugs ?? null,
    enabledSources:  settings?.enabled_sources ?? ['leetcode'],
    weightOverrides: settings?.topic_weight_overrides ?? {},
    cooldownDays:    settings?.cooldown_days ?? 7,
    csesRatio:       settings?.cses_ratio ?? null,
  };
}

// ── staleness computation ─────────────────────────────────────────────────────

/**
 * Build a map from subtypeKey → staleness score ∈ [0, 1].
 *   1.0 = never practiced, or last solved ≥ cooldownDays ago (highest priority)
 *   0.0 = solved today (lowest priority, effectively on cooldown)
 *
 * subtypeKey matches the value returned by getSubtypeKey():
 *   `${primaryTopic}:${sub_type}`  for classified problems
 *   `__solo_${id}__`               for unclassified problems
 *
 * Fix for Issue 10: previously used raw `new Date()` (UTC wall time) for both
 * "today" and elapsed-days calculation, while the queue's date is always in IST.
 * Near midnight UTC (≈05:30 IST) this caused staleness to be off by up to ~0.23
 * of a cooldown period. Now converts all timestamps to IST date strings so that
 * "today" and "last solve day" are on the same calendar.
 *
 * Fix for Issues 2 & 4: now joins to problems.id so unclassified problems can be
 * tracked individually via `__solo_${id}__` instead of all sharing '__unknown__'.
 */
async function buildStalenessMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  cooldownDays: number
): Promise<Record<string, number>> {
  const todayIST = getTodayIST();
  const since    = new Date(Date.now() - 30 * 86_400_000).toISOString();

  // Join to problems so we can read sub_type, id, and topic_tags for key construction
  const { data: solves } = await supabase
    .from('user_progress')
    .select('updated_at, problems!inner(id, sub_type, topic_tags)')
    .eq('user_id', userId)
    .eq('status', 'SOLVED')
    .gte('updated_at', since);

  // Track latest IST solve date per subtypeKey
  const lastSolvedByKey: Record<string, string> = {};   // key → 'YYYY-MM-DD' IST
  for (const row of solves ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (row as any).problems as {
      id: number; sub_type: string | null; topic_tags: string[];
    } | null;
    if (!p) continue;

    const key = p.sub_type
      ? `${getPrimaryTopic(p.topic_tags ?? [])}:${p.sub_type}`
      : `__solo_${p.id}__`;

    const solveIST = toISTDate(row.updated_at as string);
    if (!lastSolvedByKey[key] || solveIST > lastSolvedByKey[key]) {
      lastSolvedByKey[key] = solveIST;
    }
  }

  return new Proxy({} as Record<string, number>, {
    get(_, key: string) {
      const lastIST = lastSolvedByKey[key];
      if (!lastIST) return 1.0;  // never practiced → fully stale → highest priority
      const days = daysBetweenDates(lastIST, todayIST);
      return Math.min(Math.max(days, 0), cooldownDays) / cooldownDays;
    },
  });
}

// ── 3-stage weighted sampler ──────────────────────────────────────────────────

const MAX_PER_TOPIC   = 3; // max problems per topic in a single day's queue
const MAX_PER_SUBTYPE = 1; // max problems per sub-type key in a single day's queue
void MAX_PER_SUBTYPE; // referenced implicitly via subtypeUsedSet membership check

/**
 * 3-Stage selection algorithm:
 *   Stage 1 — Pick topic (weighted by olt_score² × weight_override)
 *   Stage 2 — Pick sub-type within topic (weighted by staleness)
 *   Stage 3 — Pick problem within sub-type (uniform)
 *
 * Falls back gracefully when sub-types or topics are exhausted.
 *
 * Fix for Issue 3: the eligible filter previously accepted a problem if ANY of its
 * tags appeared in enabledSlugs. This caused problems to be bucketed under their
 * HIGH-SCORE primary topic even when only a low-score secondary tag was enabled —
 * i.e. a [array, dynamic-programming] problem with only array enabled would pass
 * the filter but land in the DP bucket (DP was not enabled).
 * Now the filter uses the PRIMARY topic, so only problems whose primary topic is
 * enabled are included. For 'other' primary (no recognized OLT tag), falls back
 * to any matching tag to avoid excluding edge-case problems.
 *
 * Fix for Issue 12: subtypeUsedSet now stores topic-qualified keys (from
 * getSubtypeKey) instead of raw sub_type strings, preventing cross-topic
 * cooldown collision when two topics share the same sub_type name.
 */
function threeStageSample(
  pool: ProblemWithStatus[],              // pre-filtered by difficulty
  count: number,
  enabledSlugs: string[] | null,
  weightOverrides: Record<string, number>,
  stalenessMap: Record<string, number>,
  topicUsedCounts: Record<string, number>, // mutated in-place (shared across difficulty calls)
  subtypeUsedSet: Set<string>,             // mutated in-place; stores topic-qualified keys
  maxPerTopic: number                      // UX #3: dynamic cap = max(1, floor(dailyCount/3))
): ProblemWithStatus[] {
  if (count <= 0 || pool.length === 0) return [];

  // Filter by enabled topics using the primary topic (not any tag)
  const eligible = enabledSlugs
    ? pool.filter(p => {
        const primary = getPrimaryTopic(p.topic_tags);
        // For unrecognized primaries, fall back to any enabled tag
        if (primary === 'other') return (p.topic_tags ?? []).some(t => enabledSlugs.includes(t));
        return enabledSlugs.includes(primary);
      })
    : pool;

  if (eligible.length === 0) return [];

  // Group problems by (primary_topic, subtypeKey) — 2-level map
  // Inner map key = getSubtypeKey(p) = topic-qualified subtype or __solo_id__
  const byTopicSubtype = new Map<string, Map<string, ProblemWithStatus[]>>();
  for (const p of eligible) {
    const topic      = getPrimaryTopic(p.topic_tags);
    const subtypeKey = getSubtypeKey(p);
    if (!byTopicSubtype.has(topic))           byTopicSubtype.set(topic, new Map());
    if (!byTopicSubtype.get(topic)!.has(subtypeKey)) byTopicSubtype.get(topic)!.set(subtypeKey, []);
    byTopicSubtype.get(topic)!.get(subtypeKey)!.push(p);
  }

  const selected: ProblemWithStatus[] = [];
  const usedIds = new Set<number>();

  function subtypeHasRemaining(stMap: Map<string, ProblemWithStatus[]>, st: string): boolean {
    return (stMap.get(st) ?? []).some(p => !usedIds.has(p.id));
  }

  for (let i = 0; i < count; i++) {
    // ── Stage 1: pick topic ───────────────────────────────────────────────────
    const eligibleTopics = Array.from(byTopicSubtype.entries()).filter(([slug, stMap]) => {
      if ((topicUsedCounts[slug] ?? 0) >= maxPerTopic) return false;
      return Array.from(stMap.keys()).some(
        st => !subtypeUsedSet.has(st) && subtypeHasRemaining(stMap, st)
      );
    });

    if (eligibleTopics.length === 0) {
      // Fallback A: relax sub-type uniqueness — allow already-used sub-types
      const relaxedTopics = Array.from(byTopicSubtype.entries()).filter(([slug, stMap]) => {
        if ((topicUsedCounts[slug] ?? 0) >= maxPerTopic) return false;
        return Array.from(stMap.values()).some(probs => probs.some(p => !usedIds.has(p.id)));
      });

      if (relaxedTopics.length === 0) {
        // Fallback B: relax topic-per-day limit too
        const remaining = eligible.filter(p => !usedIds.has(p.id));
        if (remaining.length === 0) break; // truly exhausted
        const pick = remaining[Math.floor(Math.random() * remaining.length)];
        selected.push(pick);
        usedIds.add(pick.id);
        const t = getPrimaryTopic(pick.topic_tags);
        topicUsedCounts[t] = (topicUsedCounts[t] ?? 0) + 1;
        continue;
      }

      const [rSlug, rStMap] = relaxedTopics[Math.floor(Math.random() * relaxedTopics.length)];
      const allRemaining    = Array.from(rStMap.values()).flat().filter(p => !usedIds.has(p.id));
      const pick            = allRemaining[Math.floor(Math.random() * allRemaining.length)];
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

    if (eligibleSubtypes.length === 0) { i--; continue; } // shouldn't happen; defensive

    const subtypeWeights = eligibleSubtypes.map(([st]) =>
      Math.max(stalenessMap[st], 0.05)  // floor at 0.05 so just-solved still has a tiny chance
    );
    const [pickedKey, pickedSubtypeProbs] = weightedPick(eligibleSubtypes, subtypeWeights);

    // ── Stage 3: pick problem uniformly within sub-type ───────────────────────
    const available = pickedSubtypeProbs.filter(p => !usedIds.has(p.id));
    if (available.length === 0) { i--; continue; }

    const pick = available[Math.floor(Math.random() * available.length)];
    selected.push(pick);
    usedIds.add(pick.id);
    topicUsedCounts[pickedTopic] = (topicUsedCounts[pickedTopic] ?? 0) + 1;
    subtypeUsedSet.add(pickedKey); // topic-qualified key → no cross-topic collision
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
): Promise<{ problems: ProblemWithStatus[]; exhausted: boolean; dailyCount: number }> {
  const cfg = resolveConfig(settings, modeOverride);

  // Fetch staleness map (subtypeKey → score) from last 30 days of SOLVED history
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
    // Explicit ratio: respect it exactly (0% CSES → 0 CSES slots is valid).
    // Auto (null): proportional to pool sizes, floor at 1 so CSES is never
    // accidentally rounded away when pool is much smaller than LC.
    if (cfg.csesRatio != null) {
      const ratio = Math.min(1, Math.max(0, cfg.csesRatio));
      csesSlots = Math.round(cfg.dailyCount * ratio);
    } else {
      const autoRatio = csesPool.length / (lcPool.length + csesPool.length);
      csesSlots = Math.max(1, Math.round(cfg.dailyCount * autoRatio));
    }
    lcSlots = cfg.dailyCount - csesSlots;
  } else if (!useLc && useCses) {
    lcSlots   = 0;
    csesSlots = cfg.dailyCount;
  }

  // Shared state across difficulty buckets (topic + sub-type usage guards)
  const topicUsedCounts: Record<string, number> = {};
  const subtypeUsedSet   = new Set<string>();
  // UX #3: cap problems per topic dynamically — max(1, floor(dailyCount/3)) so that
  // a 5-problem day allows at most 1 per topic (not 3 = 60% from one topic).
  const maxPerTopic = Math.max(1, Math.floor(cfg.dailyCount / 3));

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

    const hardPicked   = threeStageSample(hard,   hardC, cfg.enabledSlugs, cfg.weightOverrides, stalenessMap, topicUsedCounts, subtypeUsedSet, maxPerTopic);
    const mediumPicked = threeStageSample(medium, medC,  cfg.enabledSlugs, cfg.weightOverrides, stalenessMap, topicUsedCounts, subtypeUsedSet, maxPerTopic);
    const easyPicked   = threeStageSample(easy,   easyC, cfg.enabledSlugs, cfg.weightOverrides, stalenessMap, topicUsedCounts, subtypeUsedSet, maxPerTopic);

    let picked = [...hardPicked, ...mediumPicked, ...easyPicked];

    // Fill up if difficulty buckets came short (e.g. not enough hard problems)
    if (picked.length < totalSlots) {
      const usedIds   = new Set(picked.map(p => p.id));
      const remaining = pool.filter(p => !usedIds.has(p.id));
      const filler    = threeStageSample(
        remaining, totalSlots - picked.length,
        cfg.enabledSlugs, cfg.weightOverrides, stalenessMap, topicUsedCounts, subtypeUsedSet, maxPerTopic
      );
      picked = [...picked, ...filler];
    }

    return picked;
  }

  // Apply the configured difficulty ratio to each platform's slot allocation.
  // For CSES this uses the same ratio as LC — if CSES pool has fewer hard
  // problems those slots automatically fall through to the filler path.
  const totalPreset = cfg.hardCount + cfg.mediumCount + cfg.easyCount || 1;
  const lcHard      = Math.round(lcSlots   * cfg.hardCount   / totalPreset);
  const lcMedium    = Math.round(lcSlots   * cfg.mediumCount / totalPreset);
  const lcEasy      = lcSlots   - lcHard   - lcMedium;
  const csesHard    = Math.round(csesSlots * cfg.hardCount   / totalPreset);
  const csesMedium  = Math.round(csesSlots * cfg.mediumCount / totalPreset);
  const csesEasy    = csesSlots - csesHard - csesMedium;

  const lcPicked   = useLc   ? sampleFromPool(lcPool,   lcSlots,   lcHard,   lcMedium,   lcEasy)   : [];
  const csesPicked = useCses ? sampleFromPool(csesPool, csesSlots, csesHard, csesMedium, csesEasy) : [];

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
      user_id:     userId,
      date,
      problem_ids: selected.map(p => p.id),
      version:     nextVersion,
    });
  } catch {
    // queue_history table may not exist yet — non-fatal
    console.warn('[queue] queue_history insert skipped (table may not exist)');
  }

  return { problems: selected, exhausted, dailyCount: cfg.dailyCount };
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
    let dailyCount = 0;

    if (existing?.problem_ids?.length) {
      const { data, error } = await supabase
        .from('problems_with_status')
        .select('*')
        .in('id', existing.problem_ids)
        .limit(existing.problem_ids.length + 10);
      if (error) throw error;
      const map = new Map((data as ProblemWithStatus[]).map(p => [p.id, p]));
      problems = existing.problem_ids.map((id: number) => map.get(id)!).filter(Boolean);
      // Read settings to know the configured daily target even for existing queues
      const { data: settingsRow } = await supabase
        .from('user_settings').select('*').eq('user_id', user.id).single();
      dailyCount = resolveConfig(settingsRow as UserSettings | null).dailyCount;
    } else {
      const { data: settingsRow } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();
      const result = await generateQueue(supabase, user.id, today, settingsRow as UserSettings | null);
      problems  = result.problems;
      exhausted = result.exhausted;
      dailyCount = result.dailyCount;
    }

    return NextResponse.json({ date: today, problems, exhausted, dailyCount });
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

    const { problems, exhausted, dailyCount } = await generateQueue(
      supabase, user.id, date,
      settingsRow as UserSettings | null,
      modeOverride
    );

    return NextResponse.json({ date, problems, exhausted, dailyCount, regenerated: true });
  } catch (err: unknown) {
    console.error('[POST /api/queue]', err);
    return NextResponse.json({ error: 'Failed to regenerate queue' }, { status: 500 });
  }
}
