'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProblemWithStatus, Status } from '@/types';
import DifficultyBadge from './DifficultyBadge';
import TopicTags from './TopicTags';
import Toast from './Toast';

interface Props {
  problem: ProblemWithStatus;
  onStatusChange?: (id: number, status: Status) => void;
  onSkip?: (id: number) => void;    // called after skip API succeeds
}

const DESCRIPTION_THRESHOLD = 1200; // chars — beyond this, show "more" toggle
const MAX_TIMER_SECS = 4 * 60 * 60; // 4 hours; beyond this we don't record duration

/**
 * Strips "Difficulty: Easy/Medium/Hard" lines from the scraped leetcode.ca HTML.
 * The description is stored with those lines included; they must be hidden in
 * blind mode (TO_DO / ATTEMPTING) to avoid spoiling the difficulty.
 */
function sanitizeDescription(html: string): string {
  return html
    .replace(/<[^>]+>\s*<strong>\s*Difficulty\s*:\s*<\/strong>[^<]*<\/[^>]+>/gi, '')
    .replace(/<[^>]+>\s*Difficulty\s*:\s*(Easy|Medium|Hard)\s*<\/[^>]+>/gi, '')
    .replace(/Difficulty\s*:\s*(Easy|Medium|Hard)/gi, '');
}

