'use client';

import type { Difficulty } from '@/types';

interface Props {
  difficulty: Difficulty;
  size?: 'sm' | 'md';
}

const CONFIG: Record<Difficulty, { label: string; color: string }> = {
  EASY:   { label: 'Easy',   color: 'var(--diff-easy)'   },
  MEDIUM: { label: 'Medium', color: 'var(--diff-medium)' },
  HARD:   { label: 'Hard',   color: 'var(--diff-hard)'   },
};

export default function DifficultyBadge({ difficulty, size = 'md' }: Props) {
  const { label, color } = CONFIG[difficulty] ?? CONFIG.MEDIUM;
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
