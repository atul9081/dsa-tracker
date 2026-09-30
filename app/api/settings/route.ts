import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import type { UserSettings } from '@/types';

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
  enabled_sub_type_slugs: null,
};

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // If no row yet (or table doesn't exist yet), return defaults
    if (error || !data) {
      return NextResponse.json({ settings: DEFAULT_SETTINGS });
    }

    const settings: UserSettings = {
      daily_count: data.daily_count ?? DEFAULT_SETTINGS.daily_count,
      hard_count: data.hard_count ?? DEFAULT_SETTINGS.hard_count,
      medium_count: data.medium_count ?? DEFAULT_SETTINGS.medium_count,
      easy_count: data.easy_count ?? DEFAULT_SETTINGS.easy_count,
      difficulty_mode: data.difficulty_mode ?? DEFAULT_SETTINGS.difficulty_mode,
      enabled_topic_slugs: data.enabled_topic_slugs ?? null,
      topic_weight_overrides: data.topic_weight_overrides ?? {},
      enabled_sources: data.enabled_sources ?? DEFAULT_SETTINGS.enabled_sources,
      cooldown_days: data.cooldown_days ?? DEFAULT_SETTINGS.cooldown_days,
      cses_ratio: data.cses_ratio ?? null,
      enabled_sub_type_slugs: data.enabled_sub_type_slugs ?? null,
    };

    return NextResponse.json({ settings });
  } catch (err) {
    console.error('[GET /api/settings]', err);
    // Graceful fallback if table doesn't exist yet
    return NextResponse.json({ settings: DEFAULT_SETTINGS });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();

    // Validate and sanitize
    const settings: Partial<UserSettings> = {};
    if (body.daily_count !== undefined)            settings.daily_count = Math.max(1, Math.min(20, Number(body.daily_count)));
    if (body.hard_count !== undefined)             settings.hard_count = Math.max(0, Number(body.hard_count));
    if (body.medium_count !== undefined)           settings.medium_count = Math.max(0, Number(body.medium_count));
    if (body.easy_count !== undefined)             settings.easy_count = Math.max(0, Number(body.easy_count));
    if (body.difficulty_mode !== undefined)        settings.difficulty_mode = body.difficulty_mode;
    if ('enabled_topic_slugs' in body)             settings.enabled_topic_slugs = body.enabled_topic_slugs;
    if (body.topic_weight_overrides !== undefined) settings.topic_weight_overrides = body.topic_weight_overrides;
    if (body.enabled_sources !== undefined)        settings.enabled_sources = body.enabled_sources;
    if (body.cooldown_days !== undefined)          settings.cooldown_days = Math.max(1, Math.min(21, Number(body.cooldown_days)));
    if ('cses_ratio' in body)                      settings.cses_ratio = body.cses_ratio === null ? null : Math.min(1, Math.max(0, Number(body.cses_ratio)));
    if ('enabled_sub_type_slugs' in body)          settings.enabled_sub_type_slugs = body.enabled_sub_type_slugs;

    const { error } = await supabase
      .from('user_settings')
      .upsert(
        { user_id: user.id, ...settings, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/settings]', err);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
