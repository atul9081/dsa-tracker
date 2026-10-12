import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Routes that bypass auth + whitelist checks entirely
const PUBLIC_PATHS = ['/login', '/auth/callback', '/waiting'];

// ── system_settings ───────────────────────────────────────────────────────────
// Safe fallback: if the DB read fails for any reason, default to the MOST
// RESTRICTIVE values (approval required ON, site enabled ON). The app never
// accidentally opens up due to a transient DB error.
const SETTINGS_FALLBACK = { approval_required: true, site_enabled: true };

async function getSystemSettings() {
  try {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    const { data, error } = await client
      .from('system_settings')
      .select('approval_required, site_enabled')
      .eq('id', 1)
      .single();
    if (error || !data) return SETTINGS_FALLBACK;
    return data as { approval_required: boolean; site_enabled: boolean };
  } catch {
    return SETTINGS_FALLBACK;
  }
}

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

  // Read global toggles (service-role, single-row PK lookup).
  // Falls back to { approval_required: true, site_enabled: true } on any error.
  const settings = await getSystemSettings();

  // 1. Not logged in → /login (or /waiting?reason=maintenance if site is down)
  if (!user && !isPublic) {
    const dest = request.nextUrl.clone();
    if (!settings.site_enabled) {
      dest.pathname = '/waiting';
      dest.searchParams.set('reason', 'maintenance');
    } else {
      dest.pathname = '/login';
    }
    return NextResponse.redirect(dest);
  }

  // 2. Kill switch: site disabled → non-admins see maintenance page.
  //    Admins are checked here so they can still access the admin panel to re-enable.
  if (user && !isPublic && !settings.site_enabled) {
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
      const dest = request.nextUrl.clone();
      dest.pathname = '/waiting';
      dest.searchParams.set('reason', 'maintenance');
      return NextResponse.redirect(dest);
    }
    // Admin: fall through to normal flow
  }

  // 3. Logged in but not whitelisted → /waiting
  // Skip check for public paths and API routes (API routes handle their own auth).
  // When approval_required=false: bypass the granted check entirely — any
  // authenticated user can access the app. Individual granted/revoked records
  // are not changed; turning approval back ON restores the old behaviour.
  if (user && !isPublic && !pathname.startsWith('/api/')) {
    if (settings.approval_required) {
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

      // 4. /admin route — requires is_admin = true
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
    } else {
      // approval_required=false — still enforce /admin guard
      if (pathname.startsWith('/admin')) {
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

