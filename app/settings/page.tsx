'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OLT_TOPICS } from '@/config/topics';
import type { UserSettings } from '@/types';

type DiffMode = 'chill' | 'standard' | 'grind' | 'custom';

const DAILY_COUNT_OPTIONS = [3, 5, 7];

const DIFF_MODES: Array<{ key: DiffMode; label: string; desc: string }> = [
  { key: 'chill',    label: '😌 Chill',    desc: '0H · 3M · 2E' },
  { key: 'standard', label: '⚡ Standard', desc: '2H · 3M · 0E' },
  { key: 'grind',    label: '🔥 Grind',    desc: '3H · 2M · 0E' },
  { key: 'custom',   label: '⚙️ Custom',   desc: 'Set your own' },
];

const DEFAULT_SETTINGS: UserSettings = {
  daily_count: 5,
  hard_count: 2,
  medium_count: 3,
  easy_count: 0,
  difficulty_mode: 'standard',
  enabled_topic_slugs: null,
  topic_weight_overrides: {},
  enabled_sources: ['leetcode'],
  cooldown_days: 7,
};

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: subtitle ? '4px' : 0 }}>
        {title}
      </h2>
      {subtitle && <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{subtitle}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [regen, setRegen]       = useState(false);

  // Derive enabled slugs state: null = all enabled, array = specific set
  // We treat null as "all checkboxes on"
  const allEnabled = settings.enabled_topic_slugs === null;
  const enabledSet = new Set(settings.enabled_topic_slugs ?? OLT_TOPICS.map(t => t.slug));

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (data.settings) setSettings(data.settings);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setMode = (mode: DiffMode) => {
    const presets: Record<Exclude<DiffMode, 'custom'>, { hard_count: number; medium_count: number; easy_count: number }> = {
      chill:    { hard_count: 0, medium_count: 3, easy_count: 2 },
      standard: { hard_count: 2, medium_count: 3, easy_count: 0 },
      grind:    { hard_count: 3, medium_count: 2, easy_count: 0 },
    };
    if (mode !== 'custom') {
      setSettings(s => ({ ...s, difficulty_mode: mode, ...presets[mode], daily_count: presets[mode].hard_count + presets[mode].medium_count + presets[mode].easy_count }));
    } else {
      setSettings(s => ({ ...s, difficulty_mode: 'custom' }));
    }
  };

  const toggleTopic = (slug: string) => {
    if (allEnabled) {
      // Switching from "all enabled" → specific set with this one disabled
      const newSet = OLT_TOPICS.map(t => t.slug).filter(s => s !== slug);
      setSettings(s => ({ ...s, enabled_topic_slugs: newSet }));
    } else {
      const newSet = enabledSet.has(slug)
        ? [...enabledSet].filter(s => s !== slug)
        : [...enabledSet, slug];
      // If all selected, set back to null (all enabled)
      setSettings(s => ({
        ...s,
        enabled_topic_slugs: newSet.length === OLT_TOPICS.length ? null : newSet,
      }));
    }
  };

  const selectAllTopics  = () => setSettings(s => ({ ...s, enabled_topic_slugs: null }));
  const clearAllTopics   = () => setSettings(s => ({ ...s, enabled_topic_slugs: [] }));

  const save = async (): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const ok = await save();
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const handleSaveAndRegen = async () => {
    setRegen(true);
    const ok = await save();
    if (ok) {
      await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: settings.difficulty_mode }),
      });
      router.push('/');
    }
    setRegen(false);
  };

  const sectionStyle = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '20px',
  };

  const pillBtnStyle = (active: boolean) => ({
    background: active ? 'var(--accent-blue)22' : 'var(--bg-elevated)',
    border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border)'}`,
    borderRadius: '8px',
    padding: '8px 20px',
    color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
    fontSize: '14px',
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

  if (loading) return (
    <div className="page-container" style={{ display: 'flex', justifyContent: 'center', paddingTop: '80px' }}>
      <div className="spinner" />
    </div>
  );

  return (
    <div className="page-container" style={{ maxWidth: '720px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '28px' }}>Settings</h1>

      {/* ── Queue Setup ──────────────────────────────────────────── */}
      <section style={sectionStyle} className="fade-in">
        <SectionHeader
          title="Queue Setup"
          subtitle="Controls how your daily problem set is generated."
        />

        {/* Daily count */}
        <div style={{ marginBottom: '24px' }}>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '10px' }}>
            Problems per day
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            {DAILY_COUNT_OPTIONS.map(n => (
              <button
                key={n}
                onClick={() => setSettings(s => ({ ...s, daily_count: n }))}
                style={pillBtnStyle(settings.daily_count === n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Difficulty mode */}
        <div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '10px' }}>
            Default difficulty mode
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {DIFF_MODES.map(m => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                style={{ ...pillBtnStyle(settings.difficulty_mode === m.key), minWidth: '100px' }}
              >
                {m.label}
                <span style={{ display: 'block', fontSize: '10px', fontWeight: 400, opacity: 0.7, marginTop: '2px' }}>
                  {m.desc}
                </span>
              </button>
            ))}
          </div>

          {/* Custom inputs */}
          {settings.difficulty_mode === 'custom' && (
            <div className="fade-in" style={{ marginTop: '16px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {([['Hard', 'hard_count'], ['Medium', 'medium_count'], ['Easy', 'easy_count']] as const).map(([label, key]) => (
                <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={settings[key]}
                    onChange={e => setSettings(s => ({
                      ...s,
                      [key]: Math.max(0, Number(e.target.value)),
                      daily_count: (key === 'hard_count' ? Number(e.target.value) : s.hard_count)
                                 + (key === 'medium_count' ? Number(e.target.value) : s.medium_count)
                                 + (key === 'easy_count' ? Number(e.target.value) : s.easy_count),
                    }))}
                    style={{
                      width: '72px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      color: 'var(--text-primary)',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                </label>
              ))}
              <div style={{ alignSelf: 'flex-end', paddingBottom: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
                = {settings.hard_count + settings.medium_count + settings.easy_count} total
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Platform Sources ─────────────────────────────────────── */}
      <section style={sectionStyle} className="fade-in">
        <SectionHeader
          title="Problem Sources"
          subtitle="Choose which problem sets are included in your daily queue."
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {([['leetcode', '🟡 LeetCode', 'Free, curated LC problems mapped to OLT topics'],
             ['cses',     '🟢 CSES',     'Priority A+B problems from CSES Problem Set (161 problems)']] as const).map(
            ([src, label, desc]) => {
              const enabled = (settings.enabled_sources ?? ['leetcode']).includes(src);
              return (
                <label
                  key={src}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '12px',
                    padding: '12px 14px', borderRadius: '10px', cursor: 'pointer',
                    background: enabled ? 'var(--bg-elevated)' : 'transparent',
                    border: `1px solid ${enabled ? 'var(--border)' : 'transparent'}`,
                    transition: 'all 0.12s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => {
                      const current = settings.enabled_sources ?? ['leetcode'];
                      const next = enabled
                        ? current.filter(s => s !== src)
                        : [...current, src];
                      // Always keep at least one source
                      if (next.length === 0) return;
                      setSettings(s => ({ ...s, enabled_sources: next as ('leetcode' | 'cses')[] }));
                    }}
                    style={{ width: '15px', height: '15px', marginTop: '2px', cursor: 'pointer', accentColor: 'var(--accent-blue)' }}
                  />
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: enabled ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{desc}</div>
                  </div>
                </label>
              );
            }
          )}
        </div>
      </section>

      {/* ── Sub-type Cooldown ─────────────────────────────────────── */}
      <section style={sectionStyle} className="fade-in">
        <SectionHeader
          title="Sub-type Cooldown"
          subtitle="How many days before a recently-solved sub-type reappears at full priority. Lower = more repetition, higher = more variety."
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <input
            type="range"
            min={1}
            max={21}
            step={1}
            value={settings.cooldown_days ?? 7}
            onChange={e => setSettings(s => ({ ...s, cooldown_days: Number(e.target.value) }))}
            style={{ flex: 1, minWidth: '160px', accentColor: 'var(--accent-blue)' }}
          />
          <span style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: '8px', padding: '6px 14px',
            fontSize: '14px', fontWeight: 700, color: 'var(--accent-blue)',
            minWidth: '80px', textAlign: 'center',
          }}>
            {settings.cooldown_days ?? 7} days
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>1 — more repetition</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>21 — more variety</span>
        </div>
      </section>

      {/* ── Topic Focus ──────────────────────────────────────────── */}
      <section style={sectionStyle} className="fade-in">
        <SectionHeader
          title="Topic Focus"
          subtitle="Only the selected topics will be included in your daily queue. Deselect topics you want to skip or have already mastered."
        />

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            onClick={selectAllTopics}
            style={{
              background: 'none', border: '1px solid var(--border)',
              borderRadius: '6px', padding: '5px 12px',
              color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer',
            }}
          >
            Select All
          </button>
          <button
            onClick={clearAllTopics}
            style={{
              background: 'none', border: '1px solid var(--border)',
              borderRadius: '6px', padding: '5px 12px',
              color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer',
            }}
          >
            Clear All
          </button>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center', marginLeft: '4px' }}>
            {allEnabled ? OLT_TOPICS.length : enabledSet.size} / {OLT_TOPICS.length} selected
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {OLT_TOPICS.map(topic => {
            const on = allEnabled || enabledSet.has(topic.slug);
            return (
              <label
                key={topic.slug}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                  background: on ? 'var(--bg-elevated)' : 'transparent',
                  border: `1px solid ${on ? 'var(--border)' : 'transparent'}`,
                }}
                onMouseEnter={e => { if (!on) (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)22'; }}
                onMouseLeave={e => { if (!on) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleTopic(topic.slug)}
                  style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--accent-blue)' }}
                />
                <span style={{ fontSize: '14px', color: on ? 'var(--text-primary)' : 'var(--text-muted)', flex: 1 }}>
                  {topic.name}
                </span>
                <span style={{
                  fontSize: '11px', color: 'var(--text-muted)',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: '4px', padding: '2px 7px',
                }}>
                  score {topic.score}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {/* ── Save buttons ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button
          onClick={handleSave}
          disabled={saving || regen}
          style={{
            background: 'var(--accent-blue)',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 24px',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {saving ? '…' : saved ? '✅ Saved!' : 'Save Settings'}
        </button>

        <button
          onClick={handleSaveAndRegen}
          disabled={saving || regen}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '10px 24px',
            color: 'var(--text-secondary)',
            fontSize: '14px',
            fontWeight: 500,
            cursor: regen ? 'not-allowed' : 'pointer',
            opacity: regen ? 0.6 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {regen ? '…' : '↺ Save & Regenerate Today\'s Queue'}
        </button>
      </div>
    </div>
  );
}
