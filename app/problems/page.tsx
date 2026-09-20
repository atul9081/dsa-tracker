'use client';

import { useEffect, useState, useCallback } from 'react';
import type { ProblemWithStatus, Status } from '@/types';
import ProblemRow from '@/components/ProblemRow';
import { OLT_TOPICS } from '@/config/topics';

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: '',            label: 'All Statuses' },
  { value: 'TO_DO',      label: 'To-Do'         },
  { value: 'ATTEMPTING', label: 'Attempting'    },
  { value: 'SOLVED',     label: 'Solved'        },
];

const DIFF_OPTIONS = [
  { value: '',       label: 'All Difficulties' },
  { value: 'EASY',   label: 'Easy'             },
  { value: 'MEDIUM', label: 'Medium'           },
  { value: 'HARD',   label: 'Hard'             },
];

type SortField = 'id' | 'difficulty' | 'olt_score' | 'status' | 'first_attempted_at';
type SortDir   = 'asc' | 'desc';

const DIFF_ORDER = { EASY: 0, MEDIUM: 1, HARD: 2 };
const STATUS_ORDER = { TO_DO: 0, ATTEMPTING: 1, SOLVED: 2 };

function sortProblems(list: ProblemWithStatus[], field: SortField, dir: SortDir): ProblemWithStatus[] {
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (field === 'id')       cmp = a.id - b.id;
    if (field === 'difficulty') {
      cmp = (DIFF_ORDER[a.difficulty as keyof typeof DIFF_ORDER] ?? 0)
          - (DIFF_ORDER[b.difficulty as keyof typeof DIFF_ORDER] ?? 0);
    }
    if (field === 'olt_score')  cmp = (a.olt_score ?? 0) - (b.olt_score ?? 0);
    if (field === 'status') {
      cmp = (STATUS_ORDER[a.status as keyof typeof STATUS_ORDER] ?? 0)
          - (STATUS_ORDER[b.status as keyof typeof STATUS_ORDER] ?? 0);
    }
    if (field === 'first_attempted_at') {
      const da = a.first_attempted_at ? new Date(a.first_attempted_at).getTime() : 0;
      const db = b.first_attempted_at ? new Date(b.first_attempted_at).getTime() : 0;
      cmp = da - db;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

function relativeTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const days  = Math.floor(diff / 86_400_000);
  const hours = Math.floor(diff / 3_600_000);
  const mins  = Math.floor(diff / 60_000);
  if (days  > 0)  return `${days}d ago`;
  if (hours > 0)  return `${hours}h ago`;
  if (mins  > 0)  return `${mins}m ago`;
  return 'just now';
}

export default function ProblemsPage() {
  const [all, setAll]           = useState<ProblemWithStatus[]>([]);
  const [filtered, setFiltered] = useState<ProblemWithStatus[]>([]);
  const [loading, setLoading]   = useState(true);
  const [page, setPage]         = useState(1);

  const [search, setSearch]     = useState('');
  const [status, setStatus]     = useState('');
  const [diff, setDiff]         = useState('');
  const [topic, setTopic]       = useState('');

  const [sortField, setSortField] = useState<SortField>('id');
  const [sortDir,   setSortDir]   = useState<SortDir>('asc');

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

  const applyFilters = useCallback(() => {
    let list = all;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.title.toLowerCase().includes(q) || String(p.id).includes(q));
    }
    if (status) list = list.filter(p => p.status === status);
    if (diff)   list = list.filter(p => p.difficulty === diff);
    if (topic)  list = list.filter(p => p.topic_tags?.includes(topic));
    list = sortProblems(list, sortField, sortDir);
    setFiltered(list);
    setPage(1);
  }, [all, search, status, diff, topic, sortField, sortDir]);

  useEffect(() => { applyFilters(); }, [applyFilters]);

  const handleStatusChange = (id: number, newStatus: Status) => {
    setAll(prev => prev.map(p => p.id === id ? { ...p, status: newStatus } : p));
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
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

  const thBtn = (field: SortField, label: string, align?: string) => (
    <th>
      <button
        onClick={() => toggleSort(field)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: sortField === field ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: '12px', fontWeight: 600, padding: 0,
          display: 'flex', alignItems: 'center', gap: '4px',
          textAlign: (align as 'left' | 'center') ?? 'left',
        }}
      >
        {label}
        <span style={{ fontSize: '10px', opacity: 0.7 }}>
          {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );

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
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by title or ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...selectStyle, flexGrow: 1, minWidth: '200px' }}
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
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px' }}>
            <div className="spinner" />
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                {thBtn('id', '#')}
                <th><span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Title</span></th>
                {thBtn('difficulty', 'Difficulty')}
                {thBtn('olt_score', 'OLT Score')}
                {thBtn('status', 'Status')}
                {thBtn('first_attempted_at', 'Last Attempted')}
                <th><span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(p => (
                <ProblemRow
                  key={p.id}
                  problem={p}
                  onStatusChange={handleStatusChange}
                  extraCell={
                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                      {relativeTime(p.first_attempted_at)}
                    </td>
                  }
                />
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
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
