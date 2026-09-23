import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const cookieStore = await cookies();

    // Must manually wire cookies so Set-Cookie headers survive the redirect.
    // NextResponse.redirect() creates a fresh response — if we use the helper
    // createClient() and then redirect(), the session cookies set by
    // exchangeCodeForSession are lost. We build the redirect first and write
    // cookies directly onto it.
    const redirectResponse = NextResponse.redirect(`${origin}${next}`);

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            // Write onto both the store and the redirect response so the
            // browser receives the auth cookies with the 302.
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
              redirectResponse.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Safety net: ensure user_access row exists (trigger may not have fired
      // yet). ignoreDuplicates preserves granted=true for whitelisted users.
      await supabase
        .from('user_access')
        .upsert(
          { user_id: data.user.id, granted: false },
          { onConflict: 'user_id', ignoreDuplicates: true }
        );

      return redirectResponse;
    }
  }

  // On failure, redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
