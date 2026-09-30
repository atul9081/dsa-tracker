# Admin Panel — Design Plan

**Status:** Decisions locked. Ready for implementation.

## Background

DSA Tracker is currently invite-only with a manual whitelist (`user_access` table).
Granting access requires a direct Supabase SQL update.

This plan adds:
1. **`/admin`** — real-time access management + analytics dashboard (you only)
2. **`/`** — public landing page (before login), shows what the site is + waitlist form
3. Routing change: daily queue moves `/` → `/home`

---

## Decisions Log

| # | Question | Decision |
|---|---|---|
| Q1 | Multiple admins? | `is_admin BOOLEAN` column on `user_access` — DB-driven, not hardcoded |
| Q2 | User add flow | Option C — pre-approve by email AND approve pending sign-ups |
| Q3 | Landing page route | `/` = public landing page; daily queue moves to `/home` |
| Q4 | Analytics scope | Medium — solved count, queues generated, topics distribution, last active |
| Q5 | Email notification | No — admin panel is enough |
| Q6 | Revoke behaviour | Kicked on next page load (middleware re-checks on every request) |

---

## Current DB State

```sql
-- Exists from Phase 4
CREATE TABLE user_access (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## DB Migration

> ⚠️ Additive only — no existing columns or rows modified.

```sql
-- 1. Extend user_access with admin flag + display metadata
ALTER TABLE user_access
  ADD COLUMN IF NOT EXISTS is_admin      BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email         TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS display_name  TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS requested_at  TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS admin_notes   TEXT        DEFAULT NULL;

-- 2. Mark yourself as admin (run once)
UPDATE user_access
  SET is_admin = true, email = 'vedant.dev.jsr@gmail.com'
  WHERE user_id = '132f68cd-86c4-4995-8235-8ab3013940a4';

-- 3. Populate emails for all existing rows from auth.users (service role, run once)
-- UPDATE user_access ua
--   SET email = u.email, display_name = u.raw_user_meta_data->>'full_name'
--   FROM auth.users u
--   WHERE ua.user_id = u.id AND ua.email IS NULL;

