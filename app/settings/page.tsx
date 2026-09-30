'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OLT_TOPICS, SUB_TYPES_BY_TOPIC, prettifySubtype } from '@/config/topics';
import type { UserSettings } from '@/types';

type DiffMode = 'chill' | 'standard' | 'grind' | 'custom';

const DAILY_COUNT_OPTIONS = [3, 5, 7];

// Explicit preset table (mirrors PRESET_DISTRIBUTIONS in api/queue/route.ts)
const PRESET_TABLE: Record<
  Exclude<DiffMode, 'custom'>,
  Record<number, { hard_count: number; medium_count: number; easy_count: number }>
> = {
  chill:    { 3: { hard_count: 0, medium_count: 2, easy_count: 1 }, 5: { hard_count: 0, medium_count: 2, easy_count: 3 }, 7: { hard_count: 0, medium_count: 4, easy_count: 3 } },
  standard: { 3: { hard_count: 1, medium_count: 2, easy_count: 0 }, 5: { hard_count: 1, medium_count: 3, easy_count: 1 }, 7: { hard_count: 2, medium_count: 3, easy_count: 2 } },
  grind:    { 3: { hard_count: 2, medium_count: 1, easy_count: 0 }, 5: { hard_count: 2, medium_count: 3, easy_count: 0 }, 7: { hard_count: 3, medium_count: 4, easy_count: 0 } },
};

const DIFF_MODES: Array<{ key: DiffMode; label: string }> = [
  { key: 'chill',    label: '😌 Chill'    },
  { key: 'standard', label: '⚡ Standard' },
  { key: 'grind',    label: '🔥 Grind'    },
  { key: 'custom',   label: '⚙️ Custom'   },
];

