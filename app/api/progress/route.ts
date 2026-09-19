import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

const VALID_STATUSES = ['TO_DO', 'ATTEMPTING', 'SOLVED'];

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { problem_id, status } = await req.json();

    if (!problem_id || !status) {
      return NextResponse.json({ error: 'problem_id and status are required' }, { status: 400 });
    }
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const { error } = await supabase.from('user_progress').upsert(
      { problem_id, user_id: user.id, status, updated_at: new Date().toISOString() },
      { onConflict: 'problem_id,user_id' }
    );

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('[POST /api/progress]', err);
    return NextResponse.json({ error: 'Failed to update progress' }, { status: 500 });
  }
}
