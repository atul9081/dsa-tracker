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

  // ── /waiting smart redirect for logged-in users ───────────────────────────
  // /waiting is PUBLIC so unauthenticated visitors always reach it.
  // But a logged-in user hitting /waiting is re-evaluated on every request so
  // they are never stuck here after an admin changes settings.
  if (pathname.startsWith('/waiting') && user) {
    const svcClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    const { data: access } = await svcClient
      .from('user_access')
      .select('granted, is_admin')
      .eq('user_id', user.id)
      .single();

    const isAdmin  = access?.is_admin === true;
    const isGranted = access?.granted  === true || isAdmin;
    // Revoked = row exists with granted=false. Orphaned = no row (access is null).
    // Revoked users stay blocked even when approval_required=OFF (D3).
    const isExplicitlyRevoked = access !== null && access?.granted === false && !isAdmin;

    if (!settings.site_enabled) {
      // Kill switch ON
      if (isAdmin) {
        // Admins bypass — send to the app
        const dest = request.nextUrl.clone();
        dest.pathname = '/';
        dest.search = '';
        return NextResponse.redirect(dest);
      }
      // Non-admin: ensure URL has ?reason=maintenance so page shows correct copy
      if (request.nextUrl.searchParams.get('reason') !== 'maintenance') {
        const dest = request.nextUrl.clone();
        dest.searchParams.set('reason', 'maintenance');
        return NextResponse.redirect(dest);
      }
      return supabaseResponse; // URL already correct — render the page
    }

    // Site is enabled
    // Let through: granted/admin, OR approval off AND not explicitly revoked
    if (isGranted || (!settings.approval_required && !isExplicitlyRevoked)) {
      // Approval off OR user is granted/admin → send to the app
      const dest = request.nextUrl.clone();
      dest.pathname = '/';
      dest.search = '';
      return NextResponse.redirect(dest);
    }

    // Approval required AND not granted → correctly pending.
    // Fix stale ?reason=maintenance if site just came back up.
    if (request.nextUrl.searchParams.get('reason') === 'maintenance') {
      const dest = request.nextUrl.clone();
      dest.searchParams.delete('reason');
      return NextResponse.redirect(dest);
    }

    return supabaseResponse; // correctly pending — render the page
  }

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
        waitingUrl.search = ''; // clear any stale ?reason= param
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
      // approval_required=false:
      //   - Orphaned (no row) → allowed through (never reviewed)
      //   - Pending (granted=false, first time) → also no explicit revocation → allowed
      //   - Revoked (granted=false, row exists) → BLOCKED (explicit admin decision preserved)
      //   - /admin route → always guarded regardless of toggle
      const { data: access } = await supabase
        .from('user_access')
        .select('granted, is_admin')
        .eq('user_id', user.id)
        .single();

      if (access !== null && access.granted === false && !access.is_admin) {
        // Explicitly revoked — block even though approval toggle is off
        const waitingUrl = request.nextUrl.clone();
        waitingUrl.pathname = '/waiting';
        waitingUrl.search = '';
        return NextResponse.redirect(waitingUrl);
      }

      // /admin guard
      if (pathname.startsWith('/admin')) {
        if (!access?.is_admin) {
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
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