function formatSecs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ProblemCard({ problem, onStatusChange, onSkip }: Props) {
  const [status, setStatus]                 = useState<Status>(problem.status ?? 'TO_DO');
  const [loading, setLoading]               = useState<Status | 'SKIP' | null>(null);
  const [revealed, setRevealed]             = useState(problem.status !== 'TO_DO');
  const [descExpanded, setDescExpanded]     = useState(false);
  const [solvedExpanded, setSolvedExpanded] = useState(false);

  // ── Timer ──────────────────────────────────────────────────────────────────
  // Attempt start time (epoch ms). Recovered from DB field on mount for ATTEMPTING cards.
  const [timerStart, setTimerStart]       = useState<number | null>(() => {
    if (problem.status === 'ATTEMPTING' && problem.attempt_started_at) {
      const t = new Date(problem.attempt_started_at).getTime();
      const elapsed = (Date.now() - t) / 1000;
      return elapsed < MAX_TIMER_SECS ? t : null; // discard if > 4h
    }
    return null;
  });
  const [elapsed, setElapsed]             = useState<number>(() => {
    if (timerStart) return Math.floor((Date.now() - timerStart) / 1000);
    return 0;
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (status === 'ATTEMPTING' && timerStart && elapsed < MAX_TIMER_SECS) {
      intervalRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - timerStart) / 1000);
        if (s >= MAX_TIMER_SECS) {
          clearInterval(intervalRef.current!);
        } else {
          setElapsed(s);
        }
      }, 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [status, timerStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toast (undo solved) ────────────────────────────────────────────────────
  const [toastVisible, setToastVisible]   = useState(false);
  const [toastMsg, setToastMsg]           = useState('');
  const [undoPending, setUndoPending]     = useState(false); // true while undo is available

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
  };

  // ── Core status update ─────────────────────────────────────────────────────
  const updateStatus = async (
    newStatus: Status,
    opts?: { attemptStartedAt?: number; solveDurationSecs?: number | null }
  ) => {
    setLoading(newStatus);
    try {
      await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem_id: problem.id,
          status: newStatus,
          attempt_started_at: opts?.attemptStartedAt
            ? new Date(opts.attemptStartedAt).toISOString()
            : undefined,
          solve_duration_secs: opts?.solveDurationSecs ?? undefined,
        }),
      });
      setStatus(newStatus);
      onStatusChange?.(problem.id, newStatus);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  };

  // ── Reveal handler (TO_DO → ATTEMPTING) ───────────────────────────────────
  const handleReveal = async () => {
    setRevealed(true);
    const now = Date.now();
    setTimerStart(now);
    setElapsed(0);
    await updateStatus('ATTEMPTING', { attemptStartedAt: now });
  };

  // ── Mark Solved with undo window ───────────────────────────────────────────
  const handleMarkSolved = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const duration =
      timerStart && elapsed > 0 && elapsed < MAX_TIMER_SECS ? elapsed : null;
    setUndoPending(true);
    await updateStatus('SOLVED', { solveDurationSecs: duration });
    showToast('✅ Marked as solved!');
  };

  const handleUndo = async () => {
    setUndoPending(false);
    // Revert to ATTEMPTING, restore timer from attempt_started_at
    await updateStatus('ATTEMPTING');
    if (timerStart) {
      const recovered = Math.floor((Date.now() - timerStart) / 1000);
      setElapsed(Math.min(recovered, MAX_TIMER_SECS - 1));
    }
  };

  // ── Skip handler ───────────────────────────────────────────────────────────
  const handleSkip = async () => {
    setLoading('SKIP');
    try {
      const res = await fetch('/api/queue/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem_id: problem.id }),
      });
      if (res.ok) onSkip?.(problem.id);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  };

  const lcUrl = `https://leetcode.com/problems/${problem.title_slug}/`;
  const isLong = (problem.description?.length ?? 0) > DESCRIPTION_THRESHOLD;
  const descHtml = problem.description ?? '';
  const safeDesc = sanitizeDescription(descHtml);

  // Solve time to show on SOLVED card (from DB or just-captured)
  const solveTimeSecs = problem.solve_duration_secs ?? null;

  // ── SOLVED state ───────────────────────────────────────────────────────────
  if (status === 'SOLVED') {
    return (
      <>
        <Toast
          message={toastMsg}
          visible={toastVisible}
          duration={5000}
          onDismiss={() => { setToastVisible(false); setUndoPending(false); }}
          action={undoPending ? { label: 'Undo', onClick: handleUndo } : undefined}
        />
        <div className="problem-card" style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--accent-green)33',
          borderRadius: '14px',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          transition: 'border-color 0.2s',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 600 }}>#{problem.id}</span>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {problem.title}
              </h3>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
              {solveTimeSecs !== null && (
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  ⏱ {formatSecs(solveTimeSecs)}
                </span>
              )}
              <DifficultyBadge difficulty={problem.difficulty} size="sm" />
              <span style={{
                background: 'var(--accent-green)22', color: 'var(--accent-green)',
                border: '1px solid var(--accent-green)55', borderRadius: '6px',
                padding: '4px 10px', fontSize: '12px', fontWeight: 600,
              }}>✅ Solved</span>
            </div>
          </div>

          {problem.topic_tags?.length > 0 && <TopicTags slugs={problem.topic_tags} />}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
            <button
              onClick={() => setSolvedExpanded(e => !e)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '6px', padding: '0',
              }}
            >
              <span style={{
                display: 'inline-block',
                transform: solvedExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
                fontSize: '10px',
              }}>▶</span>
              {solvedExpanded ? 'Hide problem' : 'View problem'}
            </button>

            {solvedExpanded && problem.description && (
              <div
                className="problem-description fade-in"
                dangerouslySetInnerHTML={{ __html: problem.description }}
                style={{ marginTop: '14px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.7 }}
              />
            )}
            {solvedExpanded && !problem.description && (
              <p style={{ marginTop: '12px', color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
                No cached description. <a href={lcUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue)' }}>View on LeetCode ↗</a>
              </p>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── ATTEMPTING state ───────────────────────────────────────────────────────
  if (status === 'ATTEMPTING') {
    return (
      <>
        <Toast
          message={toastMsg}
          visible={toastVisible}
          duration={5000}
          onDismiss={() => { setToastVisible(false); setUndoPending(false); }}
          action={undoPending ? { label: 'Undo', onClick: handleUndo } : undefined}
        />
        <div className="problem-card" style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--accent-amber)33',
          borderRadius: '14px',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          transition: 'border-color 0.2s',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 600 }}>#{problem.id}</span>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {problem.title}
              </h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              {timerStart && elapsed < MAX_TIMER_SECS && (
                <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
                  ⏱ {formatSecs(elapsed)}
                </span>
              )}
              <span style={{
                background: 'var(--accent-amber)22', color: 'var(--accent-amber)',
                border: '1px solid var(--accent-amber)55', borderRadius: '6px',
                padding: '4px 10px', fontSize: '12px', fontWeight: 600,
              }}>🔄 Attempting</span>
            </div>
          </div>

          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
            Go submit on LeetCode. Mark as solved when accepted! 💪
          </p>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
            <a
              href={lcUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent-blue)', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}
            >
              Open on LeetCode ↗
            </a>
            <button
              onClick={handleMarkSolved}
              disabled={loading !== null}
              style={{
                background: 'var(--accent-green)',
                border: 'none',
                borderRadius: '8px',
                padding: '9px 20px',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {loading === 'SOLVED' ? '…' : '✅ Mark Solved'}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── TO_DO state ────────────────────────────────────────────────────────────
  return (
    <>
      <Toast
        message={toastMsg}
        visible={toastVisible}
        onDismiss={() => setToastVisible(false)}
      />
      <div className="problem-card" style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '14px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        transition: 'border-color 0.2s',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 600 }}>#{problem.id}</span>
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
              {problem.title}
            </h3>
          </div>
          <span
            title="Difficulty and topics are hidden until you solve this problem"
            style={{
              fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', borderRadius: '6px', padding: '3px 8px',
              flexShrink: 0, whiteSpace: 'nowrap', cursor: 'help',
            }}
          >
            🔒 topic hidden
          </span>
        </div>

        {/* Description — hidden until Reveal is clicked */}
        {!revealed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic', flex: 1 }}>
              Read the problem and try to think of an approach before revealing.
            </p>
            <button
              onClick={handleReveal}
              disabled={loading !== null}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '7px 16px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {loading === 'ATTEMPTING' ? '…' : '👁 Reveal Problem'}
            </button>
          </div>
        ) : (
          /* Description visible after reveal */
          descHtml ? (
            <div>
              <div
                className="problem-description"
                dangerouslySetInnerHTML={{ __html: safeDesc }}
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: '14px',
                  lineHeight: 1.7,
                  maxHeight: (!isLong || descExpanded) ? 'none' : '260px',
                  overflow: 'hidden',
                  maskImage: (!isLong || descExpanded) ? 'none' : 'linear-gradient(to bottom, black 60%, transparent 100%)',
                  WebkitMaskImage: (!isLong || descExpanded) ? 'none' : 'linear-gradient(to bottom, black 60%, transparent 100%)',
                }}
              />
              {isLong && (
                <button
                  onClick={() => setDescExpanded(e => !e)}
                  style={{
                    marginTop: '8px', background: 'none', border: 'none',
                    cursor: 'pointer', color: 'var(--accent-blue)',
                    fontSize: '13px', fontWeight: 600, padding: '0',
                  }}
                >
                  {descExpanded ? '▲ Show less' : '▼ Show more'}
                </button>
              )}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', fontStyle: 'italic', margin: 0 }}>
              No cached description — click &ldquo;Open on LeetCode&rdquo; to read.
            </p>
          )
        )}

        {/* Footer */}
        <div style={{
          borderTop: '1px solid var(--border)',
          paddingTop: '14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <a
              href={lcUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'var(--accent-blue)', fontSize: '13px',
                fontWeight: 600, textDecoration: 'none',
              }}
            >
              Open on LeetCode ↗
            </a>
            <button
              onClick={handleSkip}
              disabled={loading !== null}
              title="Replace this problem with a different one"
              style={{
                background: 'none', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                color: 'var(--text-muted)', fontSize: '12px', padding: '0',
                opacity: loading === 'SKIP' ? 0.5 : 1, transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              {loading === 'SKIP' ? '…' : 'Skip →'}
            </button>
          </div>

          {!revealed && (
            <button
              onClick={handleReveal}
              disabled={loading !== null}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--accent-amber)55',
                borderRadius: '8px',
                padding: '7px 16px',
                color: 'var(--accent-amber)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
                transition: 'all 0.15s',
              }}
            >
              {loading === 'ATTEMPTING' ? '…' : '🔄 Mark Attempting'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
