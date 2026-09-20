'use client';

import { useState } from 'react';
import type { ProblemWithStatus, Status } from '@/types';
import DifficultyBadge from './DifficultyBadge';
import TopicTags from './TopicTags';

interface Props {
  problem: ProblemWithStatus;
  onStatusChange?: (id: number, status: Status) => void;
}

const DESCRIPTION_THRESHOLD = 1200; // chars — beyond this, show "more" toggle

/**
 * Strips "Difficulty: Easy/Medium/Hard" lines from the scraped leetcode.ca HTML.
 * The description is stored with those lines included; they must be hidden in
 * blind mode (TO_DO / ATTEMPTING) to avoid spoiling the difficulty.
 *
 * Patterns handled:
 *   <p><strong>Difficulty:</strong> Medium</p>
 *   <p>Difficulty: Hard</p>
 *   plain-text variants that slip through as a <p> or inline
 */
function sanitizeDescription(html: string): string {
  return html
    // Remove any tag pair that contains only a Difficulty label
    .replace(/<[^>]+>\s*<strong>\s*Difficulty\s*:\s*<\/strong>[^<]*<\/[^>]+>/gi, '')
    .replace(/<[^>]+>\s*Difficulty\s*:\s*(Easy|Medium|Hard)\s*<\/[^>]+>/gi, '')
    // Catch bare "Difficulty: Medium" text nodes sitting between tags
    .replace(/Difficulty\s*:\s*(Easy|Medium|Hard)/gi, '');
}

export default function ProblemCard({ problem, onStatusChange }: Props) {
  const [status, setStatus]           = useState<Status>(problem.status ?? 'TO_DO');
  const [loading, setLoading]         = useState<Status | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);  // for TO_DO long descriptions
  const [solvedExpanded, setSolvedExpanded] = useState(false); // for SOLVED accordion

  const isLong = (problem.description?.length ?? 0) > DESCRIPTION_THRESHOLD;

  const updateStatus = async (newStatus: Status) => {
    setLoading(newStatus);
    try {
      await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem_id: problem.id, status: newStatus }),
      });
      setStatus(newStatus);
      onStatusChange?.(problem.id, newStatus);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(null);
    }
  };

  // Clicking LC link auto-advances to ATTEMPTING
  const handleLcClick = () => {
    if (status === 'TO_DO') {
      updateStatus('ATTEMPTING');
    }
  };

  const lcUrl = `https://leetcode.com/problems/${problem.title_slug}/`;

  // ── SOLVED state ───────────────────────────────────────────────────────────
  if (status === 'SOLVED') {
    return (
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
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
            <DifficultyBadge difficulty={problem.difficulty} size="sm" />
            <span style={{
              background: 'var(--accent-green)22', color: 'var(--accent-green)',
              border: '1px solid var(--accent-green)55', borderRadius: '6px',
              padding: '4px 10px', fontSize: '12px', fontWeight: 600,
            }}>✅ Solved</span>
          </div>
        </div>

        {/* Topic tags always visible once solved */}
        {problem.topic_tags?.length > 0 && (
          <TopicTags slugs={problem.topic_tags} />
        )}

        {/* Collapsible description accordion */}
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
    );
  }

  // ── ATTEMPTING state ───────────────────────────────────────────────────────
  if (status === 'ATTEMPTING') {
    return (
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
          <span style={{
            background: 'var(--accent-amber)22', color: 'var(--accent-amber)',
            border: '1px solid var(--accent-amber)55', borderRadius: '6px',
            padding: '4px 10px', fontSize: '12px', fontWeight: 600,
          }}>🔄 Attempting</span>
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
            onClick={() => updateStatus('SOLVED')}
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
    );
  }

  // ── TO_DO state (default) ──────────────────────────────────────────────────
  const descHtml = problem.description ?? '';
  const showToggle = isLong;
  // Strip "Difficulty: ..." lines — they leak from the scraped leetcode.ca HTML
  const displayedDesc = sanitizeDescription(descHtml);

  return (
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
        {/* Difficulty/topics hidden in TO_DO — only show LC link hint */}
        <span style={{
          fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-elevated)',
          border: '1px solid var(--border)', borderRadius: '6px', padding: '3px 8px',
          flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          🔒 topic hidden
        </span>
      </div>

      {/* Description — always visible in TO_DO */}
      {descHtml ? (
        <div>
          <div
            className="problem-description"
            dangerouslySetInnerHTML={{ __html: displayedDesc }}
            style={{
              color: 'var(--text-secondary)',
              fontSize: '14px',
              lineHeight: 1.7,
              maxHeight: (!showToggle || descExpanded) ? 'none' : '260px',
              overflow: 'hidden',
              maskImage: (!showToggle || descExpanded) ? 'none' : 'linear-gradient(to bottom, black 60%, transparent 100%)',
              WebkitMaskImage: (!showToggle || descExpanded) ? 'none' : 'linear-gradient(to bottom, black 60%, transparent 100%)',
            }}
          />
          {showToggle && (
            <button
              onClick={() => setDescExpanded(e => !e)}
              style={{
                marginTop: '8px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--accent-blue)',
                fontSize: '13px',
                fontWeight: 600,
                padding: '0',
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
          onClick={handleLcClick}
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
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>(sets Attempting)</span>
        </a>

        <button
          onClick={() => updateStatus('ATTEMPTING')}
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
      </div>
    </div>
  );
}
