'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProblemWithStatus, Status } from '@/types';
import ProblemCard from '@/components/ProblemCard';

type DiffMode = 'chill' | 'standard' | 'grind';

// Matches PRESET_DISTRIBUTIONS in api/queue/route.ts
const PRESET_DISTRIBUTIONS: Record<DiffMode, Record<number, { hard: number; medium: number; easy: number }>> = {
  chill:    { 3: { hard: 0, medium: 2, easy: 1 }, 5: { hard: 0, medium: 2, easy: 3 }, 7: { hard: 0, medium: 4, easy: 3 } },
  standard: { 3: { hard: 1, medium: 2, easy: 0 }, 5: { hard: 1, medium: 3, easy: 1 }, 7: { hard: 2, medium: 3, easy: 2 } },
  grind:    { 3: { hard: 2, medium: 1, easy: 0 }, 5: { hard: 2, medium: 3, easy: 0 }, 7: { hard: 3, medium: 4, easy: 0 } },
};

function modeDesc(mode: DiffMode, count: number): string {
  const d = PRESET_DISTRIBUTIONS[mode][count];
  const parts: string[] = [];
  if (d.hard   > 0) parts.push(`${d.hard}H`);
  if (d.medium > 0) parts.push(`${d.medium}M`);
  if (d.easy   > 0) parts.push(`${d.easy}E`);
  return parts.join(' · ');
}

const DIFF_MODES: Array<{ key: DiffMode; label: string }> = [
  { key: 'chill',    label: '😌 Chill'    },
  { key: 'standard', label: '⚡ Standard' },
  { key: 'grind',    label: '🔥 Grind'    },
];

function getGreeting(): { text: string; emoji: string } {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return { text: 'Good morning',   emoji: '🌅' };
  if (h >= 12 && h < 17) return { text: 'Good afternoon', emoji: '☀️' };
  if (h >= 17 && h < 21) return { text: 'Good evening',   emoji: '🌇' };
  return                         { text: 'Good night',     emoji: '🌙' };
}

interface StreakData { streak: number; lastSolvedDate: string | null; }

