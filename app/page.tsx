'use client';

import { useEffect, useState } from 'react';
import type { ProblemWithStatus, Status } from '@/types';
import ProblemCard from '@/components/ProblemCard';

export default function DailyQueuePage() {
  const [problems, setProblems]   = useState<ProblemWithStatus[]>([]);
  const [date, setDate]           = useState('');
  const [loading, setLoading]     = useState(true);
  const [regen, setRegen]         = useState(false);
  const [confirm, setConfirm]     = useState(false);

  const loadQueue = async () => {
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
  };

  const regenerate = async () => {
    setRegen(true);
    setConfirm(false);
    try {
      const res = await fetch('/api/queue', { method: 'POST' });
      const data = await res.json();
      setProblems(data.problems ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setRegen(false);
    }
  };

  useEffect(() => { loadQueue(); }, []);

  const handleStatusChange = (id: number, status: Status) => {
    setProblems(prev =>
      prev.map(p => p.id === id ? { ...p, status } : p)
    );
  };

  const solved = problems.filter(p => p.status === 'SOLVED').length;

  // Format date nicely
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
          <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '6px 14px',
              fontSize: '14px',
              fontWeight: 600,
              color: solved === problems.length ? 'var(--accent-green)' : 'var(--text-primary)',
            }}>
              {solved} / {problems.length} done
            </div>
          </div>
        )}
      </div>

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
            <ProblemCard key={p.id} problem={p} onStatusChange={handleStatusChange} />
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
              🔄 Regenerate Queue
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                Replace today&apos;s queue?
              </span>
              <button
                onClick={regenerate}
                disabled={regen}
                style={{
                  background: 'var(--diff-hard)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
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
          )}
        </div>
      )}
    </div>
  );
}
