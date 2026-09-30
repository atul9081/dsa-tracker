'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

const NAV_LINKS = [
  { href: '/',          label: 'Daily Queue' },
  { href: '/problems',  label: 'Problems'    },
  { href: '/analytics', label: 'Analytics'   },
  { href: '/history',   label: 'History'     },
  { href: '/settings',  label: 'Settings'    },
];

export default function Navbar() {
  const pathname    = usePathname();
  const router      = useRouter();
  const [email, setEmail]           = useState<string | null>(null);
  const [isAdmin, setIsAdmin]       = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen]     = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      setEmail(user?.email ?? null);
      if (user) {
        const { data } = await supabase
          .from('user_access')
          .select('is_admin')
          .eq('user_id', user.id)
          .single();
        setIsAdmin(data?.is_admin === true);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close mobile menu on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <>
      <nav style={{
        height: '56px',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        {/* Left: Logo + Nav links (desktop) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <Link href="/" style={{ textDecoration: 'none' }}>
            <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              ⚡ DSA Tracker
            </span>
          </Link>

          {/* Desktop nav links */}
          <div className="nav-links-desktop" style={{ display: 'flex', gap: '4px' }}>
            {[...NAV_LINKS, ...(isAdmin ? [{ href: '/admin', label: '🛡 Admin' }] : [])].map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(href + '/');
              return (
                <Link
                  key={href}
                  href={href}
                  style={{
                    textDecoration: 'none',
                    padding: '6px 14px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: active ? 600 : 500,
                    color: active ? 'var(--text-primary)' : href === '/admin' ? 'var(--accent-yellow)' : 'var(--text-secondary)',
                    background: active ? 'var(--bg-elevated)' : 'transparent',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = href === '/admin' ? 'var(--accent-yellow)' : 'var(--text-primary)'; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = href === '/admin' ? 'var(--accent-yellow)' : 'var(--text-secondary)'; }}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Right: user email + sign out (desktop) + hamburger (mobile) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Desktop: user + sign out */}
          {email && (
            <div className="nav-user-desktop" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                fontSize: '12px', color: 'var(--text-muted)',
                maxWidth: '180px', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {email}
              </span>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '7px',
                  padding: '5px 12px',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {signingOut ? '…' : 'Sign out'}
              </button>
            </div>
          )}

          {/* Hamburger button (mobile only) */}
          <button
            className="nav-hamburger"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Toggle menu"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '6px',
              display: 'none',   // shown via CSS media query
              flexDirection: 'column',
              gap: '5px',
            }}
          >
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                display: 'block', width: '22px', height: '2px',
                background: 'var(--text-secondary)', borderRadius: '2px',
                transition: 'transform 0.2s, opacity 0.2s',
                transform: menuOpen
                  ? i === 0 ? 'translateY(7px) rotate(45deg)'
                  : i === 2 ? 'translateY(-7px) rotate(-45deg)'
                  : 'scaleX(0)'
                  : 'none',
                opacity: menuOpen && i === 1 ? 0 : 1,
              }} />
            ))}
          </button>
        </div>
      </nav>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div
          className="fade-in"
          style={{
            position: 'fixed',
            top: '56px',
            left: 0,
            right: 0,
            bottom: 0,
            background: 'var(--bg-primary)',
            zIndex: 99,
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {[...NAV_LINKS, ...(isAdmin ? [{ href: '/admin', label: '🛡 Admin' }] : [])].map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                style={{
                  textDecoration: 'none',
                  padding: '14px 16px',
                  borderRadius: '10px',
                  fontSize: '16px',
                  fontWeight: active ? 700 : 500,
                  color: active ? 'var(--text-primary)' : href === '/admin' ? 'var(--accent-yellow)' : 'var(--text-secondary)',
                  background: active ? 'var(--bg-elevated)' : 'transparent',
                  border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
                }}
              >
                {label}
              </Link>
            );
          })}

          {email && (
            <div style={{ marginTop: 'auto', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>{email}</p>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  color: 'var(--text-secondary)',
                  fontSize: '14px',
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                {signingOut ? '…' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
