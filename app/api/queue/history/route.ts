import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

/**
 * GET /api/queue/history?days=30
 *
 * Returns all queue versions for each day in the last N days, grouped by date.
 * Each date entry exposes:
 *   - versions[]  — all versions newest-first, each with its own problem list
 *   - latest_solved_count / latest_total_count — convenience fields for the
 *     collapsed row summary in the history page (uses the latest version)
 *
 * Changed from Plan 4: previously only returned the latest version per date.
 * Now returns all versions so that completed queues from earlier in the day
 * (before a regen) remain visible in history.
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

    // Fetch all versions for this user, newest date + version first
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

    // Group rows by date — already sorted date DESC, version DESC
    const byDate = new Map<string, typeof historyRows>();
    for (const row of historyRows ?? []) {
      if (!byDate.has(row.date)) byDate.set(row.date, []);
      byDate.get(row.date)!.push(row);
    }

    // Helper: fetch problems for a given set of ids, preserving queue order
    async function fetchProblems(ids: number[]) {
      if (ids.length === 0) return [];
      const { data: problems } = await supabase
        .from('problems_with_status')
        .select('id, title, difficulty, status, sub_type, source')
        .in('id', ids)
        .limit(ids.length + 10);
      const map = new Map((problems ?? []).map((p: { id: number }) => [p.id, p]));
      return ids.map(id => map.get(id)).filter(Boolean);
    }

    const result = [];

    for (const [date, rows] of byDate) {
      if (!rows || rows.length === 0) continue;

      // Build version entries (rows are already newest-first)
      const versions = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const ids: number[] = row.problem_ids ?? [];
        if (ids.length === 0) continue;

        const ordered = await fetchProblems(ids);
        const solvedCount = (ordered as Array<{ status: string } | undefined>)
          .filter(p => p?.status === 'SOLVED').length;

        versions.push({
          version:      row.version,
          is_latest:    i === 0,  // first row = highest version = latest
          generated_at: row.generated_at,
          problems:     ordered,
          solved_count: solvedCount,
          total_count:  ordered.length,
        });
      }

      if (versions.length === 0) continue;

      result.push({
        date,
        // Convenience fields from the latest version for the collapsed summary row
        latest_solved_count: versions[0].solved_count,
        latest_total_count:  versions[0].total_count,
        versions,
      });
    }

    return NextResponse.json({ history: result });
  } catch (err: unknown) {
    console.error('[GET /api/queue/history]', err);
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 });
  }
}
