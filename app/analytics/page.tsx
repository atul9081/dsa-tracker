'use client';

import { useEffect, useState } from 'react';
import type { ProblemWithStatus, Status, Difficulty } from '@/types';
import { OLT_TOPICS } from '@/config/topics';

interface Stats {
  total: number;
  byStatus: Record<Status, number>;
  byDiff: Record<Difficulty, { solved: number; total: number }>;
  byTopic: Array<{ name: string; slug: string; score: number; solved: number; total: number }>;
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      padding: '20px 24px',
      flex: '1 1 120px',
    }}>
      <div style={{ fontSize: '28px', fontWeight: 800, color: color ?? 'var(--text-primary)' }}>
        {value}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500, marginTop: '4px' }}>
        {label}
      </div>
    </div>
  );
}

function ProgressBar({ label, solved, total, color }: { label: string; solved: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((solved / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{ width: '80px', fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600, flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ flex: 1, background: 'var(--bg-elevated)', borderRadius: '4px', height: '10px', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: color,
          borderRadius: '4px',
          transition: 'width 0.6s ease',
        }} />
      </div>
      <div style={{ width: '90px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>
        {solved} / {total}
      </div>
    </div>
  );
}

function StatusPie({ byStatus }: { byStatus: Record<Status, number> }) {
  const STATUS_COLORS: Record<Status, string> = {
    SOLVED:    'var(--accent-green)',
    ATTEMPTED: 'var(--accent-blue)',
    DEBUGGING: 'var(--accent-amber)',
    TO_DO:     'var(--accent-gray)',
  };
  const entries = (Object.entries(byStatus) as [Status, number][]).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  return (
    <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
      {/* Donut SVG */}
      <svg width="120" height="120" viewBox="0 0 42 42">
        {(() => {
          let offset = 0;
          return entries.map(([status, val]) => {
            const pct = (val / total) * 100;
            const el = (
              <circle
                key={status}
                cx="21" cy="21" r="15.9155"
                fill="transparent"
                stroke={STATUS_COLORS[status]}
                strokeWidth="5"
                strokeDasharray={`${pct} ${100 - pct}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                style={{ transform: 'rotate(-90deg)', transformOrigin: 'center', transition: 'stroke-dasharray 0.6s ease' }}
              />
            );
            offset += pct;
            return el;
          });
        })()}
        <text x="21" y="25" textAnchor="middle" fontSize="8" fill="var(--text-primary)" fontWeight="700">
          {total}
        </text>
      </svg>
      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {entries.map(([status, val]) => (
          <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: STATUS_COLORS[status], flexShrink: 0 }} />
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              {status.charAt(0) + status.slice(1).toLowerCase().replace('_', ' ')} — <strong style={{ color: 'var(--text-primary)' }}>{val}</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [stats, setStats]   = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { createBrowserClient } = await import('@supabase/ssr');
      const sb = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { data } = await sb.from('problems_with_status').select('*');
      const problems = (data as ProblemWithStatus[]) ?? [];

      const byStatus: Record<Status, number> = { TO_DO: 0, ATTEMPTED: 0, DEBUGGING: 0, SOLVED: 0 };
      const byDiff: Record<Difficulty, { solved: number; total: number }> = {
        EASY:   { solved: 0, total: 0 },
        MEDIUM: { solved: 0, total: 0 },
        HARD:   { solved: 0, total: 0 },
      };

      for (const p of problems) {
        byStatus[p.status as Status] = (byStatus[p.status as Status] ?? 0) + 1;
        if (byDiff[p.difficulty as Difficulty]) {
          byDiff[p.difficulty as Difficulty].total++;
          if (p.status === 'SOLVED') byDiff[p.difficulty as Difficulty].solved++;
        }
      }

      const byTopic = OLT_TOPICS.map(t => {
        const matching = problems.filter(p => p.topic_tags?.includes(t.slug));
        return {
          name:   t.name,
          slug:   t.slug,
          score:  t.score,
          total:  matching.length,
          solved: matching.filter(p => p.status === 'SOLVED').length,
        };
      }).filter(t => t.total > 0).sort((a, b) => b.score - a.score || b.total - a.total);

      setStats({ total: problems.length, byStatus, byDiff, byTopic });
      setLoading(false);
    })();
  }, []);

  if (loading) return (
    <div className="page-container" style={{ display: 'flex', justifyContent: 'center', paddingTop: '80px' }}>
      <div className="spinner" />
    </div>
  );

  if (!stats) return null;

  const { total, byStatus, byDiff, byTopic } = stats;

  return (
    <div className="page-container" style={{ maxWidth: '860px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '28px' }}>Analytics</h1>

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '32px' }} className="fade-in">
        <StatCard label="Total"     value={total}                 />
        <StatCard label="Solved"    value={byStatus.SOLVED}    color="var(--accent-green)" />
        <StatCard label="Attempted" value={byStatus.ATTEMPTED} color="var(--accent-blue)"  />
        <StatCard label="Debugging" value={byStatus.DEBUGGING} color="var(--accent-amber)" />
        <StatCard label="To-Do"     value={byStatus.TO_DO}     color="var(--accent-gray)"  />
      </div>

      {/* Difficulty breakdown */}
      <section style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '24px', marginBottom: '20px',
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px', color: 'var(--text-primary)' }}>
          Difficulty Breakdown
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <ProgressBar label="Hard"   solved={byDiff.HARD.solved}   total={byDiff.HARD.total}   color="var(--diff-hard)"   />
          <ProgressBar label="Medium" solved={byDiff.MEDIUM.solved} total={byDiff.MEDIUM.total} color="var(--diff-medium)" />
          <ProgressBar label="Easy"   solved={byDiff.EASY.solved}   total={byDiff.EASY.total}   color="var(--diff-easy)"   />
        </div>
      </section>

      {/* Topic breakdown */}
      <section style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '24px', marginBottom: '20px',
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px', color: 'var(--text-primary)' }}>
          By OLT Topic
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {byTopic.map(t => (
            <ProgressBar
              key={t.slug}
              label={t.name}
              solved={t.solved}
              total={t.total}
              color={`hsl(${130 + t.score * 5}, 65%, 50%)`}
            />
          ))}
        </div>
      </section>

      {/* Status pie */}
      <section style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '24px',
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '20px', color: 'var(--text-primary)' }}>
          Status Overview
        </h2>
        <StatusPie byStatus={byStatus} />
      </section>
    </div>
  );
}
