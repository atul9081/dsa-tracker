import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Navbar from '@/components/Navbar';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'DSA Tracker — Blind Practice',
  description: 'Personal LeetCode blind practice tracker with daily queues and analytics',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body>
        <Navbar />
        <main style={{ minHeight: 'calc(100vh - 56px)', background: 'var(--bg-primary)' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