function modeDesc(mode: Exclude<DiffMode, 'custom'>, count: number): string {
  const counts = [3, 5, 7];
  const nearest = counts.reduce((p, c) =>
    Math.abs(c - count) < Math.abs(p - count) ? c : p
  );
  const d = PRESET_TABLE[mode][nearest];
  const parts: string[] = [];
  if (d.hard_count   > 0) parts.push(`${d.hard_count}H`);
  if (d.medium_count > 0) parts.push(`${d.medium_count}M`);
  if (d.easy_count   > 0) parts.push(`${d.easy_count}E`);
  return parts.join(' · ');
}

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
  cses_ratio: null,
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

  // Track the last-saved sub-type state so the reset button reverts to it
  // (not to null/all-enabled, but to whatever was saved in the DB)
  const savedSubTypes = useRef<Record<string, string[]> | null>(null);

  // Derive enabled slugs state: null = all enabled, array = specific set
  // We treat null as "all checkboxes on"
  const allEnabled = settings.enabled_topic_slugs === null;
  const enabledSet = new Set(settings.enabled_topic_slugs ?? OLT_TOPICS.map(t => t.slug));

  // Sub-type expand/collapse state
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());

  const toggleTopicExpand = (slug: string) => {
    setExpandedTopics(prev => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  };

  // Sub-type helpers
  const enabledSubTypes: Record<string, string[]> | null = settings.enabled_sub_type_slugs ?? null;

  /** Returns the enabled sub-type set for a topic, or all sub-types if no filter active */
  const getEnabledSubTypesForTopic = (topicSlug: string): string[] => {
    if (!enabledSubTypes || !(topicSlug in enabledSubTypes)) {
      return SUB_TYPES_BY_TOPIC[topicSlug] ?? [];
    }
    return enabledSubTypes[topicSlug];
  };

  const toggleSubType = (topicSlug: string, subtype: string) => {
    const all = SUB_TYPES_BY_TOPIC[topicSlug] ?? [];
    const current = getEnabledSubTypesForTopic(topicSlug);
    const next = current.includes(subtype)
      ? current.filter(s => s !== subtype)
      : [...current, subtype];

    setSettings(s => {
      const record = { ...(s.enabled_sub_type_slugs ?? {}) };
      // If all sub-types selected → remove the key (null/absent = all enabled)
      if (next.length === all.length) delete record[topicSlug];
      else record[topicSlug] = next;
      return { ...s, enabled_sub_type_slugs: Object.keys(record).length === 0 ? null : record };
    });
  };

  const selectAllSubTypes = (topicSlug: string) => {
    setSettings(s => {
      const record = { ...(s.enabled_sub_type_slugs ?? {}) };
      delete record[topicSlug]; // remove key = all enabled
      return { ...s, enabled_sub_type_slugs: Object.keys(record).length === 0 ? null : record };
    });
  };

  const clearAllSubTypes = (topicSlug: string) => {
    setSettings(s => ({
      ...s,
      enabled_sub_type_slugs: { ...(s.enabled_sub_type_slugs ?? {}), [topicSlug]: [] },
    }));
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (data.settings) {
          setSettings(data.settings);
          // Capture the DB state as the reset target
          savedSubTypes.current = data.settings.enabled_sub_type_slugs ?? null;
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setMode = (mode: DiffMode) => {
    if (mode !== 'custom') {
      const count = settings.daily_count ?? 5;
      // Pick nearest defined count in preset table
      const nearest = [3, 5, 7].reduce((p, c) =>
        Math.abs(c - count) < Math.abs(p - count) ? c : p
      ) as 3 | 5 | 7;
      const preset = PRESET_TABLE[mode][nearest];
      setSettings(s => ({ ...s, difficulty_mode: mode, ...preset, daily_count: nearest }));
    } else {
      setSettings(s => ({ ...s, difficulty_mode: 'custom' }));
    }
  };

  // #10: When daily_count changes in custom mode, auto-fill standard distribution for that count
  const setDailyCount = (count: number) => {
    if (settings.difficulty_mode === 'custom') {
      const nearest = [3, 5, 7].reduce((p, c) =>
        Math.abs(c - count) < Math.abs(p - count) ? c : p
      ) as 3 | 5 | 7;
      const preset = PRESET_TABLE['standard'][nearest];
      setSettings(s => ({ ...s, daily_count: count, ...preset }));
    } else {
      setSettings(s => ({ ...s, daily_count: count }));
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
    if (ok) {
      // Update the reset target to the just-saved state
      savedSubTypes.current = settings.enabled_sub_type_slugs ?? null;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleSaveAndRegen = async () => {
    setRegen(true);
    const ok = await save();
    if (ok) {
      savedSubTypes.current = settings.enabled_sub_type_slugs ?? null;
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
                onClick={() => setDailyCount(n)}
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
                  {m.key === 'custom' ? 'Set your own' : modeDesc(m.key, settings.daily_count ?? 5)}
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

        {/* CSES mix ratio slider — only when both sources enabled */}
        {(() => {
          const sources = settings.enabled_sources ?? ['leetcode'];
          const bothEnabled = sources.includes('leetcode') && sources.includes('cses');
          if (!bothEnabled) return null;
          const ratio = settings.cses_ratio ?? null;
          const pct = ratio != null ? Math.round(ratio * 100) : null;
          return (
            <div style={{
              marginTop: '14px', padding: '14px 16px',
              background: 'var(--bg-elevated)', borderRadius: '10px',
              border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>CSES mix</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {pct != null ? `${pct}% of queue from CSES` : 'Auto — proportional to pool sizes (~10%)'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    fontSize: '13px', fontWeight: 700,
                    color: pct != null ? 'var(--accent-blue)' : 'var(--text-muted)',
                    minWidth: '38px', textAlign: 'right',
                  }}>
                    {pct != null ? `${pct}%` : 'Auto'}
                  </span>
                  {pct != null && (
                    <button
                      onClick={() => setSettings(s => ({ ...s, cses_ratio: null }))}
                      title="Reset to auto"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text-muted)', fontSize: '12px', padding: '2px 6px',
                        borderRadius: '4px',
                      }}
                    >↺ Auto</button>
                  )}
                </div>
              </div>
              <input
                type="range"
                min={0} max={100} step={10}
                value={pct ?? 10}
                onChange={e => setSettings(s => ({ ...s, cses_ratio: Number(e.target.value) / 100 }))}
                style={{ width: '100%', accentColor: 'var(--accent-blue)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                <span>0% CSES</span><span>50%</span><span>100% CSES</span>
              </div>
            </div>
          );
        })()}
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

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
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
          {/* Reset sub-type filters — only visible when current state differs from saved state */}
          {(() => {
            const currentStr = JSON.stringify(enabledSubTypes ?? null);
            const savedStr   = JSON.stringify(savedSubTypes.current ?? null);
            const isDirty    = currentStr !== savedStr;
            return isDirty ? (
              <>
                <span style={{ color: 'var(--border)', fontSize: '12px' }}>|</span>
                <button
                  onClick={() => setSettings(s => ({ ...s, enabled_sub_type_slugs: savedSubTypes.current }))}
                  title="Undo sub-type changes — revert to last saved state"
                  style={{
                    background: 'none', border: '1px solid var(--diff-hard)55',
                    borderRadius: '6px', padding: '5px 12px',
                    color: 'var(--diff-hard)', fontSize: '12px', cursor: 'pointer',
                  }}
                >
                  ↺ Reset sub-type filters
                </button>
              </>
            ) : null;
          })()}
        </div>


        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {OLT_TOPICS.map(topic => {
            const on = allEnabled || enabledSet.has(topic.slug);
            const subtypes = SUB_TYPES_BY_TOPIC[topic.slug] ?? [];
            const enabledSubs = getEnabledSubTypesForTopic(topic.slug);
            const allSubsEnabled = !enabledSubTypes || !(topic.slug in (enabledSubTypes ?? {}));
            const expanded = expandedTopics.has(topic.slug);
            const badgeText = allSubsEnabled
              ? 'All sub-types'
              : `${enabledSubs.length} / ${subtypes.length} sub-types`;
            const hasNoSubsSelected = !allSubsEnabled && enabledSubs.length === 0;

            return (
              <div key={topic.slug}>
                {/* Topic row */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '9px 12px',
                    borderRadius: expanded ? '8px 8px 0 0' : '8px',
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                    background: on ? 'var(--bg-elevated)' : 'transparent',
                    border: `1px solid ${on ? 'var(--border)' : 'transparent'}`,
                    borderBottom: expanded && on ? '1px solid var(--border)33' : undefined,
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
                  {/* Sub-type expand toggle — only show for enabled topics with sub-types */}
                  {on && subtypes.length > 0 && (
                    <button
                      onClick={e => { e.preventDefault(); toggleTopicExpand(topic.slug); }}
                      title={expanded ? 'Hide sub-types' : 'Configure sub-types'}
                      style={{
                        background: hasNoSubsSelected ? 'var(--diff-hard)22' : (allSubsEnabled ? 'transparent' : 'var(--accent-blue)15'),
                        border: `1px solid ${hasNoSubsSelected ? 'var(--diff-hard)55' : (allSubsEnabled ? 'var(--border)' : 'var(--accent-blue)44')}`,
                        borderRadius: '6px',
                        padding: '2px 8px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: allSubsEnabled ? 400 : 600,
                        color: hasNoSubsSelected ? 'var(--diff-hard)' : (allSubsEnabled ? 'var(--text-muted)' : 'var(--accent-blue)'),
                        display: 'flex', alignItems: 'center', gap: '4px',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {badgeText} {expanded ? '▲' : '▼'}
                    </button>
                  )}
                </label>

                {/* Sub-type panel */}
                {on && expanded && subtypes.length > 0 && (
                  <div
                    className="fade-in"
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderTop: 'none',
                      borderRadius: '0 0 8px 8px',
                      padding: '12px 14px',
                      marginBottom: '2px',
                    }}
                  >
                    {/* Mini actions */}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center' }}>
                      <button
                        onClick={() => selectAllSubTypes(topic.slug)}
                        style={{
                          background: 'none', border: '1px solid var(--border)',
                          borderRadius: '5px', padding: '3px 10px',
                          color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer',
                        }}
                      >Select all</button>
                      <button
                        onClick={() => clearAllSubTypes(topic.slug)}
                        style={{
                          background: 'none', border: '1px solid var(--border)',
                          borderRadius: '5px', padding: '3px 10px',
                          color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer',
                        }}
                      >Clear all</button>
                      {hasNoSubsSelected && (
                        <span style={{ fontSize: '11px', color: 'var(--diff-hard)', marginLeft: '4px' }}>
                          ⚠ No sub-types selected — this topic won&apos;t appear in your queue
                        </span>
                      )}
                    </div>
                    {/* Sub-type checkboxes */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {subtypes.map(sub => {
                        const checked = enabledSubs.includes(sub);
                        return (
                          <label
                            key={sub}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '5px',
                              padding: '4px 10px',
                              background: checked ? 'var(--accent-blue)15' : 'var(--bg-elevated)',
                              border: `1px solid ${checked ? 'var(--accent-blue)44' : 'var(--border)'}`,
                              borderRadius: '6px', cursor: 'pointer',
                              fontSize: '12px',
                              color: checked ? 'var(--accent-blue)' : 'var(--text-secondary)',
                              fontWeight: checked ? 600 : 400,
                              transition: 'all 0.12s',
                              userSelect: 'none',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSubType(topic.slug, sub)}
                              style={{ width: '12px', height: '12px', accentColor: 'var(--accent-blue)', cursor: 'pointer' }}
                            />
                            {prettifySubtype(sub)}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
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
          {regen
            ? <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />Regenerating…</span>
            : '↺ Save & Regenerate Today\'s Queue'
          }
        </button>
      </div>
    </div>
  );
}
