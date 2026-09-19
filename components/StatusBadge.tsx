'use client';

import type { Status } from '@/types';

interface Props {
  status: Status;
  size?: 'sm' | 'md';
}

const CONFIG: Record<Status, { label: string; color: string }> = {
  TO_DO:     { label: 'To-Do',     color: 'var(--accent-gray)'  },
  ATTEMPTED: { label: 'Attempted', color: 'var(--accent-blue)'  },
  DEBUGGING: { label: 'Debugging', color: 'var(--accent-amber)' },
  SOLVED:    { label: 'Solved',    color: 'var(--accent-green)' },
};

export default function StatusBadge({ status, size = 'md' }: Props) {
  const { label, color } = CONFIG[status] ?? CONFIG.TO_DO;
  const px = size === 'sm' ? '6px 10px' : '4px 12px';
  const fs = size === 'sm' ? '11px' : '12px';

  return (
    <span style={{
      background: `${color}22`,
      color,
      border: `1px solid ${color}55`,
      borderRadius: '6px',
      padding: px,
      fontSize: fs,
      fontWeight: 600,
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}
