'use client';

import { useEffect, useState, useCallback } from 'react';
import type { ProblemWithStatus, Status, Difficulty } from '@/types';
import ProblemRow from '@/components/ProblemRow';
import { OLT_TOPICS } from '@/config/topics';

const PAGE_SIZE = 50;

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '',           label: 'All Statuses' },
  { value: 'TO_DO',     label: 'To-Do'         },
  { value: 'ATTEMPTING',label: 'Attempting'    },
  { value: 'SOLVED',    label: 'Solved'        },
];

const DIFF_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '',      label: 'All Difficulties' },
  { value: 'EASY',  label: 'Easy'             },
  { value: 'MEDIUM',label: 'Medium'           },
  { value: 'HARD',  label: 'Hard'             },
];

export default function ProblemsPage() {
  const [all, setAll]           = useState<ProblemWithStatus[]>([]);
  const [filtered, setFiltered] = useState<ProblemWithStatus[]>([]);
  const [loading, setLoading]   = useState(true);
  const [page, setPage]         = useState(1);

  const [search, setSearch]     = useState('');
  const [status, setStatus]     = useState('');
  const [diff, setDiff]         = useState('');
  const [topic, setTopic]       = useState('');

  // Fetch all problems
  useEffect(() => {
    (async () => {
      const { createBrowserClient } = await import('@supabase/ssr');
      const sb = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { data } = await sb.from('problems_with_status').select('*').order('id');
      setAll((data as ProblemWithStatus[]) ?? []);
      setLoading(false);
    })();
  }, []);

  // Filter
  const applyFilters = useCallback(() => {
    let list = all;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.title.toLowerCase().includes(q) || String(p.id).includes(q));
    }
    if (status) list = list.filter(p => p.status === status);
    if (diff)   list = list.filter(p => p.difficulty === diff);
    if (topic)  list = list.filter(p => p.topic_tags?.includes(topic));
    setFiltered(list);
    setPage(1);
  }, [all, search, status, diff, topic]);

  useEffect(() => { applyFilters(); }, [applyFilters]);

  const handleStatusChange = (id: number, newStatus: Status) => {
    setAll(prev => prev.map(p => p.id === id ? { ...p, status: newStatus } : p));
  };

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const selectStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '8px 12px',
    color: 'var(--text-primary)',
    fontSize: '13px',
    cursor: 'pointer',
    outline: 'none',
  };

  return (
    <div className="page-container" style={{ maxWidth: '1100px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '6px' }}>Problems</h1>
        {!loading && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            {filtered.length} of {all.length} problems
          </p>
        )}
      </div>

      {/* Filter bar */}
      <div style={{
        display: 'flex', gap: '10px', flexWrap: 'wrap',
        marginBottom: '20px', alignItems: 'center',
      }}>
        <input
          type="text"
          placeholder="Search by title or ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            ...selectStyle,
            flexGrow: 1, minWidth: '200px',
            background: 'var(--bg-elevated)',
          }}
        />
        <select value={status} onChange={e => setStatus(e.target.value)} style={selectStyle}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={diff} onChange={e => setDiff(e.target.value)} style={selectStyle}>
          {DIFF_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={topic} onChange={e => setTopic(e.target.value)} style={selectStyle}>
          <option value="">All Topics</option>
          {OLT_TOPICS.map(t => <option key={t.slug} value={t.slug}>{t.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px' }}>
            <div className="spinner" />
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Difficulty</th>
                <th style={{ textAlign: 'center' }}>OLT Score</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(p => (
                <ProblemRow key={p.id} problem={p} onStatusChange={handleStatusChange} />
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
                    No problems match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '20px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{ ...selectStyle, cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.4 : 1 }}
          >
            ← Prev
          </button>
          {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
            const n = page <= 4 ? i + 1 : page - 3 + i;
            if (n < 1 || n > totalPages) return null;
            return (
              <button key={n} onClick={() => setPage(n)} style={{
                ...selectStyle,
                background: page === n ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                color: page === n ? '#fff' : 'var(--text-primary)',
                fontWeight: page === n ? 700 : 400,
              }}>
                {n}
              </button>
            );
          })}
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{ ...selectStyle, cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.4 : 1 }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
