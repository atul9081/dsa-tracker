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
      .select('granted')
      .eq('user_id', user.id)
      .single();

    // If the table doesn't exist yet (before migration), or user has access → pass through
    // If row exists and granted=false → redirect to waiting
    if (access !== null && access.granted === false) {
      const waitingUrl = request.nextUrl.clone();
      waitingUrl.pathname = '/waiting';
      return NextResponse.redirect(waitingUrl);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
