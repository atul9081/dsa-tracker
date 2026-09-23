'use client';

import { useEffect, useState } from 'react';
import DifficultyBadge from '@/components/DifficultyBadge';
import StatusBadge from '@/components/StatusBadge';
import type { Difficulty, Status } from '@/types';

interface HistoryProblem {
  id: number;
  title: string;
  difficulty: Difficulty;
  status: Status;
  sub_type?: string | null;
  source?: string | null;
}

interface HistoryEntry {
  date: string;
  version: number;
  generated_at: string;
  problems: HistoryProblem[];
  solved_count: number;
  total_count: number;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function SolveBar({ solved, total }: { solved: number; total: number }) {
  const pct = total ? Math.round((solved / total) * 100) : 0;
  const color = pct === 100 ? 'var(--accent-green)' : pct >= 60 ? 'var(--accent-amber)' : 'var(--accent-blue)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '80px', height: '5px', background: 'var(--bg-elevated)', borderRadius: '99px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '99px', transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {solved}/{total} solved
      </span>
    </div>
  );
}

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/queue/history?days=30')
      .then(r => r.json())
      .then(d => setHistory(d.history ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <main style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px' }}>
        {/* Page header */}
        <div style={{ marginBottom: '28px' }}>
          <h1 style={{ margin: '0 0 6px', fontSize: '26px', fontWeight: 800, color: 'var(--text-primary)' }}>
            Queue History
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '14px' }}>
            Your past daily problem sets — last 30 days
          </p>
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontSize: '14px' }}>
            Loading history…
          </div>
        ) : history.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 24px',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: '14px', color: 'var(--text-muted)',
          }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📭</div>
            <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-secondary)' }}>No history yet</p>
            <p style={{ margin: '6px 0 0', fontSize: '13px' }}>
              Your daily queues will appear here after the database migration runs.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {history.map(entry => {
              const isOpen = expandedDate === entry.date;
              return (
                <div
                  key={entry.date}
                  style={{
                    background: 'var(--bg-card)',
                    border: `1px solid ${isOpen ? 'var(--accent-blue)44' : 'var(--border)'}`,
                    borderRadius: '12px',
                    overflow: 'hidden',
                    transition: 'border-color 0.2s',
                  }}
                >
                  {/* Row header — clickable */}
                  <button
                    onClick={() => setExpandedDate(isOpen ? null : entry.date)}
                    style={{
                      width: '100%', background: 'none', border: 'none',
                      cursor: 'pointer', padding: '16px 20px',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: '12px', flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'left' }}>
                        <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {formatDate(entry.date)}
                        </span>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                          {entry.date}
                        </span>
                      </div>
                      <SolveBar solved={entry.solved_count} total={entry.total_count} />
                      {entry.version > 1 && (
                        <span style={{
                          fontSize: '11px', color: 'var(--text-muted)',
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          borderRadius: '4px', padding: '2px 6px',
                        }}>
                          regenerated ×{entry.version - 1}
                        </span>
                      )}
                    </div>
                    <span style={{
                      fontSize: '11px', color: 'var(--text-muted)',
                      transform: isOpen ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.2s', display: 'inline-block',
                    }}>▶</span>
                  </button>

                  {/* Expanded problem list */}
                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '4px 0 8px' }}>
                      {entry.problems.map((p, i) => (
                        <div
                          key={p.id}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 20px', gap: '12px', flexWrap: 'wrap',
                            borderTop: i === 0 ? 'none' : '1px solid var(--border)11',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}>
                              #{p.id}
                            </span>
                            <span style={{
                              fontSize: '14px', color: 'var(--text-primary)', fontWeight: 500,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {p.title}
                            </span>
                            {p.source === 'cses' && (
                              <span style={{
                                fontSize: '10px', color: 'var(--text-muted)',
                                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                                borderRadius: '4px', padding: '1px 5px', flexShrink: 0,
                              }}>CSES</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                            {p.status === 'SOLVED'
                              ? <DifficultyBadge difficulty={p.difficulty} size="sm" />
                              : <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>🔒</span>
                            }
                            <StatusBadge status={p.status} size="sm" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
