'use client';

import { useState } from 'react';
import type { ProblemWithStatus, Status } from '@/types';
import DifficultyBadge from './DifficultyBadge';
import StatusBadge from './StatusBadge';
import TopicTags from './TopicTags';

interface Props {
  problem: ProblemWithStatus;
  onStatusChange?: (id: number, status: Status) => void;
}

const STATUS_BUTTONS: { status: Status; label: string; emoji: string; color: string }[] = [
  { status: 'SOLVED',    label: 'Solved',    emoji: '✅', color: 'var(--accent-green)' },
  { status: 'ATTEMPTED', label: 'Attempted', emoji: '🟡', color: 'var(--accent-amber)' },
  { status: 'DEBUGGING', label: 'Debugging', emoji: '🔴', color: 'var(--diff-hard)'    },
];

export default function ProblemCard({ problem, onStatusChange }: Props) {
  const [status, setStatus]     = useState<Status>(problem.status ?? 'TO_DO');
  const [revealed, setRevealed] = useState(problem.status !== 'TO_DO');
  const [loading, setLoading]   = useState<Status | null>(null);

  const handleMark = async (newStatus: Status) => {
    setLoading(newStatus);
    try {
      await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem_id: problem.id, status: newStatus }),
      });
      setStatus(newStatus);
      setRevealed(true);
      onStatusChange?.(problem.id, newStatus);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  };

  const lcUrl = `https://leetcode.com/problems/${problem.title_slug}/`;

  return (
    <div className="problem-card" style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: '14px',
      padding: '24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      position: 'relative',
      transition: 'border-color 0.2s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '14px', fontWeight: 600 }}>
            #{problem.id}
          </span>
          <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {problem.title}
          </h3>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          {revealed ? (
            <>
              <DifficultyBadge difficulty={problem.difficulty} />
              <StatusBadge status={status} />
            </>
          ) : (
            <span style={{
              fontSize: '12px', color: 'var(--text-muted)',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: '6px', padding: '4px 10px',
            }}>
              🔒 Hidden
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {problem.description ? (
        <div
          className="problem-description"
          dangerouslySetInnerHTML={{ __html: problem.description }}
          style={{
            color: 'var(--text-secondary)',
            fontSize: '14px',
            lineHeight: 1.7,
            maxHeight: revealed ? 'none' : '160px',
            overflow: 'hidden',
            maskImage: revealed ? 'none' : 'linear-gradient(to bottom, black 60%, transparent 100%)',
            WebkitMaskImage: revealed ? 'none' : 'linear-gradient(to bottom, black 60%, transparent 100%)',
          }}
        />
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', fontStyle: 'italic', margin: 0 }}>
          Click &ldquo;Open on LeetCode&rdquo; to read the problem.
        </p>
      )}

      {/* Tags (revealed only) */}
      {revealed && problem.topic_tags?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Topics</span>
          <TopicTags slugs={problem.topic_tags} />
        </div>
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
        <a
          href={lcUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'var(--accent-blue)',
            fontSize: '13px',
            fontWeight: 600,
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          Open on LeetCode ↗
        </a>

        {/* Status buttons */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {STATUS_BUTTONS.map(btn => (
            <button
              key={btn.status}
              onClick={() => handleMark(btn.status)}
              disabled={loading !== null}
              style={{
                background: status === btn.status ? `${btn.color}22` : 'var(--bg-elevated)',
                color: status === btn.status ? btn.color : 'var(--text-secondary)',
                border: `1px solid ${status === btn.status ? btn.color + '66' : 'var(--border)'}`,
                borderRadius: '8px',
                padding: '7px 14px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
                opacity: loading && loading !== btn.status ? 0.5 : 1,
              }}
            >
              {loading === btn.status ? '…' : `${btn.emoji} ${btn.label}`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
