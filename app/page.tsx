'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ProblemWithStatus, Status } from '@/types';
import ProblemCard from '@/components/ProblemCard';

type DiffMode = 'chill' | 'standard' | 'grind';

const DIFF_MODES: Array<{ key: DiffMode; label: string; desc: string }> = [
  { key: 'chill',    label: '😌 Chill',    desc: '3 Medium + 2 Easy'  },
  { key: 'standard', label: '⚡ Standard', desc: '2 Hard + 3 Medium'  },
  { key: 'grind',    label: '🔥 Grind',    desc: '3 Hard + 2 Medium'  },
];

export default function DailyQueuePage() {
  const [problems, setProblems]   = useState<ProblemWithStatus[]>([]);
  const [date, setDate]           = useState('');
  const [loading, setLoading]     = useState(true);
  const [regen, setRegen]         = useState(false);
  const [confirm, setConfirm]     = useState(false);
  const [diffMode, setDiffMode]   = useState<DiffMode>('standard');

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/queue');
      const data = await res.json();
      setProblems(data.problems ?? []);
      setDate(data.date ?? '');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const regenerate = async () => {
    setRegen(true);
    setConfirm(false);
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: diffMode }),
      });
      const data = await res.json();
      setProblems(data.problems ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setRegen(false);
    }
  };

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const handleStatusChange = (id: number, status: Status) => {
    setProblems(prev =>
      prev.map(p => p.id === id ? { ...p, status } : p)
    );
  };

  // Skip: replace the skipped problem with the API-returned replacement
  const handleSkip = async (skippedId: number) => {
    try {
      const res = await fetch('/api/queue/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem_id: skippedId }),
      });
      if (!res.ok) return;
      const { replacement } = await res.json();
      if (replacement) {
        setProblems(prev =>
          prev.map(p => p.id === skippedId ? { ...replacement, status: replacement.status ?? 'TO_DO' } : p)
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  const solved     = problems.filter(p => p.status === 'SOLVED').length;
  const attempting = problems.filter(p => p.status === 'ATTEMPTING').length;
  const allDone    = !loading && problems.length > 0 && solved === problems.length;

  const dateLabel = date
    ? new Date(date + 'T00:00:00').toLocaleDateString('en-IN', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : '';

  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '6px' }}>
          Today&apos;s Queue
        </h1>
        {dateLabel && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{dateLabel}</p>
        )}
        {!loading && problems.length > 0 && (
          <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: '8px', padding: '5px 12px', fontSize: '13px', fontWeight: 600,
              color: allDone ? 'var(--accent-green)' : 'var(--text-primary)',
            }}>✅ {solved} solved</span>
            {attempting > 0 && (
              <span style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--accent-amber)44',
                borderRadius: '8px', padding: '5px 12px', fontSize: '13px', fontWeight: 600,
                color: 'var(--accent-amber)',
              }}>🔄 {attempting} attempting</span>
            )}
            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
              of {problems.length} problems
            </span>
          </div>
        )}
      </div>

      {/* All Done celebration */}
      {allDone && (
        <div className="fade-in" style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--accent-green)44',
          borderRadius: '14px',
          padding: '24px 28px',
          marginBottom: '24px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎉</div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--accent-green)', marginBottom: '6px' }}>
            All done for today!
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            Great work. Come back tomorrow for a fresh set.
          </p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
          <div className="spinner" />
        </div>
      )}

      {/* Cards */}
      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} className="fade-in">
          {problems.map(p => (
            <ProblemCard
              key={p.id}
              problem={p}
              onStatusChange={handleStatusChange}
              onSkip={handleSkip}
            />
          ))}
          {problems.length === 0 && (
            <div style={{
              textAlign: 'center', padding: '80px 0',
              color: 'var(--text-muted)', fontSize: '15px',
            }}>
              No problems in queue. Database may still be seeding.
            </div>
          )}
        </div>
      )}

      {/* Regenerate */}
      {!loading && (
        <div style={{ marginTop: '32px', textAlign: 'center' }}>
          {!confirm ? (
            <div>
              <button
                onClick={() => setConfirm(true)}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  color: 'var(--text-secondary)',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                ↺ Get a fresh set
              </button>
              <p style={{ marginTop: '8px', color: 'var(--text-muted)', fontSize: '11px' }}>
                Replaces today&apos;s problems with a new random set — your progress is preserved.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
              {/* Difficulty mode picker */}
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: 0 }}>
                Pick a difficulty mode for the fresh set:
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                {DIFF_MODES.map(m => (
                  <button
                    key={m.key}
                    onClick={() => setDiffMode(m.key)}
                    title={m.desc}
                    style={{
                      background: diffMode === m.key ? 'var(--accent-blue)22' : 'var(--bg-elevated)',
                      border: `1px solid ${diffMode === m.key ? 'var(--accent-blue)' : 'var(--border)'}`,
                      borderRadius: '8px',
                      padding: '8px 16px',
                      color: diffMode === m.key ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      fontSize: '13px',
                      fontWeight: diffMode === m.key ? 700 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {m.label}
                    <span style={{ display: 'block', fontSize: '10px', fontWeight: 400, opacity: 0.7, marginTop: '2px' }}>
                      {m.desc}
                    </span>
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  onClick={regenerate}
                  disabled={regen}
                  style={{
                    background: 'var(--diff-hard)',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 20px',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {regen ? '…' : 'Yes, regenerate'}
                </button>
                <button
                  onClick={() => setConfirm(false)}
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
