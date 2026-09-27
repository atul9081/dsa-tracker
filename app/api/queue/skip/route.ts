import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import type { ProblemWithStatus } from '@/types';
import type { UserSettings } from '@/types';
import { TOPIC_SCORE_MAP } from '@/config/topics';

function getTodayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * Weighted random pick with uniform fallback when all weights are 0.
 */
function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total === 0) return items[Math.floor(Math.random() * items.length)];
  let rand = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Returns the OLT topic slug with the highest score among a problem's tags. */
function getPrimaryTopic(topicTags: string[]): string {
  let best = '';
  let bestScore = -1;
  for (const tag of topicTags ?? []) {
    const score = TOPIC_SCORE_MAP[tag] ?? 0;
    if (score > bestScore) { bestScore = score; best = tag; }
  }
  return best || 'other';
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { problem_id } = await req.json();
    if (!problem_id) {
      return NextResponse.json({ error: 'problem_id required' }, { status: 400 });
    }

    const today = getTodayIST();

    // Load today's queue and user settings in parallel
    const [queueResult, settingsResult] = await Promise.all([
      supabase
        .from('daily_queues')
        .select('problem_ids')
        .eq('date', today)
        .eq('user_id', user.id)
        .single(),
      supabase
        .from('user_settings')
        .select('enabled_sources, enabled_topic_slugs')
        .eq('user_id', user.id)
        .single(),
    ]);

    if (queueResult.error || !queueResult.data) {
      return NextResponse.json({ error: 'No queue for today' }, { status: 404 });
    }

    const currentIds: number[] = queueResult.data.problem_ids;
    if (!currentIds.includes(problem_id)) {
      return NextResponse.json({ error: "Problem not in today's queue" }, { status: 400 });
    }

    // Resolve settings (gracefully degrade to LC-only if no settings row)
    const settings = settingsResult.data as UserSettings | null;
    const enabledSources: string[] = settings?.enabled_sources ?? ['leetcode'];
    const enabledSlugs:   string[] | null = settings?.enabled_topic_slugs ?? null;

    // Fetch the difficulty of the skipped problem so we can match it
    const { data: skippedProblem } = await supabase
      .from('problems_with_status')
      .select('difficulty, source')
      .eq('id', problem_id)
      .single();

    const targetDifficulty: string | null = skippedProblem?.difficulty ?? null;

    // Pull unsolved problems not in today's queue, filtered by enabled sources.
    // Paginate to bypass PostgREST server-side 1000-row cap.
    const pool: ProblemWithStatus[] = [];
    const PAGE = 1000;

    // Fix for Issue 8: filter pool by enabled_sources (previously ignored,
    // allowing CSES replacements when only LC was enabled and vice versa)
    const sourceFilter = enabledSources.length > 0 ? enabledSources : ['leetcode'];

    for (let page = 0; ; page++) {
      let query = supabase
        .from('problems_with_status')
        .select('*')
        .eq('paid_only', false)
        .neq('status', 'SOLVED')
        .not('id', 'in', `(${currentIds.join(',')})`)
        .in('source', sourceFilter)
        .range(page * PAGE, page * PAGE + PAGE - 1);

      // Fix for Issue 8: match difficulty of the skipped problem so a Hard skip
      // is replaced by a Hard problem, not an Easy one
      if (targetDifficulty) {
        query = query.eq('difficulty', targetDifficulty);
      }

      const { data: batch, error: pErr } = await query;
      if (pErr) throw pErr;
      if (!batch || batch.length === 0) break;
      pool.push(...(batch as ProblemWithStatus[]));
      if (batch.length < PAGE) break;
    }

    // If no same-difficulty match (pool exhausted for that difficulty), fall back
    // to any difficulty in the enabled sources
    let finalPool = pool;
    if (finalPool.length === 0 && targetDifficulty) {
      for (let page = 0; ; page++) {
        const { data: batch, error: pErr } = await supabase
          .from('problems_with_status')
          .select('*')
          .eq('paid_only', false)
          .neq('status', 'SOLVED')
          .not('id', 'in', `(${currentIds.join(',')})`)
          .in('source', sourceFilter)
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (pErr) throw pErr;
        if (!batch || batch.length === 0) break;
        finalPool.push(...(batch as ProblemWithStatus[]));
        if (batch.length < PAGE) break;
      }
    }

    if (finalPool.length === 0) {
      return NextResponse.json({ error: 'No replacement problems available' }, { status: 409 });
    }

    // Fix for Issue 8: apply topic filter using primary topic (consistent with
    // main queue generation), then fall back to unfiltered if nothing matches
    let filteredPool = enabledSlugs
      ? finalPool.filter(p => {
          const primary = getPrimaryTopic(p.topic_tags);
          if (primary === 'other') return (p.topic_tags ?? []).some(t => enabledSlugs.includes(t));
          return enabledSlugs.includes(primary);
        })
      : finalPool;

    if (filteredPool.length === 0) filteredPool = finalPool; // topic-filter fallback

    // Weighted pick by olt_score² (topic importance) — same weighting as stage 1
    const weights = filteredPool.map(p => Math.pow(p.olt_score || 1, 2));
    const replacement = weightedPick(filteredPool, weights);

    // Update daily_queues row: swap out the skipped problem
    const newIds = currentIds.map(id => (id === problem_id ? replacement.id : id));
    const { error: uErr } = await supabase
      .from('daily_queues')
      .update({ problem_ids: newIds })
      .eq('date', today)
      .eq('user_id', user.id);

    if (uErr) throw uErr;

    // Fix for Issue 9: update queue_history to reflect the post-skip queue state
    // (previously skips were not recorded, so history showed problems never seen)
    try {
      const { data: versionRow } = await supabase
        .from('queue_history')
        .select('version')
        .eq('user_id', user.id)
        .eq('date', today)
        .order('version', { ascending: false })
        .limit(1)
        .single();

      const nextVersion = (versionRow?.version ?? 0) + 1;
      await supabase.from('queue_history').insert({
        user_id:     user.id,
        date:        today,
        problem_ids: newIds,
        version:     nextVersion,
      });
    } catch {
      // queue_history table may not exist yet — non-fatal
    }

    return NextResponse.json({ replacement });
  } catch (err: unknown) {
    console.error('[POST /api/queue/skip]', err);
    return NextResponse.json({ error: 'Failed to skip problem' }, { status: 500 });
  }
}
