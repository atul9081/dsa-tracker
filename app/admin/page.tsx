'use client';

import { useEffect, useState, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface AdminUser {
  user_id: string;
  email: string | null;
  display_name: string | null;
  granted: boolean;
  is_admin: boolean;
  requested_at: string | null;
  admin_notes: string | null;
  last_sign_in: string | null;
}

interface UserStat {
  user_id: string;
  email: string | null;
  display_name: string | null;
  total_solved: number;
  total_attempting: number;
  queues_generated: number;
  top_topics: string[];
  last_active: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en', { month: 'short', year: '2-digit' });
}

function displayName(u: AdminUser | UserStat): string {
  return u.display_name || u.email || u.user_id.slice(0, 8) + '…';
}

function shortEmail(u: AdminUser | UserStat): string {
  return u.email ?? u.user_id.slice(0, 12) + '…';
}

// ── Styles ───────────────────────────────────────────────────────────────────

const tableHeaderStyle: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  fontSize: '13px',
  color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border)55',
  verticalAlign: 'middle',
};

const badgeStyle = (color: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '3px 8px',
  borderRadius: '5px',
  fontSize: '11px',
  fontWeight: 600,
  background: `${color}18`,
  color,
  border: `1px solid ${color}44`,
  whiteSpace: 'nowrap',
});

