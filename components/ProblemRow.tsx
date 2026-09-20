'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProblemWithStatus, Status } from '@/types';
import DifficultyBadge from './DifficultyBadge';
import StatusBadge from './StatusBadge';
import TopicTags from './TopicTags';
import Toast from './Toast';

interface Props {
  problem: ProblemWithStatus;
  onStatusChange?: (id: number, status: Status) => void;
}

const STATUS_CYCLE: Array<{ status: Status; label: string }> = [
  { status: 'TO_DO',     label: '○ To-Do'      },
  { status: 'ATTEMPTING',label: '🔄 Attempting' },
  { status: 'SOLVED',    label: '✅ Solved'     },
];

export default function ProblemRow({ problem, onStatusChange }: Props) {
  const [status, setStatus]         = useState<Status>(problem.status ?? 'TO_DO');
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg]     = useState('');

  const handleStatus = async (newStatus: Status) => {
    setStatus(newStatus);
    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem_id: problem.id, status: newStatus }),
    });
    onStatusChange?.(problem.id, newStatus);
    const labels: Record<Status, string> = {
      TO_DO: 'Reset to To-Do',
      ATTEMPTING: '🔄 Marked as Attempting',
      SOLVED: '✅ Marked as Solved!',
    };
    setToastMsg(labels[newStatus]);
    setToastVisible(true);
  };

  return (
    <>
      {typeof window !== 'undefined' && createPortal(
        <Toast
          message={toastMsg}
          visible={toastVisible}
          onDismiss={() => setToastVisible(false)}
        />,
        document.body
      )}
    <tr
      style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
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
          {/* Only show topics if SOLVED */}
          {status === 'SOLVED' && <TopicTags slugs={problem.topic_tags} />}
        </div>
      </td>
      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
        {/* Only show difficulty if SOLVED */}
        {status === 'SOLVED'
          ? <DifficultyBadge difficulty={problem.difficulty} size="sm" />
          : <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>🔒</span>
        }
      </td>
      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center' }}>
        {problem.olt_score}
      </td>
      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
        <StatusBadge status={status} size="sm" />
      </td>
      <td style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {STATUS_CYCLE.map(({ status: s, label }) => (
            <button
              key={s}
              onClick={() => handleStatus(s)}
              title={label}
              style={{
                background: status === s ? 'var(--bg-elevated)' : 'transparent',
                border: `1px solid ${status === s ? 'var(--accent-blue)44' : 'var(--border)'}`,
                borderRadius: '5px',
                padding: '3px 8px',
                fontSize: '11px',
                color: status === s ? 'var(--text-primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontWeight: status === s ? 600 : 400,
                transition: 'all 0.1s',
              }}
            >
              {label.split(' ')[0]}
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
    </>
  );
}
