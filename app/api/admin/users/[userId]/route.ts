import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

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

// PATCH /api/admin/users/[userId] — grant/revoke/promote/add notes
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { userId } = await params;
  const body = await req.json();

  // Build update payload — only include fields present in body
  const update: Record<string, unknown> = {};
  if ('granted'     in body) update.granted     = Boolean(body.granted);
  if ('is_admin'    in body) update.is_admin    = Boolean(body.is_admin);
  if ('admin_notes' in body) update.admin_notes = String(body.admin_notes);

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  const { error } = await adminSupabase
    .from('user_access')
    .update(update)
    .eq('user_id', userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/users/[userId] — remove pending user row
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { userId } = await params;

  // Safety: never delete a granted user — only pending (granted=false)
  const { data: row } = await adminSupabase
    .from('user_access')
    .select('granted, is_admin')
    .eq('user_id', userId)
    .single();

  if (row?.granted || row?.is_admin)
    return NextResponse.json({ error: 'Cannot delete a granted or admin user' }, { status: 400 });

  const { error } = await adminSupabase
    .from('user_access')
    .delete()
    .eq('user_id', userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
