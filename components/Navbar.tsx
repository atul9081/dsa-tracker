'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/',          label: 'Daily Queue' },
  { href: '/problems',  label: 'Problems'    },
  { href: '/analytics', label: 'Analytics'   },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav style={{
      background: 'var(--bg-card)',
      borderBottom: '1px solid var(--border)',
      padding: '0 24px',
      display: 'flex',
      alignItems: 'center',
      gap: '0',
      height: '56px',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      backdropFilter: 'blur(10px)',
    }}>
      {/* Logo */}
      <Link href="/" style={{
        textDecoration: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginRight: '32px',
      }}>
        <span style={{ fontSize: '20px' }}>⚡</span>
        <span style={{
          fontWeight: 800,
          fontSize: '15px',
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
        }}>
          DSA Tracker
        </span>
      </Link>

      {/* Nav links */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {NAV_ITEMS.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} style={{
              textDecoration: 'none',
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: active ? 600 : 500,
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: active ? 'var(--bg-elevated)' : 'transparent',
              transition: 'all 0.15s',
            }}>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
