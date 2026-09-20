'use client';

import { useEffect, useState } from 'react';

interface ToastProps {
  message: string;
  visible: boolean;
  duration?: number;          // ms before auto-dismiss (default 2500)
  onDismiss?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function Toast({
  message,
  visible,
  duration = 2500,
  onDismiss,
  action,
}: ToastProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!visible) { setShow(false); return; }
    setShow(true);
    const t = setTimeout(() => {
      setShow(false);
      onDismiss?.();
    }, duration);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, duration]);

  if (!show) return null;

  return (
    <div
      className="fade-in"
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        fontSize: '13px',
        fontWeight: 500,
        color: 'var(--text-primary)',
        maxWidth: '320px',
      }}
    >
      <span>{message}</span>
      {action && (
        <button
          onClick={() => {
            action.onClick();
            setShow(false);
            onDismiss?.();
          }}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '3px 10px',
            cursor: 'pointer',
            color: 'var(--accent-blue)',
            fontSize: '12px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
