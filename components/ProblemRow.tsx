'use client';

import type { ProblemWithStatus, Status } from '@/types';
import DifficultyBadge from './DifficultyBadge';
import StatusBadge from './StatusBadge';
import TopicTags from './TopicTags';

interface Props {
  problem: ProblemWithStatus;
  onStatusChange?: (id: number, status: Status) => void;
}

export default function ProblemRow({ problem, onStatusChange }: Props) {
  const handleStatus = async (status: Status) => {
    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem_id: problem.id, status }),
    });
    onStatusChange?.(problem.id, status);
  };

  return (
    <tr style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '13px', width: '60px' }}>
        #{problem.id}
      </td>
      <td style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500 }}>
            {problem.title}
          </span>
          <TopicTags slugs={problem.topic_tags} />
        </div>
      </td>
      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
        <DifficultyBadge difficulty={problem.difficulty} size="sm" />
      </td>
      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center' }}>
        {problem.olt_score}
      </td>
      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
        <StatusBadge status={problem.status} size="sm" />
      </td>
      <td style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {(['SOLVED','ATTEMPTED','DEBUGGING','TO_DO'] as Status[]).map(s => (
            <button
              key={s}
              onClick={() => handleStatus(s)}
              title={s}
              style={{
                background: problem.status === s ? 'var(--bg-elevated)' : 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '5px',
                padding: '3px 8px',
                fontSize: '11px',
                color: problem.status === s ? 'var(--text-primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontWeight: problem.status === s ? 600 : 400,
              }}
            >
              {s === 'SOLVED' ? '✅' : s === 'ATTEMPTED' ? '🟡' : s === 'DEBUGGING' ? '🔴' : '○'}
            </button>
          ))}
          <a
            href={`https://leetcode.com/problems/${problem.title_slug}/`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent-blue)', fontSize: '12px', textDecoration: 'none', marginLeft: '4px' }}
          >
            LC ↗
          </a>
        </div>
      </td>
    </tr>
  );
}
