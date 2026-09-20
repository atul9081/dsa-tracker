'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ProblemWithStatus, Status, Difficulty } from '@/types';
import { OLT_TOPICS } from '@/config/topics';

// ── Types ──────────────────────────────────────────────────────────────────────

type DateFilter = 'all' | 'month' | 'week';

interface Progress {
  problem_id: number;
  status: Status;
  updated_at: string;
  first_attempted_at: string | null;
  solve_duration_secs: number | null;
}

interface Stats {
  total: number;
  byStatus: Record<Status, number>;
  byDiff: Record<Difficulty, { solved: number; total: number }>;
  byTopic: Array<{ name: string; slug: string; score: number; solved: number; attempted: number; total: number; avgSecs: number | null }>;
  streak: number;
  heatmap: Record<string, number>;    // date → solve count
  weeklyAvgSecs: Array<{ week: string; avgSecs: number; count: number }>;
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function toIST(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatMins(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function weekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: '12px', padding: '20px 24px', flex: '1 1 120px',
    }}>
      <div style={{ fontSize: '28px', fontWeight: 800, color: color ?? 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, marginTop: '4px' }}>{label}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', opacity: 0.7 }}>{sub}</div>}
    </div>
  );
}

function ProgressBar({ label, solved, total, color }: { label: string; solved: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((solved / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{ width: '80px', fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600, flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, background: 'var(--bg-elevated)', borderRadius: '4px', height: '10px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.6s ease' }} />
      </div>
      <div style={{ width: '90px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>
        {solved} / {total}
      </div>
    </div>
  );
}

function StatusPie({ byStatus }: { byStatus: Record<Status, number> }) {
  const STATUS_COLORS: Record<Status, string> = {
    SOLVED: 'var(--accent-green)', ATTEMPTING: 'var(--accent-amber)', TO_DO: 'var(--accent-gray)',
  };
  const entries = (Object.entries(byStatus) as [Status, number][]).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
      <svg width="120" height="120" viewBox="0 0 42 42">
        {(() => {
          let offset = 0;
          return entries.map(([st, val]) => {
            const pct = (val / total) * 100;
            const el = (
              <circle key={st} cx="21" cy="21" r="15.9155" fill="transparent"
                stroke={STATUS_COLORS[st]} strokeWidth="5"
                strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={-offset}
                style={{ transform: 'rotate(-90deg)', transformOrigin: 'center', transition: 'stroke-dasharray 0.6s' }}
              />
            );
            offset += pct;
            return el;
          });
        })()}
        <text x="21" y="25" textAnchor="middle" fontSize="8" fill="var(--text-primary)" fontWeight="700">{total}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {entries.map(([st, val]) => (
          <div key={st} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: STATUS_COLORS[st], flexShrink: 0 }} />
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              {st.charAt(0) + st.slice(1).toLowerCase().replace('_', ' ')} — <strong style={{ color: 'var(--text-primary)' }}>{val}</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** GitHub-style 90-day heatmap. */
function Heatmap({ heatmap }: { heatmap: Record<string, number> }) {
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const DAYS = 91;
  const cells: Array<{ date: string; count: number }> = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = addDays(todayIST, -i);
    cells.push({ date, count: heatmap[date] ?? 0 });
  }

  const maxCount = Math.max(1, ...Object.values(heatmap));

  function cellColor(count: number): string {
    if (count === 0) return 'var(--bg-elevated)';
    const intensity = Math.min(count / Math.min(maxCount, 4), 1);
    const l = Math.round(55 - intensity * 30);
    return `hsl(142, 65%, ${l}%)`;
  }

  // Group into weeks (columns of 7)
  const weeks: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: '3px', minWidth: 'max-content' }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {week.map(({ date, count }) => (
              <div
                key={date}
                title={`${date}: ${count} solved`}
                style={{
                  width: '13px', height: '13px',
                  borderRadius: '3px',
                  background: cellColor(count),
                  border: count > 0 ? '1px solid rgba(255,255,255,0.08)' : '1px solid var(--border)',
                  cursor: 'default',
                  transition: 'transform 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.3)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
              />
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', fontSize: '11px', color: 'var(--text-muted)' }}>
        <span>Less</span>
        {[0, 1, 2, 3, 4].map(n => (
          <div key={n} style={{
            width: '11px', height: '11px', borderRadius: '2px',
            background: cellColor(n === 0 ? 0 : n),
            border: n === 0 ? '1px solid var(--border)' : 'none',
          }} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

/** Topic weakness map sorted by solve rate ascending. */
function WeaknessMap({ byTopic }: { byTopic: Stats['byTopic'] }) {
  const sorted = [...byTopic]
    .filter(t => t.attempted > 0)
    .sort((a, b) => {
      const ra = a.attempted > 0 ? a.solved / a.attempted : 1;
      const rb = b.attempted > 0 ? b.solved / b.attempted : 1;
      return ra - rb; // weakest first
    });

  if (sorted.length === 0) return (
    <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
      No attempted problems yet. Start solving to see your weaknesses!
    </p>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Topic', 'Attempted', 'Solved', 'Rate', 'Avg Time'].map(h => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '11px', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, i) => {
            const rate = t.attempted > 0 ? Math.round((t.solved / t.attempted) * 100) : 0;
            const isWeak = rate < 40;
            return (
              <tr key={t.slug} style={{ borderBottom: '1px solid var(--border)', background: i === 0 ? 'var(--diff-hard)11' : 'transparent' }}>
                <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontWeight: 500 }}>
                  {i === 0 && <span title="Your weakest topic" style={{ marginRight: '6px' }}>⚠️</span>}
                  {t.name}
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{t.attempted}</td>
                <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{t.solved}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    color: isWeak ? 'var(--diff-hard)' : rate >= 70 ? 'var(--accent-green)' : 'var(--accent-amber)',
                    fontWeight: 600,
                  }}>
                    {rate}%
                  </span>
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>
                  {t.avgSecs !== null ? formatMins(Math.round(t.avgSecs)) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Weekly solve-speed bar chart (CSS-based). */
function SpeedChart({ weekly }: { weekly: Stats['weeklyAvgSecs'] }) {
  if (weekly.length === 0) return (
    <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
      No solve-time data yet. Timer data will appear here once you solve problems.
    </p>
  );
  const maxSecs = Math.max(...weekly.map(w => w.avgSecs), 1);
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', overflowX: 'auto', paddingBottom: '4px', minHeight: '100px' }}>
      {weekly.map(w => {
        const pct = (w.avgSecs / maxSecs) * 100;
        return (
          <div key={w.week} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flexShrink: 0, minWidth: '48px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {formatMins(Math.round(w.avgSecs))}
            </span>
            <div
              title={`Week of ${w.week}: avg ${formatMins(Math.round(w.avgSecs))} over ${w.count} problem${w.count !== 1 ? 's' : ''}`}
              style={{
                width: '36px',
                height: `${Math.max(pct, 4)}px`,
                background: 'var(--accent-blue)',
                borderRadius: '4px 4px 0 0',
                opacity: 0.85,
                transition: 'height 0.4s',
                minHeight: '4px',
              }}
            />
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {weekLabel(w.week)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [allProblems, setAllProblems]   = useState<ProblemWithStatus[]>([]);
  const [allProgress, setAllProgress]   = useState<Progress[]>([]);
  const [loading, setLoading]           = useState(true);
  const [dateFilter, setDateFilter]     = useState<DateFilter>('all');
  const [streak, setStreak]             = useState(0);

  useEffect(() => {
    (async () => {
      const { createBrowserClient } = await import('@supabase/ssr');
      const sb = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const [{ data: pData }, { data: progData }, streakRes] = await Promise.all([
        sb.from('problems_with_status').select('*'),
        sb.from('user_progress').select('problem_id,status,updated_at,first_attempted_at,solve_duration_secs').eq('status', 'SOLVED'),
        fetch('/api/streak').then(r => r.json()).catch(() => ({ streak: 0 })),
      ]);
      setAllProblems((pData as ProblemWithStatus[]) ?? []);
      setAllProgress((progData as Progress[]) ?? []);
      setStreak(streakRes.streak ?? 0);
      setLoading(false);
    })();
  }, []);

  // Filter progress rows by date window
  const filterCutoff = useMemo<string | null>(() => {
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if (dateFilter === 'week')  return addDays(todayIST, -7);
    if (dateFilter === 'month') return addDays(todayIST, -30);
    return null;
  }, [dateFilter]);

  const filteredProgress = useMemo(() =>
    filterCutoff
      ? allProgress.filter(p => toIST(p.updated_at) >= filterCutoff!)
      : allProgress,
    [allProgress, filterCutoff]
  );

  const stats = useMemo<Stats | null>(() => {
    if (loading) return null;

    // Build a set of solved problem IDs in the current window
    const solvedIds = new Set(filteredProgress.map(p => p.problem_id));

    // byStatus — always against all problems (not filtered)
    const byStatus: Record<Status, number> = { TO_DO: 0, ATTEMPTING: 0, SOLVED: 0 };
    for (const p of allProblems) byStatus[p.status as Status] = (byStatus[p.status as Status] ?? 0) + 1;

    // byDiff (filtered)
    const byDiff: Record<Difficulty, { solved: number; total: number }> = {
      EASY: { solved: 0, total: 0 }, MEDIUM: { solved: 0, total: 0 }, HARD: { solved: 0, total: 0 },
    };
    for (const p of allProblems) {
      if (byDiff[p.difficulty as Difficulty]) {
        byDiff[p.difficulty as Difficulty].total++;
        if (solvedIds.has(p.id)) byDiff[p.difficulty as Difficulty].solved++;
      }
    }

    // byTopic — solve rate + avg solve time
    const byTopic = OLT_TOPICS.map(t => {
      const matching   = allProblems.filter(p => p.topic_tags?.includes(t.slug));
      const attempted  = matching.filter(p => p.status !== 'TO_DO').length;
      const solved     = matching.filter(p => solvedIds.has(p.id)).length;

      // avg solve time from progress rows that have solve_duration_secs
      const times = filteredProgress
        .filter(pr => pr.solve_duration_secs !== null && matching.some(p => p.id === pr.problem_id))
        .map(pr => pr.solve_duration_secs!);
      const avgSecs = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;

      return { name: t.name, slug: t.slug, score: t.score, total: matching.length, attempted, solved, avgSecs };
    }).filter(t => t.total > 0).sort((a, b) => b.score - a.score || b.total - a.total);

    // Heatmap — last 91 days
    const heatmap: Record<string, number> = {};
    for (const pr of allProgress) {
      const date = toIST(pr.updated_at);
      heatmap[date] = (heatmap[date] ?? 0) + 1;
    }

    // Weekly avg solve time — last 8 weeks using filteredProgress
    const weeklyMap = new Map<string, { total: number; count: number }>();
    for (const pr of filteredProgress) {
      if (pr.solve_duration_secs === null) continue;
      const d = new Date(pr.updated_at + 'T00:00:00Z');
      // Find Monday of that week
      const day = d.getUTCDay();
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
      const key = monday.toISOString().slice(0, 10);
      const existing = weeklyMap.get(key) ?? { total: 0, count: 0 };
      weeklyMap.set(key, { total: existing.total + pr.solve_duration_secs, count: existing.count + 1 });
    }
    const weeklyAvgSecs = [...weeklyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([week, { total, count }]) => ({ week, avgSecs: Math.round(total / count), count }));

    return { total: allProblems.length, byStatus, byDiff, byTopic, streak, heatmap, weeklyAvgSecs };
  }, [allProblems, filteredProgress, allProgress, loading, streak]);

  if (loading) return (
    <div className="page-container" style={{ display: 'flex', justifyContent: 'center', paddingTop: '80px' }}>
      <div className="spinner" />
    </div>
  );
  if (!stats) return null;

  const { total, byStatus, byDiff, byTopic, heatmap, weeklyAvgSecs } = stats;
  const solved = byStatus.SOLVED;
  const solveRate = total > 0 ? Math.round((solved / total) * 100) : 0;

  const filterBtnStyle = (active: boolean) => ({
    background: active ? 'var(--accent-blue)22' : 'var(--bg-elevated)',
    border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border)'}`,
    borderRadius: '8px', padding: '6px 14px',
    color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
    fontSize: '13px', fontWeight: active ? 700 : 500,
    cursor: 'pointer', transition: 'all 0.15s',
  });

  const sectionStyle = {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: '12px', padding: '24px', marginBottom: '20px',
  };

  return (
    <div className="page-container" style={{ maxWidth: '900px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 800 }}>Analytics</h1>
        {/* Date filter */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {(['all', 'month', 'week'] as DateFilter[]).map(f => (
            <button key={f} onClick={() => setDateFilter(f)} style={filterBtnStyle(dateFilter === f)}>
              {f === 'all' ? 'All Time' : f === 'month' ? 'This Month' : 'This Week'}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }} className="fade-in">
        <StatCard label="Total Problems"   value={total}     />
        <StatCard label="Solved"           value={solved}    color="var(--accent-green)"   sub={`${solveRate}% rate`} />
        <StatCard label="Attempting"       value={byStatus.ATTEMPTING} color="var(--accent-amber)" />
        <StatCard label="To-Do"            value={byStatus.TO_DO}  />
        {streak > 0 && (
          <StatCard label="Solve Streak" value={`🔥 ${streak}`} color="var(--accent-amber)" sub={streak > 1 ? 'day streak' : 'day'} />
        )}
      </div>

      {/* Activity heatmap */}
      <section style={sectionStyle} className="fade-in">
        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
          Activity — Last 91 Days
        </h2>
        <Heatmap heatmap={heatmap} />
      </section>

      {/* Topic weakness map */}
      <section style={sectionStyle} className="fade-in">
        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px', color: 'var(--text-primary)' }}>
          Topic Weakness Map
        </h2>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Sorted by solve rate — weakest topics first
        </p>
        <WeaknessMap byTopic={byTopic} />
      </section>

      {/* Solve speed trends */}
      <section style={sectionStyle} className="fade-in">
        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px', color: 'var(--text-primary)' }}>
          Solve Speed (Weekly Avg)
        </h2>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Average solve time per week — lower is better
        </p>
        <SpeedChart weekly={weeklyAvgSecs} />
      </section>

      {/* Difficulty breakdown */}
      <section style={sectionStyle} className="fade-in">
        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px', color: 'var(--text-primary)' }}>
          Difficulty Breakdown
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <ProgressBar label="Hard"   solved={byDiff.HARD.solved}   total={byDiff.HARD.total}   color="var(--diff-hard)"   />
          <ProgressBar label="Medium" solved={byDiff.MEDIUM.solved} total={byDiff.MEDIUM.total} color="var(--diff-medium)" />
          <ProgressBar label="Easy"   solved={byDiff.EASY.solved}   total={byDiff.EASY.total}   color="var(--diff-easy)"   />
        </div>
      </section>

      {/* By OLT Topic */}
      <section style={sectionStyle} className="fade-in">
        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px', color: 'var(--text-primary)' }}>
          By OLT Topic
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {byTopic.map(t => (
            <ProgressBar key={t.slug} label={t.name} solved={t.solved} total={t.total}
              color={`hsl(${130 + t.score * 5}, 65%, 50%)`} />
          ))}
        </div>
      </section>

      {/* Status overview */}
      <section style={sectionStyle} className="fade-in">
        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px', color: 'var(--text-primary)' }}>
          Status Overview
        </h2>
        <StatusPie byStatus={byStatus} />
      </section>
    </div>
  );
}