const actionBtn = (color = 'var(--text-muted)'): React.CSSProperties => ({
  background: 'none',
  border: `1px solid ${color}55`,
  borderRadius: '5px',
  padding: '4px 10px',
  color,
  fontSize: '11px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

// ── Component ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab, setTab]           = useState<'users' | 'analytics'>('users');
  const [users, setUsers]       = useState<AdminUser[]>([]);
  const [stats, setStats]       = useState<UserStat[]>([]);
  const [loading, setLoading]   = useState(true);
  const [addEmail, setAddEmail] = useState('');
  const [addMsg, setAddMsg]     = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null); // user_id
  const [noteVal, setNoteVal]   = useState('');

  const fetchUsers = useCallback(async () => {
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    if (data.users) setUsers(data.users);
  }, []);

  const fetchStats = useCallback(async () => {
    const res = await fetch('/api/admin/stats');
    const data = await res.json();
    if (data.stats) setStats(data.stats);
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([fetchUsers(), fetchStats()]);
      setLoading(false);
    })();
  }, [fetchUsers, fetchStats]);

  const patch = async (userId: string, body: Record<string, unknown>) => {
    await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await fetchUsers();
  };

  const deleteUser = async (userId: string) => {
    if (!confirm('Remove this pending user?')) return;
    await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    await fetchUsers();
  };

  const handleAdd = async () => {
    if (!addEmail.trim()) return;
    setAddLoading(true);
    setAddMsg('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: addEmail.trim() }),
    });
    const data = await res.json();
    if (data.status === 'granted_existing') {
      setAddMsg('✅ Access granted.');
      setAddEmail('');
      await fetchUsers();
    } else if (data.status === 'not_signed_up') {
      setAddMsg('⚠️ User hasn\'t signed up yet — ask them to create an account first.');
    } else {
      setAddMsg(data.error ?? 'Something went wrong.');
    }
    setAddLoading(false);
  };

  const saveNote = async (userId: string) => {
    await patch(userId, { admin_notes: noteVal });
    setEditingNote(null);
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="spinner" />
    </div>
  );

  const pending  = users.filter(u => !u.granted && !u.is_admin);
  const granted  = users.filter(u => u.granted && !u.is_admin);
  const admins   = users.filter(u => u.is_admin);

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px', fontFamily: 'var(--font-body)' }}>

      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
          <span style={{ fontSize: '22px' }}>🛡</span>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Admin Panel</h1>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
          {users.length} users total · {pending.length} pending · {granted.length} with access
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid var(--border)', paddingBottom: '0' }}>
        {(['users', 'analytics'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none', border: 'none',
              padding: '8px 18px',
              fontSize: '14px', fontWeight: tab === t ? 700 : 400,
              color: tab === t ? 'var(--accent-blue)' : 'var(--text-muted)',
              cursor: 'pointer',
              borderBottom: tab === t ? '2px solid var(--accent-blue)' : '2px solid transparent',
              marginBottom: '-1px',
              transition: 'all 0.12s',
            }}
          >
            {t === 'users' ? '👥 Users' : '📊 Analytics'}
          </button>
        ))}
      </div>

      {/* ── Users Tab ──────────────────────────────────────────────────── */}
      {tab === 'users' && (
        <div className="fade-in">

          {/* Pre-approve by email */}
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: '10px', padding: '16px 20px', marginBottom: '20px',
            display: 'flex', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1, minWidth: '240px' }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 8px' }}>
                Grant access by email
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={addEmail}
                  onChange={e => setAddEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                  style={{
                    flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    borderRadius: '7px', padding: '8px 12px', color: 'var(--text-primary)',
                    fontSize: '13px', outline: 'none',
                  }}
                />
                <button
                  onClick={handleAdd}
                  disabled={addLoading || !addEmail.trim()}
                  style={{
                    background: 'var(--accent-blue)', border: 'none', borderRadius: '7px',
                    padding: '8px 16px', color: '#fff', fontSize: '13px', fontWeight: 600,
                    cursor: addLoading ? 'not-allowed' : 'pointer', opacity: addLoading ? 0.6 : 1,
                  }}
                >
                  {addLoading ? '…' : 'Grant'}
                </button>
              </div>
              {addMsg && <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '6px 0 0' }}>{addMsg}</p>}
            </div>
          </div>

          {/* Pending users */}
          {pending.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                ⏳ Pending ({pending.length})
              </h2>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={tableHeaderStyle}>User</th>
                      <th style={tableHeaderStyle}>Joined</th>
                      <th style={tableHeaderStyle}>Last seen</th>
                      <th style={tableHeaderStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map(u => (
                      <tr key={u.user_id}>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{displayName(u)}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{shortEmail(u)}</div>
                        </td>
                        <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{timeAgo(u.requested_at)}</td>
                        <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{timeAgo(u.last_sign_in)}</td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => patch(u.user_id, { granted: true })} style={actionBtn('var(--accent-green)')}>
                              ✓ Grant
                            </button>
                            <button onClick={() => deleteUser(u.user_id)} style={actionBtn('var(--diff-hard)')}>
                              ✕ Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Granted users */}
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              ✅ Access granted ({granted.length})
            </h2>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={tableHeaderStyle}>User</th>
                    <th style={tableHeaderStyle}>Joined</th>
                    <th style={tableHeaderStyle}>Last seen</th>
                    <th style={tableHeaderStyle}>Notes</th>
                    <th style={tableHeaderStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {granted.map(u => (
                    <tr key={u.user_id}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{displayName(u)}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{shortEmail(u)}</div>
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{timeAgo(u.requested_at)}</td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{timeAgo(u.last_sign_in)}</td>
                      <td style={tdStyle}>
                        {editingNote === u.user_id ? (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <input
                              autoFocus
                              value={noteVal}
                              onChange={e => setNoteVal(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveNote(u.user_id); if (e.key === 'Escape') setEditingNote(null); }}
                              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '5px', padding: '4px 8px', color: 'var(--text-primary)', fontSize: '12px', width: '140px', outline: 'none' }}
                            />
                            <button onClick={() => saveNote(u.user_id)} style={actionBtn('var(--accent-blue)')}>Save</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingNote(u.user_id); setNoteVal(u.admin_notes ?? ''); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: u.admin_notes ? 'var(--text-secondary)' : 'var(--text-muted)', fontSize: '12px', padding: 0 }}
                            title={u.admin_notes ?? 'Add note'}
                          >
                            {u.admin_notes ? `📝 ${u.admin_notes.slice(0, 20)}${u.admin_notes.length > 20 ? '…' : ''}` : '+ note'}
                          </button>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => patch(u.user_id, { granted: false })} style={actionBtn('var(--diff-hard)')}>
                            Revoke
                          </button>
                          <button onClick={() => { if (confirm(`Promote ${displayName(u)} to admin?`)) patch(u.user_id, { is_admin: true }); }} style={actionBtn()}>
                            Promote
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {granted.length === 0 && (
                    <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)' }}>No users with access yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Admin users */}
          <div>
            <h2 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              👑 Admins ({admins.length})
            </h2>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={tableHeaderStyle}>User</th>
                    <th style={tableHeaderStyle}>Last seen</th>
                    <th style={tableHeaderStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map(u => (
                    <tr key={u.user_id}>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={badgeStyle('var(--accent-yellow)')}>👑 Admin</span>
                          <div>
                            <div style={{ fontWeight: 600 }}>{displayName(u)}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{shortEmail(u)}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{timeAgo(u.last_sign_in)}</td>
                      <td style={tdStyle}>
                        <button onClick={() => { if (confirm(`Demote ${displayName(u)} from admin?`)) patch(u.user_id, { is_admin: false }); }} style={actionBtn('var(--text-muted)')}>
                          Demote
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Analytics Tab ──────────────────────────────────────────────── */}
      {tab === 'analytics' && (
        <div className="fade-in">
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
              <thead>
                <tr>
                  <th style={tableHeaderStyle}>User</th>
                  <th style={{ ...tableHeaderStyle, textAlign: 'center' }}>Solved</th>
                  <th style={{ ...tableHeaderStyle, textAlign: 'center' }}>Attempting</th>
                  <th style={{ ...tableHeaderStyle, textAlign: 'center' }}>Queues</th>
                  <th style={tableHeaderStyle}>Top Topics</th>
                  <th style={tableHeaderStyle}>Last Active</th>
                </tr>
              </thead>
              <tbody>
                {stats.length === 0 && (
                  <tr><td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)' }}>No data yet</td></tr>
                )}
                {stats
                  .sort((a, b) => b.total_solved - a.total_solved)
                  .map(u => (
                  <tr key={u.user_id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{displayName(u)}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{shortEmail(u)}</div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, color: 'var(--accent-green)' }}>
                      {u.total_solved}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--accent-yellow)' }}>
                      {u.total_attempting}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-secondary)' }}>
                      {u.queues_generated}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {u.top_topics.length > 0
                          ? u.top_topics.map(t => (
                              <span key={t} style={badgeStyle('var(--accent-blue)')}>
                                {t.replace(/-/g, ' ')}
                              </span>
                            ))
                          : <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                        }
                      </div>
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{timeAgo(u.last_active)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
