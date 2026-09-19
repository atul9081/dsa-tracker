import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: Request) {
  try {
    const { problem_id, status } = await req.json();

    if (!problem_id || !status) {
      return NextResponse.json({ error: 'problem_id and status are required' }, { status: 400 });
    }

    const validStatuses = ['TO_DO', 'ATTEMPTED', 'DEBUGGING', 'SOLVED'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('user_progress').upsert(
      { problem_id, status, updated_at: new Date().toISOString() },
      { onConflict: 'problem_id' }
    );

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('[POST /api/progress]', err);
    return NextResponse.json({ error: 'Failed to update progress' }, { status: 500 });
  }
}
