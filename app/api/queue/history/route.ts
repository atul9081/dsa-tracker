import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

/**
 * GET /api/queue/history?days=30
 *
 * Returns the most recent queue version for each day in the last N days.
 * Each entry includes problem details (current status, not status-at-time).
 */
export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(req.url);
    const days = Math.min(parseInt(url.searchParams.get('days') ?? '30', 10), 90);

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceDate = since.toISOString().slice(0, 10);

    // Fetch most recent version per date
    const { data: historyRows, error } = await supabase
      .from('queue_history')
      .select('date, version, problem_ids, generated_at')
      .eq('user_id', user.id)
      .gte('date', sinceDate)
      .order('date', { ascending: false })
      .order('version', { ascending: false });

    if (error) {
      // Table might not exist yet — return empty gracefully
      if (error.code === '42P01') return NextResponse.json({ history: [] });
      throw error;
    }

    // Keep only the most recent version per date
    const latestByDate = new Map<string, typeof historyRows[0]>();
    for (const row of (historyRows ?? [])) {
      if (!latestByDate.has(row.date)) latestByDate.set(row.date, row);
    }

    const result = [];
    for (const [date, row] of latestByDate) {
      const ids: number[] = row.problem_ids ?? [];
      if (ids.length === 0) continue;

      const { data: problems } = await supabase
        .from('problems_with_status')
        .select('id, title, difficulty, status, sub_type, source')
        .in('id', ids);

      // Preserve original queue order
      const map = new Map((problems ?? []).map((p: { id: number }) => [p.id, p]));
      const ordered = ids.map(id => map.get(id)).filter(Boolean);
      const solvedCount = (ordered as Array<{ status: string } | undefined>)
        .filter(p => p?.status === 'SOLVED').length;

      result.push({
        date,
        version: row.version,
        generated_at: row.generated_at,
        problems: ordered,
        solved_count: solvedCount,
        total_count: ordered.length,
      });
    }

    return NextResponse.json({ history: result });
  } catch (err: unknown) {
    console.error('[GET /api/queue/history]', err);
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 });
  }
}
