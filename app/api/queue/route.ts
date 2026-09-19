import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import type { ProblemWithStatus } from '@/types';
import { QUEUE_CONFIG } from '@/config/queue';

// ── helpers ───────────────────────────────────────────────────────────────────
function getTodayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function weightedSample(items: ProblemWithStatus[], count: number): ProblemWithStatus[] {
  if (items.length === 0) return [];
  const pool = [...items];
  const selected: ProblemWithStatus[] = [];

  for (let i = 0; i < count && pool.length > 0; i++) {
    const weights = pool.map(p => {
      const base = Math.pow(p.olt_score || 1, QUEUE_CONFIG.topicWeightExponent);
      return base * QUEUE_CONFIG.difficultyMultiplier[p.difficulty as keyof typeof QUEUE_CONFIG.difficultyMultiplier];
    });
    const total = weights.reduce((s, w) => s + w, 0);
    let rand = Math.random() * total;
    let idx = 0;
    for (let j = 0; j < weights.length; j++) {
      rand -= weights[j];
      if (rand <= 0) { idx = j; break; }
    }
    selected.push(pool.splice(idx, 1)[0]);
  }
  return selected;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── queue generation ──────────────────────────────────────────────────────────
async function generateQueue(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  date: string
): Promise<ProblemWithStatus[]> {
  // problems_with_status view uses auth.uid() via RLS — returns per-user status
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

  let selected: ProblemWithStatus[] = [];

  const hardPicked = weightedSample(hard, QUEUE_CONFIG.hardCount);
  selected.push(...hardPicked);

  const mediumPicked = weightedSample(medium, QUEUE_CONFIG.mediumCount);
  selected.push(...mediumPicked);
  if (mediumPicked.length < QUEUE_CONFIG.mediumCount) {
    selected.push(...weightedSample(easy, QUEUE_CONFIG.mediumCount - mediumPicked.length));
  }

  if (QUEUE_CONFIG.easyCount > 0) {
    const remaining = easy.filter(p => !selected.find(s => s.id === p.id));
    selected.push(...weightedSample(remaining, QUEUE_CONFIG.easyCount));
  }

  if (selected.length < QUEUE_CONFIG.dailyCount) {
    const usedIds = new Set(selected.map(p => p.id));
    const remaining = pool.filter(p => !usedIds.has(p.id));
    selected.push(...weightedSample(remaining, QUEUE_CONFIG.dailyCount - selected.length));
  }

  selected = shuffle(selected);

  await supabase.from('daily_queues').upsert({
    date,
    user_id: userId,
    problem_ids: selected.map(p => p.id),
  }, { onConflict: 'date,user_id' });

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
      problems = await generateQueue(supabase, user.id, today);
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

    await supabase.from('daily_queues').delete()
      .eq('date', date)
      .eq('user_id', user.id);

    const problems = await generateQueue(supabase, user.id, date);
    return NextResponse.json({ date, problems, regenerated: true });
  } catch (err: unknown) {
    console.error('[POST /api/queue]', err);
    return NextResponse.json({ error: 'Failed to regenerate queue' }, { status: 500 });
  }
}
