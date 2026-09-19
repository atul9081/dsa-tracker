'use client';

import type { Status } from '@/types';

interface Props {
  status: Status;
  size?: 'sm' | 'md';
}

const CONFIG: Record<Status, { label: string; color: string; emoji: string }> = {
  TO_DO:      { label: 'To-Do',      color: 'var(--accent-gray)',  emoji: '○'  },
  ATTEMPTING: { label: 'Attempting', color: 'var(--accent-amber)', emoji: '🔄' },
  SOLVED:     { label: 'Solved',     color: 'var(--accent-green)', emoji: '✅' },
};

export default function StatusBadge({ status, size = 'md' }: Props) {
  const cfg = CONFIG[status] ?? CONFIG.TO_DO;
  const px = size === 'sm' ? '6px 10px' : '4px 12px';
  const fs = size === 'sm' ? '11px' : '12px';

  return (
    <span style={{
      background: `${cfg.color}22`,
      color: cfg.color,
      border: `1px solid ${cfg.color}55`,
      borderRadius: '6px',
      padding: px,
      fontSize: fs,
      fontWeight: 600,
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
    }}>
      {cfg.emoji} {cfg.label}
    </span>
  );
}
