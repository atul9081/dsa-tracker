import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Routes that bypass auth + whitelist checks entirely
const PUBLIC_PATHS = ['/login', '/auth/callback', '/waiting'];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session if expired
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p));

  // 1. Not logged in → /login
  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  // 2. Logged in but not whitelisted → /waiting
  // Skip check for public paths and API routes (API routes handle their own auth)
  if (user && !isPublic && !pathname.startsWith('/api/')) {
    const { data: access } = await supabase
      .from('user_access')
      .select('granted, is_admin')
      .eq('user_id', user.id)
      .single();

    // No row = brand-new user (trigger may not have committed yet) → treat as not granted.
    // Row with granted=false → not yet approved.
    // Only pass through if row exists AND granted=true (or is_admin=true).
    const isGranted = access?.granted === true || access?.is_admin === true;
    if (!isGranted) {
      const waitingUrl = request.nextUrl.clone();
      waitingUrl.pathname = '/waiting';
      return NextResponse.redirect(waitingUrl);
    }

    // 3. /admin route — requires is_admin = true
    if (pathname.startsWith('/admin')) {
      if (!access?.is_admin) {
        // Check via service role for accuracy (in case anon client cache is stale)
        const adminClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } }
        );
        const { data: adminAccess } = await adminClient
          .from('user_access')
          .select('is_admin')
          .eq('user_id', user.id)
          .single();

        if (!adminAccess?.is_admin) {
          const homeUrl = request.nextUrl.clone();
          homeUrl.pathname = '/';
          return NextResponse.redirect(homeUrl);
        }
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

