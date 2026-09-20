import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

/**
 * Returns the user's current consecutive solve-day streak (IST timezone-aware).
 * A "day" counts if at least one problem has status=SOLVED with updated_at on that date.
 * Streak is counted backwards from today; a gap of 1 day breaks it.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all SOLVED timestamps (IST date string YYYY-MM-DD)
    const { data, error } = await supabase
      .from('user_progress')
      .select('updated_at')
      .eq('user_id', user.id)
      .eq('status', 'SOLVED')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) return NextResponse.json({ streak: 0, lastSolvedDate: null });

    // Convert each timestamp to an IST date string and deduplicate
    const solveDates = [...new Set(
      data.map(row =>
        new Date(row.updated_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      )
    )].sort().reverse(); // newest first

    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Streak must start from today or yesterday (allow for problems solved earlier today)
    const mostRecent = solveDates[0];
    const dayDiff = daysBetween(mostRecent, todayIST);
    if (dayDiff > 1) {
      // Streak broken — last solve was more than 1 day ago
      return NextResponse.json({ streak: 0, lastSolvedDate: mostRecent });
    }

    // Count consecutive days
    let streak = 1;
    for (let i = 1; i < solveDates.length; i++) {
      const diff = daysBetween(solveDates[i], solveDates[i - 1]);
      if (diff === 1) {
        streak++;
      } else {
        break;
      }
    }

    return NextResponse.json({ streak, lastSolvedDate: mostRecent });
  } catch (err) {
    console.error('[GET /api/streak]', err);
    return NextResponse.json({ streak: 0, lastSolvedDate: null });
  }
}

/** Number of calendar days between two 'YYYY-MM-DD' strings (a is earlier). */
function daysBetween(earlier: string, later: string): number {
  const a = new Date(earlier + 'T00:00:00Z');
  const b = new Date(later  + 'T00:00:00Z');
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