-- 4. Extend the new-user trigger to capture email + name on signup
-- (update handle_new_user_access function — see Phase 1)
```

**Verify after migration:**
```sql
SELECT user_id, email, is_admin, granted FROM user_access;
```

---

## Security Model

Admin check uses the DB `is_admin` field, dual-layered:

**Layer 1 — Middleware** (server-side, blocks page render):
```typescript
// middleware.ts
if (pathname.startsWith('/admin')) {
  const userId = session?.user?.id;
  if (!userId) return NextResponse.redirect(new URL('/login', req.url));

  // Check is_admin from user_access via service role
  const { data } = await adminSupabase
    .from('user_access')
    .select('is_admin')
    .eq('user_id', userId)
    .single();

  if (!data?.is_admin) return NextResponse.redirect(new URL('/', req.url));
}
```

**Layer 2 — API routes** (`/api/admin/*`):
- All routes re-check `is_admin` from DB using service role before any operation
- Service role key already in env (`SUPABASE_SERVICE_ROLE_KEY`)

---

## Routing Changes

| Before | After | Notes |
|---|---|---|
| `/` | → `/home` | Daily queue (authenticated) |
| `/` | Landing page | Public, no auth required |
| (new) | `/admin` | Admin dashboard (is_admin = true only) |
| `/login` | `/login` | Unchanged |

**Files to update for routing:**
- `app/page.tsx` → move to `app/home/page.tsx`
- `middleware.ts` → update redirect targets (`/` → `/home` for authenticated users)
- `components/Navbar.tsx` → update Home link to `/home`
- All internal `router.push('/')` calls → `router.push('/home')`

---

## Implementation Phases

### Phase 1 — DB Migration + Trigger Update (~15 min)

Run migration SQL above. Then update the Supabase trigger `handle_new_user_access` to
capture email and display_name on new user signup:

```sql
CREATE OR REPLACE FUNCTION handle_new_user_access()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_access (user_id, granted, email, display_name)
  VALUES (
    NEW.id,
    false,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NULL)
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Phase 2 — Routing Refactor (~20 min)

1. Move `app/page.tsx` → `app/home/page.tsx`
2. Update `middleware.ts`:
   - Authenticated users with access → `/home` (not `/`)
   - `/` → public, no redirect
3. Update all internal navigation (`router.push('/')` → `router.push('/home')`)
4. Update Navbar Home link

### Phase 3 — Admin API (~25 min)

**`app/api/admin/users/route.ts`** — GET list + POST pre-approve:
```typescript
// GET → [{ user_id, email, display_name, granted, is_admin, requested_at, admin_notes, last_sign_in }]
// POST { email } → pre-approve: INSERT INTO user_access (email, granted=true) for pre-signup
```

**`app/api/admin/users/[userId]/route.ts`** — PATCH per-user actions:
```typescript
// PATCH { granted: true | false }   → grant or revoke access
// PATCH { is_admin: true | false }  → promote or demote admin
// PATCH { admin_notes: string }     → save admin note
```

**`app/api/admin/stats/route.ts`** — GET analytics:
```typescript
// Returns per-user:
// {
//   user_id, email, display_name,
//   total_solved,        ← COUNT from user_progress WHERE status = 'SOLVED'
//   total_attempting,    ← COUNT WHERE status = 'ATTEMPTING'
//   queues_generated,    ← COUNT from queue_history
//   topics_solved,       ← { topic: count } map (top 5)
//   last_active,         ← MAX(updated_at) from user_progress
// }
```

### Phase 4 — Admin UI (~60 min)

**`app/admin/page.tsx`** — two tabs, premium dark design.

#### Tab 1: Users

```
┌──────────────────────────────────────────────────────────────────────┐
│  🛡 Users                                        [+ Pre-approve email] │
├────────────────┬──────────┬──────────┬──────────┬────────┬──────────┤
│ Name / Email   │ Status   │ Joined   │ Last seen│ Notes  │ Actions  │
├────────────────┼──────────┼──────────┼──────────┼────────┼──────────┤
│ Vedant         │ 👑 Admin  │ Sep 2026 │ Now      │  —     │  —       │
│ vedant@...     │          │          │          │        │          │
├────────────────┼──────────┼──────────┼──────────┼────────┼──────────┤
│ Friend Name    │ ✅ Access │ Oct 2026 │ 2d ago   │ 📝     │ [Revoke] │
│ friend@...     │          │          │          │        │          │
├────────────────┼──────────┼──────────┼──────────┼────────┼──────────┤
│ Waiting User   │ ⏳ Pending│ Oct 2026 │ Never    │  —     │ [Grant][✕]│
│ waiting@...    │          │          │          │        │          │
└────────────────┴──────────┴──────────┴──────────┴────────┴──────────┘
```

Actions:
- **Grant** / **Revoke** — instant DB update, badge updates in place
- **✕** — delete pending user (they can re-sign-up; doesn't delete auth account)
- **📝** — inline note editor (click to expand, save on blur)
- **+ Pre-approve** — modal: enter email → row created with `granted: true, email`
- **Promote / Demote admin** — available via row action on non-admin users

#### Tab 2: Analytics

```
┌──────────────┬────────┬───────────┬────────┬─────────────┬──────────┐
│ User         │ Solved │ Attempting│ Queues │ Top topics  │ Last seen│
├──────────────┼────────┼───────────┼────────┼─────────────┼──────────┤
│ Vedant       │  142   │     3     │   31   │ DP, Graph   │ Now      │
│ Friend       │   28   │     1     │    7   │ Arrays, BFS │ 2d ago   │
└──────────────┴────────┴───────────┴────────┴─────────────┴──────────┘
```

### Phase 5 — Landing Page (~45 min)

**`app/page.tsx`** (public, no auth wrapper):

Sections:
1. **Hero** — name, tagline ("Blind-mode DSA practice. Built for OLT prep."), CTA buttons
2. **How it works** — 3 cards: Queue → Reveal → Solve
3. **Waitlist / Access form** — "Request Access" → email input → `POST /api/waitlist`
   - If user already has an account: show "You're on the waitlist. We'll notify you."
   - If already granted: "You're in! [Log in →]"
4. **Footer** — contact email, GitHub link (if public)

**`app/api/waitlist/route.ts`** (public, no auth):
```typescript
// POST { email } → INSERT INTO user_access (email, granted=false, requested_at=NOW())
// ON CONFLICT (email) DO NOTHING  ← needs unique index on email
// Returns: { status: 'pending' | 'already_granted' | 'already_pending' }
```

Note: `user_access` is keyed by `user_id` (UUID), not email. Pre-signup waitlist entries
need a separate `waitlist` table keyed by email, then matched to `user_id` on signup.

**Alternative (simpler):** Just show the existing login/signup page as the landing, with
a "learn more" section above the auth form. No routing change needed. (See Q7.)

---

## Nothing-Breaks Guarantees

| Scenario | Outcome |
|---|---|
| Non-admin visits `/admin` | Middleware checks DB, redirects to `/` |
| Admin API called without session | 401 before any DB query |
| Service role key missing | Admin routes return 500; regular users unaffected |
| Migration not run yet | `is_admin` column missing → admin check falls back to hardcoded ID list (add fallback in middleware) |
| `/home` not found after routing change | All internal links updated in same PR; no broken links |
| Email column null (old user) | Display falls back to `user_id` truncated |
| Revoke mid-session | Middleware re-checks `granted` on every request → kicked on next navigation |
| Double waitlist submit | `ON CONFLICT DO NOTHING` on waitlist table |

---

## Open Questions

**Q7. Landing page complexity — simple or full?**
Option A *(simple)*: `/` = existing auth page with a "What is DSA Tracker?" section above login.
Zero routing change, no new `app/page.tsx`. Fast to ship.
Option B *(full)*: Dedicated landing page at `/`, queue moves to `/home`. More work (~1h extra).

Recommendation: **Option A first** — get admin panel live, landing page is a nice-to-have.
Can upgrade to Option B later when you want to make it public.

**Q8. Waitlist table vs. email on user_access?**
If someone fills the waitlist form before signing up, we can't use `user_id` (they don't have one yet).
Options:
- Separate `waitlist(email, requested_at)` table — matched to user_id on first login
- Just use the existing login flow and let them sign up → pending → admin approves
Proposal: skip the pre-signup waitlist for now. User signs up → pending → you grant from admin panel.
The "Request Access" button on landing = just the Supabase sign-up link.
