import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      // Safety net: ensure user_access row exists (trigger may not have fired yet
      // or may be delayed). ON CONFLICT DO NOTHING preserves granted=true for
      // existing whitelisted users.
      await supabase
        .from('user_access')
        .upsert(
          { user_id: data.user.id, granted: false },
          { onConflict: 'user_id', ignoreDuplicates: true }
        );

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // On failure, redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
