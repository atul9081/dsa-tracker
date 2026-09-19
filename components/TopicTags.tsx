'use client';

import { OLT_TOPICS } from '@/config/topics';

interface Props {
  slugs: string[];
}

const SLUG_TO_NAME = Object.fromEntries(OLT_TOPICS.map(t => [t.slug, t.name]));

export default function TopicTags({ slugs }: Props) {
  if (!slugs?.length) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {slugs.slice(0, 5).map(slug => (
        <span key={slug} style={{
          background: 'var(--bg-elevated)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
          borderRadius: '5px',
          padding: '3px 8px',
          fontSize: '11px',
          fontWeight: 500,
        }}>
          {SLUG_TO_NAME[slug] ?? slug}
        </span>
      ))}
    </div>
  );
}
