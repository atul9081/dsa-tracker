import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function getAdminUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: access } = await adminSupabase
    .from('user_access')
    .select('is_admin')
    .eq('user_id', user.id)
    .single();
  return access?.is_admin ? user : null;
}

// GET /api/admin/stats — per-user medium analytics
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // All granted users
  const { data: accessRows } = await adminSupabase
    .from('user_access')
    .select('user_id, email, display_name')
    .eq('granted', true);

  if (!accessRows || accessRows.length === 0) return NextResponse.json({ stats: [] });

  const userIds = accessRows.map(r => r.user_id);

  // Solved counts per user
  const { data: progress } = await adminSupabase
    .from('user_progress')
    .select('user_id, status, topic_tags, updated_at')
    .in('user_id', userIds);

  // Queue generation counts per user
  const { data: queues } = await adminSupabase
    .from('queue_history')
    .select('user_id')
    .in('user_id', userIds);

  // Aggregate per user
  const stats = accessRows.map(user => {
    const userProgress = (progress ?? []).filter(p => p.user_id === user.user_id);
    const solved = userProgress.filter(p => p.status === 'SOLVED');
    const attempting = userProgress.filter(p => p.status === 'ATTEMPTING');

    // Top topics from solved problems
    const topicCounts: Record<string, number> = {};
    for (const p of solved) {
      const tags: string[] = p.topic_tags ?? [];
      if (tags[0]) topicCounts[tags[0]] = (topicCounts[tags[0]] ?? 0) + 1;
    }
    const topTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([topic]) => topic);

    // Last active = most recent updated_at
    const lastActive = userProgress.length > 0
      ? userProgress.map(p => p.updated_at).filter(Boolean).sort().at(-1) ?? null
      : null;

    const queuesGenerated = (queues ?? []).filter(q => q.user_id === user.user_id).length;

    return {
      user_id:          user.user_id,
      email:            user.email,
      display_name:     user.display_name,
      total_solved:     solved.length,
      total_attempting: attempting.length,
      queues_generated: queuesGenerated,
      top_topics:       topTopics,
      last_active:      lastActive,
    };
  });

  return NextResponse.json({ stats });
}
