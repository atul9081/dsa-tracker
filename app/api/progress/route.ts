import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

const VALID_STATUSES = ['TO_DO', 'ATTEMPTING', 'SOLVED'];

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { problem_id, status, attempt_started_at, solve_duration_secs } = body;

    if (!problem_id || !status) {
      return NextResponse.json({ error: 'problem_id and status are required' }, { status: 400 });
    }
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // Build the upsert row — timing columns are optional and only written when provided
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: Record<string, any> = {
      problem_id,
      user_id: user.id,
      status,
      updated_at: new Date().toISOString(),
    };

    if (attempt_started_at !== undefined) {
      row.attempt_started_at = attempt_started_at;
    }

    // solve_duration_secs: cap at 4 hours (14400 s), discard if null/undefined
    if (solve_duration_secs !== undefined && solve_duration_secs !== null) {
      row.solve_duration_secs = Math.min(Number(solve_duration_secs), 14400);
    }

    // first_attempted_at: only set the very first time status goes to ATTEMPTING.
    // We check the existing row and preserve the existing value if set.
    if (status === 'ATTEMPTING' && attempt_started_at) {
      const { data: existing } = await supabase
        .from('user_progress')
        .select('first_attempted_at')
        .eq('problem_id', problem_id)
        .eq('user_id', user.id)
        .maybeSingle();

      row.first_attempted_at = existing?.first_attempted_at ?? attempt_started_at;
    }

    const { error } = await supabase
      .from('user_progress')
      .upsert(row, { onConflict: 'problem_id,user_id' });

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('[POST /api/progress]', err);
    return NextResponse.json({ error: 'Failed to update progress' }, { status: 500 });
  }
}
