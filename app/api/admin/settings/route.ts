import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// Service-role client — bypasses RLS for system_settings reads/writes
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function getAdminUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: access } = await adminSupabase
    .from('user_access')
    .select('is_admin')
    .eq('user_id', user.id)
    .single();

  return access?.is_admin ? user : null;
}

const SAFE_DEFAULTS = { approval_required: true, site_enabled: true };

// GET /api/admin/settings — returns current system_settings
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await adminSupabase
    .from('system_settings')
    .select('approval_required, site_enabled, updated_at')
    .eq('id', 1)
    .single();

  if (error) {
    // Table missing or row missing — return safe defaults
    console.warn('[GET /api/admin/settings] DB error:', error.message);
    return NextResponse.json({ settings: SAFE_DEFAULTS });
  }

  return NextResponse.json({ settings: data });
}

// PATCH /api/admin/settings — update one or both toggles
export async function PATCH(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));

  // Only accept recognised boolean fields
  const update: Record<string, unknown> = {};
  if ('approval_required' in body) update.approval_required = Boolean(body.approval_required);
  if ('site_enabled'      in body) update.site_enabled      = Boolean(body.site_enabled);
  update.updated_at = new Date().toISOString();

  if (Object.keys(update).length === 1) { // only updated_at = nothing to update
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await adminSupabase
    .from('system_settings')
    .update(update)
    .eq('id', 1)
    .select('approval_required, site_enabled, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ settings: data });
}