export default function DailyQueuePage() {
  const [problems, setProblems]   = useState<ProblemWithStatus[]>([]);
  const [date, setDate]           = useState('');
  const [loading, setLoading]     = useState(true);
  const [regen, setRegen]         = useState(false);
  const [confirm, setConfirm]     = useState(false);
  const [diffMode, setDiffMode]   = useState<DiffMode>('standard');
  // #9: count picker in regen modal — defaults to 5, will be overridden from saved settings
  const [regenCount, setRegenCount] = useState<3 | 5 | 7>(5);
  const [streakData, setStreakData] = useState<StreakData>({ streak: 0, lastSolvedDate: null });
  const [exhausted, setExhausted] = useState(false);
  const [expectedCount, setExpectedCount] = useState<number | null>(null);
  // Skip undo state
  const [skipToast, setSkipToast]             = useState(false);
  const [skipUndoTitle, setSkipUndoTitle]     = useState('');
  const [preSkipProblems, setPreSkipProblems] = useState<ProblemWithStatus[]>([]); 

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/queue');
      const data = await res.json();
      setProblems(data.problems ?? []);
      setDate(data.date ?? '');
      setExhausted(data.exhausted ?? false);
      setExpectedCount(data.dailyCount ?? null); // UX #4
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
        // #9: send both mode AND daily_count so API ignores saved daily_count
        body: JSON.stringify({ mode: diffMode, daily_count: regenCount }),
      });
      const data = await res.json();
      setProblems(data.problems ?? []);
      setExhausted(data.exhausted ?? false);
      setExpectedCount(data.dailyCount ?? null); // UX #4
      if (data.date) setDate(data.date); // Fix Issue 15: keep displayed date in sync after regen
    } catch (e) {
      console.error(e);
    } finally {
      setRegen(false);
    }
  };

  useEffect(() => { loadQueue(); }, [loadQueue]);

  // Fetch streak and saved difficulty mode in parallel — neither blocks the queue render
  useEffect(() => {
    fetch('/api/streak')
      .then(r => r.json())
      .then(d => setStreakData(d))
      .catch(() => {});

    // Pre-populate regen mode + count from saved settings
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        const s = d?.settings;
        const saved = s?.difficulty_mode as string | undefined;
        if (saved && saved !== 'custom' && ['chill', 'standard', 'grind'].includes(saved)) {
          setDiffMode(saved as DiffMode);
        }
        const savedCount = s?.daily_count as number | undefined;
        if (savedCount === 3 || savedCount === 5 || savedCount === 7) {
          setRegenCount(savedCount);
        }
      })
      .catch(() => {});
  }, []);

  const handleStatusChange = (id: number, status: Status) => {
    setProblems(prev =>
      prev.map(p => p.id === id ? { ...p, status } : p)
    );
  };

  // UX #6: Skip with undo toast — store pre-skip state, swap optimistically,
  // allow reverting within 8s before the change becomes permanent on the server.
  const skipUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSkipRef   = useRef<{ skippedId: number; replacement: ProblemWithStatus } | null>(null);

  const commitSkip = useCallback(async (skippedId: number, replacement: ProblemWithStatus) => {
    // Actual API call — only called after the undo window expires
    try {
      await fetch('/api/queue/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem_id: skippedId }),
      });
    } catch (e) {
      console.error(e);
    }
    pendingSkipRef.current = null;
  }, []);

  const handleSkip = useCallback(async (skippedId: number) => {
    // Find the replacement first (server-side) then do an optimistic swap
    try {
      const res = await fetch('/api/queue/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem_id: skippedId }),
      });
      if (!res.ok) return;
      const { replacement } = await res.json();
      if (!replacement) return;

      const snapshot = problems; // capture before update for undo
      setPreSkipProblems(snapshot);
      pendingSkipRef.current = { skippedId, replacement };

      // Optimistic UI swap
      setProblems(prev =>
        prev.map(p => p.id === skippedId ? { ...replacement, status: replacement.status ?? 'TO_DO' } : p)
      );

      // Show undo toast
      setSkipUndoTitle(snapshot.find(p => p.id === skippedId)?.title ?? 'problem');
      setSkipToast(true);

      // Auto-hide after 8s (toast duration matches)
      if (skipUndoTimerRef.current) clearTimeout(skipUndoTimerRef.current);
      skipUndoTimerRef.current = setTimeout(() => setSkipToast(false), 8000);
    } catch (e) {
      console.error(e);
    }
  }, [problems]);

  const handleUndoSkip = useCallback(async () => {
    setSkipToast(false);
    if (skipUndoTimerRef.current) clearTimeout(skipUndoTimerRef.current);
    setProblems(preSkipProblems); // restore client state
    // Restore server state: swap the replacement back out
    const pending = pendingSkipRef.current;
    if (pending) {
      try {
        await fetch('/api/queue/skip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ problem_id: pending.replacement.id }),
        });
      } catch (e) { console.error(e); }
      pendingSkipRef.current = null;
    }
  }, [preSkipProblems, commitSkip]);

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
        {/* #11: time-based greeting */}
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '4px' }}>
          {(() => { const g = getGreeting(); return `${g.text} ${g.emoji}`; })()}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)' }}>
            Today&apos;s Queue
          </h1>
          {streakData.streak > 0 && (
            <span
              title={`${streakData.streak}-day solve streak`}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--accent-amber)44',
                borderRadius: '10px',
                padding: '6px 14px',
                fontSize: '14px',
                fontWeight: 700,
                color: 'var(--accent-amber)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              🔥 {streakData.streak} day{streakData.streak !== 1 ? 's' : ''}
            </span>
          )}
        </div>
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
              {/* UX #4: show expected count when pool came up short */}
              {exhausted && expectedCount !== null && problems.length < expectedCount && (
                <span style={{ marginLeft: '4px', color: 'var(--accent-amber)' }}>
                  · only {problems.length} available in your topics
                </span>
              )}
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
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '14px' }}>
            Great work. Take a break or go deeper.
          </p>
          {/* UX #10: one-click to get more problems */}
          <a
            href="/settings"
            style={{
              display: 'inline-block',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--accent-green)55',
              borderRadius: '8px',
              padding: '8px 18px',
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--accent-green)',
              textDecoration: 'none',
            }}
          >
            ⊕ Solve more today
          </a>
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
          {problems.length === 0 && !exhausted && (
            <div style={{
              textAlign: 'center', padding: '80px 0',
              color: 'var(--text-muted)', fontSize: '15px',
            }}>
              No problems in queue. Database may still be seeding.
            </div>
          )}
          {/* UX #1: quiet low-pool notice alongside live cards */}
          {exhausted && problems.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: '10px', padding: '10px 16px', fontSize: '12px',
              color: 'var(--text-muted)',
            }}>
              <span>⚠</span>
              <span>
                Only {problems.length} problem{problems.length !== 1 ? 's' : ''} available in your enabled topics.
                {' '}<a href="/settings" style={{ color: 'var(--accent-blue)' }}>Enable more topics</a> to fill your full daily target.
              </span>
            </div>
          )}
          {/* UX #1: 🏆 banner only when the queue is truly empty */}
          {exhausted && problems.length === 0 && (
            <div className="fade-in" style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--accent-blue)44',
              borderRadius: '14px',
              padding: '28px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>🏆</div>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--accent-blue)', marginBottom: '8px' }}>
                You&apos;ve completed enough problems!
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
                No more unsolved problems in your enabled topics.
                Try <a href="/settings" style={{ color: 'var(--accent-blue)' }}>enabling more topics</a> to continue.
              </p>
            </div>
          )}
        </div>
      )}

      {/* UX #6: skip undo toast shown at page level */}
      {skipToast && (
        <div
          className="fade-in"
          style={{
            position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: '10px', padding: '12px 18px',
            display: 'flex', alignItems: 'center', gap: '14px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', maxWidth: '320px',
          }}
        >
          <span>Skipped “{skipUndoTitle}”</span>
          <button
            onClick={handleUndoSkip}
            style={{
              background: 'var(--accent-amber)22', border: '1px solid var(--accent-amber)55',
              borderRadius: '6px', padding: '4px 12px', cursor: 'pointer',
              color: 'var(--accent-amber)', fontSize: '12px', fontWeight: 700, flexShrink: 0,
            }}
          >
            Undo
          </button>
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
              {/* Fix Issue 16: warn when in-progress problems would be lost */}
              {attempting > 0 && (
                <p style={{
                  color: 'var(--accent-amber)', fontSize: '12px', margin: 0,
                  background: 'var(--accent-amber)11',
                  border: '1px solid var(--accent-amber)33',
                  borderRadius: '8px', padding: '8px 14px',
                }}>
                  ⚠ {attempting} problem{attempting > 1 ? 's are' : ' is'} in progress —
                  regenerating may remove {attempting > 1 ? 'them' : 'it'} from today&apos;s queue.
                </p>
              )}
              {/* Count picker — how many problems in the fresh set */}
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: 0 }}>
                How many problems?
              </p>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                {([3, 5, 7] as const).map(n => (
                  <button
                    key={n}
                    onClick={() => setRegenCount(n)}
                    style={{
                      background: regenCount === n ? 'var(--accent-blue)22' : 'var(--bg-elevated)',
                      border: `1px solid ${regenCount === n ? 'var(--accent-blue)' : 'var(--border)'}`,
                      borderRadius: '8px', padding: '7px 20px',
                      color: regenCount === n ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      fontSize: '14px', fontWeight: regenCount === n ? 700 : 500,
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >{n}</button>
                ))}
              </div>
              {/* Difficulty mode picker */}
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: 0 }}>
                Pick a difficulty mode:
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                {DIFF_MODES.map(m => (
                  <button
                    key={m.key}
                    onClick={() => setDiffMode(m.key)}
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
                      {modeDesc(m.key, regenCount)}
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
