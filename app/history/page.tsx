'use client';

import { useEffect, useState } from 'react';
import DifficultyBadge from '@/components/DifficultyBadge';
import StatusBadge from '@/components/StatusBadge';
import type { Difficulty, Status } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HistoryProblem {
  id: number;
  title: string;
  difficulty: Difficulty;
  status: Status;
  sub_type?: string | null;
  source?: string | null;
}

interface HistoryVersion {
  version: number;
  is_latest: boolean;
  generated_at: string;
  problems: HistoryProblem[];
  solved_count: number;
  total_count: number;
}

interface HistoryEntry {
  date: string;
  latest_solved_count: number;
  latest_total_count: number;
  versions: HistoryVersion[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate();

  if (sameDay(d, today))     return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ── Sub-components ────────────────────────────────────────────────────────────

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

function ProblemRow({ p, index }: { p: HistoryProblem; index: number }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px', gap: '12px', flexWrap: 'wrap',
        borderTop: index === 0 ? 'none' : '1px solid var(--border)11',
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
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const [history, setHistory]   = useState<HistoryEntry[]>([]);
  const [loading, setLoading]   = useState(true);

  // Two-level expand state:
  // expandedDate: which date card is open
  // expandedOlderVersions: which date's "older versions" sub-section is open (key = date)
  const [expandedDate, setExpandedDate]               = useState<string | null>(null);
  const [expandedOlderVersions, setExpandedOlderVersions] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/queue/history?days=30')
      .then(r => r.json())
      .then(d => setHistory(d.history ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function toggleOlderVersions(date: string) {
    setExpandedOlderVersions(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }

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
              No queues recorded yet. Visit the <a href="/" style={{ color: 'var(--accent-blue)' }}>home page</a> to generate today&apos;s first queue.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {history.map(entry => {
              const isOpen        = expandedDate === entry.date;
              const olderOpen     = expandedOlderVersions.has(entry.date);
              const latestVersion = entry.versions[0];
              const olderVersions = entry.versions.slice(1);
              const hasMultiple   = olderVersions.length > 0;

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
                  {/* ── Outer row header ── */}
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
                      {/* Summary from latest version */}
                      <SolveBar solved={entry.latest_solved_count} total={entry.latest_total_count} />
                      {/* Multi-version badge */}
                      {hasMultiple && (
                        <span style={{
                          fontSize: '11px', color: 'var(--text-muted)',
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          borderRadius: '4px', padding: '2px 6px',
                        }}>
                          ↺ {olderVersions.length + 1} versions
                        </span>
                      )}
                    </div>
                    <span style={{
                      fontSize: '11px', color: 'var(--text-muted)',
                      transform: isOpen ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.2s', display: 'inline-block',
                    }}>▶</span>
                  </button>

                  {/* ── Expanded: latest version's problem list ── */}
                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '4px 0 8px' }}>
                      {latestVersion.problems.map((p, i) => (
                        <ProblemRow key={p.id} p={p as HistoryProblem} index={i} />
                      ))}

                      {/* ── Older versions sub-section ── */}
                      {hasMultiple && (
                        <div style={{ borderTop: '1px solid var(--border)55', margin: '8px 20px 0' }}>
                          <button
                            onClick={() => toggleOlderVersions(entry.date)}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              padding: '10px 0',
                              display: 'flex', alignItems: 'center', gap: '6px',
                              color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600,
                            }}
                          >
                            <span style={{
                              display: 'inline-block',
                              transform: olderOpen ? 'rotate(90deg)' : 'none',
                              transition: 'transform 0.2s',
                              fontSize: '9px',
                            }}>▶</span>
                            {olderOpen ? 'Hide' : 'Show'} {olderVersions.length} older version{olderVersions.length !== 1 ? 's' : ''}
                          </button>

                          {olderOpen && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '8px' }}>
                              {olderVersions.map(ver => (
                                <OlderVersionCard key={ver.version} ver={ver} date={entry.date} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
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

// ── Older version card (self-contained expand state) ──────────────────────────

function OlderVersionCard({ ver, date }: { ver: HistoryVersion; date: string }) {
  const [open, setOpen] = useState(false);
  void date; // used as key by parent — not needed in render

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: '10px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: '4px', padding: '2px 7px',
          }}>
            v{ver.version}
          </span>
          <SolveBar solved={ver.solved_count} total={ver.total_count} />
          {ver.generated_at && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              generated {formatTime(ver.generated_at)}
            </span>
          )}
        </div>
        <span style={{
          fontSize: '10px', color: 'var(--text-muted)',
          transform: open ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.2s', display: 'inline-block',
        }}>▶</span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)55', padding: '4px 0' }}>
          {ver.problems.map((p, i) => (
            <ProblemRow key={p.id} p={p as HistoryProblem} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
