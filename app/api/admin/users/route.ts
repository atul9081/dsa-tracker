import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// Service-role client — bypasses RLS for cross-user reads
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

// GET /api/admin/users — list all users with access status
export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Fetch user_access rows
  const { data: accessRows, error } = await adminSupabase
    .from('user_access')
    .select('user_id, email, display_name, granted, is_admin, requested_at, admin_notes')
    .order('requested_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with last_sign_in + identity info from auth.users (service role admin API)
  const { data: authUsers } = await adminSupabase.auth.admin.listUsers();
  const lastSignInMap: Record<string, string | null> = {};
  const authEmailMap:  Record<string, string | null> = {};
  const authNameMap:   Record<string, string | null> = {};
  const userAccessIds = new Set((accessRows ?? []).map(r => r.user_id));

  if (authUsers) {
    for (const u of authUsers.users) {
      lastSignInMap[u.id] = u.last_sign_in_at ?? null;
      authEmailMap[u.id]  = u.email ?? null;
      // Prefer OAuth full_name/name — do NOT fall back to email for display_name
      authNameMap[u.id]   =
        (u.user_metadata?.full_name as string | undefined) ||
        (u.user_metadata?.name     as string | undefined) ||
        null;
    }
  }

  const users = (accessRows ?? []).map(row => ({
    ...row,
    email:        row.email        ?? authEmailMap[row.user_id] ?? null,
    // Only use a real name from metadata — never email — so the UI can show '—'
    // when the user has no name rather than duplicating the email address.
    display_name: row.display_name ?? authNameMap[row.user_id] ?? null,
    last_sign_in: lastSignInMap[row.user_id] ?? null,
  }));

  // Removed users: in auth.users but no user_access row (deleted by admin or trigger failure).
  // Surfaced so admins can re-grant without needing to know the email from memory.
  const removedUsers = (authUsers?.users ?? [])
    .filter(u => !userAccessIds.has(u.id))
    .map(u => ({
      user_id:      u.id,
      email:        u.email        ?? null,
      display_name: authNameMap[u.id] ?? null,
      granted:      null,
      is_admin:     false,
      requested_at: u.created_at   ?? null,
      admin_notes:  null,
      last_sign_in: lastSignInMap[u.id] ?? null,
    }));

  return NextResponse.json({ users, removedUsers });
}

// POST /api/admin/users — pre-approve an email before signup
export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { email } = body;
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  // Check if a user with this email already exists
  const { data: authList } = await adminSupabase.auth.admin.listUsers();
  const existingUser = authList?.users.find(u => u.email === email);

  if (existingUser) {
    // User already signed up — just grant access
    const { error } = await adminSupabase
      .from('user_access')
      .upsert({ user_id: existingUser.id, email, granted: true }, { onConflict: 'user_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ status: 'granted_existing' });
  }

  // No account yet — we can't pre-create a user_access row without a user_id.
  // Return a message telling admin the user needs to sign up first.
  return NextResponse.json({ status: 'not_signed_up', message: 'User has not signed up yet. Once they sign up, approve from the pending list.' });
}
