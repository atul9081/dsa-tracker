'use client';

import { useMemo, useEffect, useRef, useState } from 'react';
import katex from 'katex';
import type { ProblemWithStatus, Status } from '@/types';
import DifficultyBadge from './DifficultyBadge';
import TopicTags from './TopicTags';
import Toast from './Toast';

interface Props {
  problem: ProblemWithStatus;
  onStatusChange?: (id: number, status: Status) => void;
  onSkip?: (id: number) => void;
}

const DESCRIPTION_THRESHOLD = 1200; // chars beyond which Show more is offered
const MAX_TIMER_SECS = 4 * 60 * 60;  // 4-hour cap

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * DOM-aware difficulty sanitizer.
 * Removes any leaf element whose sole text content is "Easy", "Medium", or "Hard"
 * (with or without a "Difficulty:" prefix). Works regardless of HTML structure.
 * Falls back to a regex pass for SSR where DOMParser is unavailable.
 */
function sanitizeDescription(html: string): string {
  const DIFFICULTY_RE = /^(Difficulty\s*:\s*)?(Easy|Medium|Hard)$/i;

  if (typeof window === 'undefined') {
    // SSR fallback — regex-based (description is blurred anyway on first load)
    return html
      .replace(/<[^>]+>\s*<strong>\s*Difficulty\s*:\s*<\/strong>[^<]*<\/[^>]+>/gi, '')
      .replace(/<[^>]+>\s*Difficulty\s*:\s*(Easy|Medium|Hard)\s*<\/[^>]+>/gi, '')
      .replace(/Difficulty\s*:\s*(Easy|Medium|Hard)/gi, '');
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('*').forEach(el => {
    if (el.children.length === 0 && DIFFICULTY_RE.test(el.textContent?.trim() ?? '')) {
      el.remove();
    }
  });
  return doc.body.innerHTML;
}

function formatSecs(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ProblemCard({ problem, onStatusChange, onSkip }: Props) {
  const [status, setStatus]             = useState<Status>(problem.status ?? 'TO_DO');
  const [loading, setLoading]           = useState<Status | 'SKIP' | null>(null);

  // Reveal state: `revealed` = has user ever clicked Reveal (one-way latch).
  // `descVisible` = is description currently expanded (toggleable after reveal).
  const [revealed, setRevealed]         = useState(problem.status !== 'TO_DO');
  const [descVisible, setDescVisible]   = useState(problem.status !== 'TO_DO');
  const [descExpanded, setDescExpanded] = useState(false);
  const [solvedExpanded, setSolvedExpanded] = useState(false);

  // ── Timer ─────────────────────────────────────────────────────────────────
  const [timerStart, setTimerStart] = useState<number | null>(() => {
    if (problem.status === 'ATTEMPTING' && problem.attempt_started_at) {
      const t = new Date(problem.attempt_started_at).getTime();
      return (Date.now() - t) / 1000 < MAX_TIMER_SECS ? t : null;
    }
    return null;
  });
  const [elapsed, setElapsed] = useState<number>(() =>
    timerStart ? Math.floor((Date.now() - timerStart) / 1000) : 0
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (status === 'ATTEMPTING' && timerStart && elapsed < MAX_TIMER_SECS) {
      intervalRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - timerStart) / 1000);
        if (s >= MAX_TIMER_SECS) clearInterval(intervalRef.current!);
        else setElapsed(s);
      }, 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [status, timerStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toast / Undo ──────────────────────────────────────────────────────────
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg]         = useState('');
  const [undoPending, setUndoPending]   = useState(false);

  // ── Core status update ────────────────────────────────────────────────────
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

  // ── Reveal handler (first time only — starts timer + sets ATTEMPTING) ─────
  const handleReveal = async () => {
    const now = Date.now();
    setTimerStart(now);
    setElapsed(0);
    setRevealed(true);
    setDescVisible(true);
    await updateStatus('ATTEMPTING', { attemptStartedAt: now });
  };

  // ── Toggle description visibility (after already revealed) ───────────────
  const handleToggleDesc = () => setDescVisible(v => !v);

  // ── ↗ Solve link click — also triggers reveal if first time ──────────────
  const handleSolveLinkClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (status === 'TO_DO' && !revealed) {
      e.preventDefault();
      await handleReveal();
      window.open(solveUrl, '_blank', 'noopener,noreferrer');
    }
    // If already ATTEMPTING/SOLVED or already revealed: let href open normally
  };

  // ── Mark Solved ───────────────────────────────────────────────────────────
  const handleMarkSolved = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const duration = timerStart && elapsed > 0 && elapsed < MAX_TIMER_SECS ? elapsed : null;
    setUndoPending(true);
    await updateStatus('SOLVED', { solveDurationSecs: duration });
    setToastMsg('✅ Marked as solved!');
    setToastVisible(true);
  };

  const handleUndo = async () => {
    setUndoPending(false);
    await updateStatus('ATTEMPTING');
    if (timerStart) setElapsed(Math.min(Math.floor((Date.now() - timerStart) / 1000), MAX_TIMER_SECS - 1));
  };

  // ── Skip ──────────────────────────────────────────────────────────────────
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

  // ── Computed values ───────────────────────────────────────────────────────
  // Use external_url (CSES) if set, else construct LC URL
  const solveUrl = problem.external_url
    ?? `https://leetcode.com/problems/${problem.title_slug}/`;

  const descHtml  = problem.description ?? '';
  const safeDesc  = useMemo(() => sanitizeDescription(descHtml), [descHtml]);
  const isLong    = descHtml.length > DESCRIPTION_THRESHOLD;
  const solveTimeSecs = problem.solve_duration_secs ?? null;

  // ── KaTeX math rendering ──────────────────────────────────────────────────
  // CSES descriptions contain raw LaTeX in <span class="math math-inline">
  // and <span class="math math-display"> spans. Render them client-side.
  const descRef       = useRef<HTMLDivElement>(null);
  const solvedDescRef = useRef<HTMLDivElement>(null);

  function renderMathIn(container: HTMLElement | null) {
    if (!container) return;
    container.querySelectorAll<HTMLElement>('.math').forEach(el => {
      if (el.dataset.katexRendered) return; // don't re-render
      const latex = el.textContent ?? '';
      const displayMode = el.classList.contains('math-display');
      try {
        el.innerHTML = katex.renderToString(latex, {
          displayMode,
          throwOnError: false,
          output: 'html',
        });
        el.dataset.katexRendered = '1';
      } catch {
        // leave raw LaTeX as-is
      }
    });
  }

  useEffect(() => {
    if (revealed && descVisible) renderMathIn(descRef.current);
  }, [revealed, descVisible]);

  useEffect(() => {
    if (solvedExpanded) renderMathIn(solvedDescRef.current);
  }, [solvedExpanded]);

  // ── Shared description block ──────────────────────────────────────────────
  // Renders either the compact blurred block or the full readable description.
  const descriptionBlock = descHtml ? (
    !revealed || !descVisible ? (
      /* ── Compact blurred view ── */
      <div style={{ position: 'relative', borderRadius: '10px', overflow: 'hidden' }}>
        {/* Blurred content underneath — limited height so it's compact */}
        <div
          aria-hidden
          dangerouslySetInnerHTML={{ __html: safeDesc }}
          style={{
            filter: 'blur(7px)',
            userSelect: 'none',
            pointerEvents: 'none',
            fontSize: '14px',
            lineHeight: 1.7,
            color: 'var(--text-secondary)',
            maxHeight: '72px',
            overflow: 'hidden',
          }}
        />
        {/* Click overlay with Reveal button */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-card)',
          opacity: 0.85,
        }} />
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <button
            onClick={!revealed ? handleReveal : handleToggleDesc}
            disabled={loading !== null}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '7px 18px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1,
              transition: 'all 0.15s',
              backdropFilter: 'blur(4px)',
            }}
          >
            {loading === 'ATTEMPTING' ? '…' : '👁 Reveal'}
          </button>
        </div>
      </div>
    ) : (
      /* ── Full readable description ── */
      <div ref={descRef}>
        <div
          className="problem-description"
          dangerouslySetInnerHTML={{ __html: safeDesc }}
          style={{
            color: 'var(--text-secondary)',
            fontSize: '14px',
            lineHeight: 1.7,
            maxHeight: !isLong || descExpanded ? 'none' : '260px',
            overflow: 'hidden',
            maskImage: !isLong || descExpanded
              ? 'none'
              : 'linear-gradient(to bottom, black 60%, transparent 100%)',
            WebkitMaskImage: !isLong || descExpanded
              ? 'none'
              : 'linear-gradient(to bottom, black 60%, transparent 100%)',
          }}
        />
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
          {isLong && (
            <button
              onClick={() => setDescExpanded(e => !e)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--accent-blue)', fontSize: '13px',
                fontWeight: 600, padding: 0,
              }}
            >
              {descExpanded ? '▲ Show less' : '▼ Show more'}
            </button>
          )}
          {/* Hide compresses back to blurred compact block */}
          <button
            onClick={handleToggleDesc}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: '12px', padding: 0,
            }}
          >
            🙈 Hide
          </button>
        </div>
      </div>
    )
  ) : (
    <p style={{ color: 'var(--text-muted)', fontSize: '14px', fontStyle: 'italic', margin: 0 }}>
      No cached description —{' '}
      <a
        href={solveUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleSolveLinkClick}
        style={{ color: 'var(--accent-blue)' }}
      >
        ↗ Solve
      </a>{' '}
      to read.
    </p>
  );

  // ── SOLVED state ──────────────────────────────────────────────────────────
  if (status === 'SOLVED') {
    // Derive platform label for display after solve (UX #12)
    const platformLabel = problem.source === 'cses' ? 'CSES' : 'LC';

    return (
      <>
        <Toast
          message={toastMsg}
          visible={toastVisible}
          duration={8000}
          onDismiss={() => { setToastVisible(false); setUndoPending(false); }}
          action={undoPending ? { label: 'Undo', onClick: handleUndo } : undefined}
        />
        <div className="problem-card" style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--accent-green)33',
          borderRadius: '14px',
          padding: '20px 24px',
          display: 'flex', flexDirection: 'column', gap: '12px',
          transition: 'border-color 0.2s',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 600 }}>#{problem.id}</span>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {problem.title}
              </h3>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
              {/* UX #12: show platform (LC / CSES) after solve */}
              <span style={{
                fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', borderRadius: '5px', padding: '2px 7px', fontWeight: 600,
              }}>{platformLabel}</span>
              <DifficultyBadge difficulty={problem.difficulty} size="sm" />
              {/* UX #7: solve time shown inside / beside the Solved badge for prominence */}
              <span style={{
                background: 'var(--accent-green)22', color: 'var(--accent-green)',
                border: '1px solid var(--accent-green)55', borderRadius: '6px',
                padding: '4px 10px', fontSize: '12px', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                ✅ Solved
                {solveTimeSecs !== null && (
                  <span style={{ opacity: 0.75, fontWeight: 500, fontSize: '11px' }}>· {formatSecs(solveTimeSecs)}</span>
                )}
              </span>
              {/* UX #2: persistent link to revisit the problem — always visible after solve */}
              <a
                href={solveUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-muted)', fontSize: '12px', textDecoration: 'none',
                  border: '1px solid var(--border)', borderRadius: '5px', padding: '3px 8px',
                  transition: 'color 0.15s, border-color 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--accent-blue)'; (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--accent-blue)55'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border)'; }}
              >
                ↗ Open
              </a>
            </div>
          </div>

          {/* Topics + platform tag revealed on SOLVED */}
          {problem.topic_tags?.length > 0 && <TopicTags slugs={problem.topic_tags} />}

          {/* Collapsible description */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
            <button
              onClick={() => setSolvedExpanded(e => !e)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '6px', padding: 0,
              }}
            >
              <span style={{
                display: 'inline-block',
                transform: solvedExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s', fontSize: '10px',
              }}>▶</span>
              {solvedExpanded ? 'Hide problem' : 'View problem'}
            </button>
            {solvedExpanded && problem.description && (
              <div
                ref={solvedDescRef}
                className="problem-description fade-in"
                dangerouslySetInnerHTML={{ __html: safeDesc }}
                style={{ marginTop: '14px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.7 }}
              />
            )}
            {solvedExpanded && !problem.description && (
              <p style={{ marginTop: '12px', color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
                No cached description.{' '}
                <a href={solveUrl} target="_blank" rel="noopener noreferrer"
                   style={{ color: 'var(--accent-blue)' }}>↗ Open</a>
              </p>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── ATTEMPTING state ──────────────────────────────────────────────────────
  // UX #5: allow the user to restart their timer (re-trigger handleReveal).
  const handleRestartTimer = async () => {
    const now = Date.now();
    setTimerStart(now);
    setElapsed(0);
    await updateStatus('ATTEMPTING', { attemptStartedAt: now });
  };

  if (status === 'ATTEMPTING') {
    return (
      <>
        <Toast
          message={toastMsg}
          visible={toastVisible}
          duration={8000}
          onDismiss={() => { setToastVisible(false); setUndoPending(false); }}
          action={undoPending ? { label: 'Undo', onClick: handleUndo } : undefined}
        />
        <div className="problem-card" style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--accent-amber)33',
          borderRadius: '14px',
          padding: '20px 24px',
          display: 'flex', flexDirection: 'column', gap: '16px',
          transition: 'border-color 0.2s',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 600 }}>#{problem.id}</span>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {problem.title}
              </h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
              {timerStart && elapsed < MAX_TIMER_SECS && (
                <span
                  title="Click to restart timer"
                  onClick={handleRestartTimer}
                  style={{ color: 'var(--text-muted)', fontSize: '12px', fontVariantNumeric: 'tabular-nums', cursor: 'pointer' }}
                >
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

          {/* Description — same blur/reveal toggle available in ATTEMPTING state */}
          {descriptionBlock}

          {/* Footer */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexWrap: 'wrap', gap: '10px',
            borderTop: '1px solid var(--border)', paddingTop: '14px',
          }}>
            <a
              href={solveUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent-blue)', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}
            >
              ↗ Solve
            </a>
            <button
              onClick={handleMarkSolved}
              disabled={loading !== null}
              style={{
                background: 'var(--accent-green)', border: 'none',
                borderRadius: '8px', padding: '9px 20px',
                color: '#fff', fontSize: '13px', fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s',
              }}
            >
              {loading === 'SOLVED' ? '…' : '✅ Mark Solved'}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── TO_DO state ───────────────────────────────────────────────────────────
  return (
    <>
      <Toast message={toastMsg} visible={toastVisible} onDismiss={() => setToastVisible(false)} />
      <div className="problem-card" style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '14px',
        padding: '24px',
        display: 'flex', flexDirection: 'column', gap: '16px',
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
            title="Blind practice mode — difficulty and topics are intentionally hidden to avoid anchoring bias. They'll be revealed once you mark this solved."
            style={{
              fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', borderRadius: '6px', padding: '3px 8px',
              flexShrink: 0, whiteSpace: 'nowrap', cursor: 'help',
            }}
          >
            🔒 topic hidden
          </span>
        </div>

        {/* Description — always rendered, blurred until revealed */}
        {descriptionBlock}

        {/* Footer */}
        <div style={{
          borderTop: '1px solid var(--border)', paddingTop: '14px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: '12px',
        }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* ↗ Solve — also triggers reveal+timer if first time */}
            <a
              href={solveUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleSolveLinkClick}
              style={{ color: 'var(--accent-blue)', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}
            >
              ↗ Solve
            </a>
            <button
              onClick={handleSkip}
              disabled={loading !== null}
              title="Replace this problem with a different one"
              style={{
                background: 'none', border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                color: 'var(--text-muted)', fontSize: '12px', padding: 0,
                opacity: loading === 'SKIP' ? 0.5 : 1, transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              {loading === 'SKIP' ? '…' : 'Skip →'}
            </button>
          </div>

          {/* "Mark Attempting" button — also triggers reveal if first time */}
          {!revealed && (
            <button
              onClick={handleReveal}
              disabled={loading !== null}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--accent-amber)55',
                borderRadius: '8px', padding: '7px 16px',
                color: 'var(--accent-amber)', fontSize: '13px', fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1, transition: 'all 0.15s',
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
