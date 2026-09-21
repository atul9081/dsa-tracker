'use client';

import { createBrowserClient } from '@supabase/ssr';

export default function WaitingPage() {
  const handleSignOut = async () => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      fontFamily: 'Inter, system-ui, sans-serif',
      padding: '24px',
    }}>
      <div style={{
        maxWidth: '440px',
        width: '100%',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '18px',
        padding: '40px 36px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '20px',
        textAlign: 'center',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      }}>
        {/* Icon */}
        <div style={{
          width: '64px', height: '64px',
          borderRadius: '50%',
          background: 'var(--accent-amber)18',
          border: '1px solid var(--accent-amber)44',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '28px',
        }}>
          ⏳
        </div>

        {/* Heading */}
        <div>
          <h1 style={{
            margin: '0 0 8px',
            fontSize: '22px',
            fontWeight: 700,
            color: 'var(--text-primary)',
          }}>
            Access Pending
          </h1>
          <p style={{
            margin: 0,
            fontSize: '14px',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}>
            Your account has been created successfully, but access hasn&apos;t been granted yet.
            This is a private tool — reach out to request access.
          </p>
        </div>

        {/* Contact */}
        <div style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          padding: '14px 20px',
          width: '100%',
        }}>
          <p style={{ margin: '0 0 4px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Contact
          </p>
          <a
            href="mailto:intruderjsr@duck.com"
            style={{ color: 'var(--accent-blue)', fontSize: '14px', fontWeight: 600, textDecoration: 'none' }}
          >
            intruderjsr@duck.com
          </a>
        </div>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '8px 20px',
            color: 'var(--text-muted)',
            fontSize: '13px',
            cursor: 'pointer',
            transition: 'all 0.15s',
            width: '100%',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--text-muted)';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.color = 'var(--text-muted)';
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
