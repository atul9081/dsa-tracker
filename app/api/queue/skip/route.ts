import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import type { ProblemWithStatus } from '@/types';
import { QUEUE_CONFIG } from '@/config/queue';

function getTodayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + w, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return items[i];
  }
  return items[items.length - 1];
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

    // Load today's queue
    const { data: queueRow, error: qErr } = await supabase
      .from('daily_queues')
      .select('problem_ids')
      .eq('date', today)
      .eq('user_id', user.id)
      .single();

    if (qErr || !queueRow) {
      return NextResponse.json({ error: 'No queue for today' }, { status: 404 });
    }

    const currentIds: number[] = queueRow.problem_ids;
    if (!currentIds.includes(problem_id)) {
      return NextResponse.json({ error: 'Problem not in today\'s queue' }, { status: 400 });
    }

    // Pull unsolved problems not already in today's queue
    // NOTE: .limit(3000) required — PostgREST default cap of 1000 excludes CSES problems (negative IDs)
    const { data: pool, error: pErr } = await supabase
      .from('problems_with_status')
      .select('*')
      .eq('paid_only', false)
      .neq('status', 'SOLVED')
      .not('id', 'in', `(${currentIds.join(',')})`)
      .limit(3000);


    if (pErr) throw pErr;
    if (!pool || pool.length === 0) {
      return NextResponse.json({ error: 'No replacement problems available' }, { status: 409 });
    }

    // Weighted pick (same logic as main queue generation)
    const weights = (pool as ProblemWithStatus[]).map(p => {
      const base = Math.pow(p.olt_score || 1, QUEUE_CONFIG.topicWeightExponent);
      return base * (QUEUE_CONFIG.difficultyMultiplier[p.difficulty as keyof typeof QUEUE_CONFIG.difficultyMultiplier] ?? 1);
    });
    const replacement = weightedPick(pool as ProblemWithStatus[], weights);

    // Update daily_queues row: swap out the skipped problem
    const newIds = currentIds.map(id => (id === problem_id ? replacement.id : id));
    const { error: uErr } = await supabase
      .from('daily_queues')
      .update({ problem_ids: newIds })
      .eq('date', today)
      .eq('user_id', user.id);

    if (uErr) throw uErr;

    return NextResponse.json({ replacement });
  } catch (err: unknown) {
    console.error('[POST /api/queue/skip]', err);
    return NextResponse.json({ error: 'Failed to skip problem' }, { status: 500 });
  }
}
