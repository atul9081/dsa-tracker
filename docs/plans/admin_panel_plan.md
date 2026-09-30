# Admin Panel — Design Plan

## Background

DSA Tracker is currently invite-only with a manual whitelist (`user_access` table).
Granting access requires a direct Supabase SQL update.
This plan adds a `/admin` route for real-time access management, user analytics,
and an optional landing page for new users to request access.

## Scope

1. **Access Management** — view all users, grant/revoke access, approve pending requests
2. **User Analytics** — solve rates, queue usage, activity per user
3. **Landing Page** — public-facing page where new users can request access
4. **Security** — admin route locked to specific user IDs, zero exposure to regular users

---

## Current DB State

```sql
-- user_access table (already exists from Phase 4)
CREATE TABLE user_access (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- auth.users is Supabase-managed (email, created_at, last_sign_in_at, etc.)
```

Missing fields for this plan:
- `display_name TEXT` or `email TEXT` on `user_access` (to show who is who without joining auth.users which requires service role)
- `requested_at TIMESTAMPTZ` — when they signed up / requested access
- `notes TEXT` — admin notes per user (optional)

---

## DB Migration

> ⚠️ Additive only — no existing columns modified.

```sql
-- 1. Add metadata to user_access for easier admin display
ALTER TABLE user_access
  ADD COLUMN IF NOT EXISTS email       TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS admin_notes  TEXT DEFAULT NULL;

-- 2. Populate email from auth.users for existing rows (run once, service role)
-- UPDATE user_access ua
-- SET email = u.email
-- FROM auth.users u
-- WHERE ua.user_id = u.id AND ua.email IS NULL;

-- 3. Auto-populate email on new user signup (extend existing trigger)
-- (Update handle_new_user_access function to also read email from NEW record)
```

---

## Security Model

Admin check is **dual-layered**:

**Layer 1 — Middleware** (server-side, before any page render):
```typescript
// middleware.ts — add /admin to protected routes
const ADMIN_USER_IDS = new Set([
  '132f68cd-86c4-4995-8235-8ab3013940a4', // vedant.dev.jsr@gmail.com
]);

if (pathname.startsWith('/admin')) {
  const userId = session?.user?.id;
  if (!userId || !ADMIN_USER_IDS.has(userId)) {
    return NextResponse.redirect(new URL('/', req.url));
  }
}
```

**Layer 2 — API routes** (`/api/admin/*`):
- All admin API routes verify `userId` against `ADMIN_USER_IDS` before any DB operation
- Uses service role key (already in env) to bypass RLS for cross-user reads

---

## Implementation Phases

### Phase 1 — Admin API (~20 min)

**`app/api/admin/users/route.ts`** — GET all users with access status:
```typescript
// Returns: [{ user_id, email, granted, requested_at, last_sign_in, admin_notes }]
// Uses service role key to read auth.users + user_access
```

**`app/api/admin/users/[userId]/route.ts`** — PATCH grant/revoke/notes:
```typescript
// PATCH { granted: true }   → grant access
// PATCH { granted: false }  → revoke access
// PATCH { admin_notes: "..." } → add note
```

**`app/api/admin/stats/route.ts`** — GET aggregate analytics:
```typescript
// Returns per-user: { user_id, total_solved, queues_generated, last_active }
// Joins user_progress + queue_history
```

### Phase 2 — Admin UI (~45 min)

**`app/admin/page.tsx`** — two tabs:

#### Tab 1: Users
```
┌─────────────────────────────────────────────────────────────────┐
│ Users                                          [+ Add by email]  │
├──────────────────┬──────────┬──────────┬───────────┬───────────┤
│ Email            │ Status   │ Joined   │ Last seen │ Actions   │
├──────────────────┼──────────┼──────────┼───────────┼───────────┤
│ vedant@...       │ ✅ Admin  │ Sep 2026 │ Today     │ —         │
│ friend@...       │ ✅ Access │ Oct 2026 │ 2d ago    │ [Revoke]  │
│ pending@...      │ ⏳ Pending│ Oct 2026 │ Never     │ [Grant] [✕]│
└──────────────────┴──────────┴──────────┴───────────┴───────────┘
```

- **Grant / Revoke** — instant toggle with confirmation
- **Add by email** — enter email → creates `user_access` row with `granted: true` pre-set
  (user signs up → trigger creates their row → already granted)
- **Notes** — click to add a private admin note

#### Tab 2: Analytics
```
┌──────────────────┬───────────┬────────────┬───────────┬──────────┐
│ User             │ Solved    │ Attempting │ Queues    │ Last seen│
├──────────────────┼───────────┼────────────┼───────────┼──────────┤
│ vedant@...       │ 142       │ 3          │ 31        │ Today    │
│ friend@...       │ 28        │ 1          │ 7         │ 2d ago   │
└──────────────────┴───────────┴────────────┴───────────┴──────────┘
```

### Phase 3 — Landing Page (~30 min)

**`app/(landing)/page.tsx`** — public page at `/` (or `/welcome`):

- What DSA Tracker is (1 paragraph)
- Screenshot or demo GIF
- "Request Access" form → email input → creates a `user_access` row with `granted: false`
- Confirmation: "You'll get access once approved. Contact: intruderjsr@duck.com"

Currently `/` is probably the queue page (behind auth). Decision needed: keep `/` gated or make it the landing page (see Q3).

### Phase 4 — Email notification (optional, ~20 min)

When a new user requests access, send a notification email to admin via Resend/Supabase Email:
- "New access request from user@example.com — approve at dsa-tracker.vercel.app/admin"

---

## Nothing-breaks guarantees

| Scenario | Outcome |
|---|---|
| Non-admin visits `/admin` | Middleware redirects to `/` before page renders |
| Admin API called without valid session | 401 returned before any DB query |
| Service role key missing | Admin API returns 500 (non-admin users unaffected) |
| `user_access` email column missing (migration not run) | Display falls back to user_id (existing data safe) |
| Grant/revoke fails mid-request | DB transaction rolled back, UI shows error |
| Landing page form submitted twice | `ON CONFLICT (user_id) DO NOTHING` prevents duplicate rows |

---

## Open Questions

> Please edit/answer — I'll implement to your answers.

**Q1. Multiple admins?**
Should only your account be admin, or should there be a way to promote other users to admin?
Proposal: hardcode your user ID in `middleware.ts` — simple, secure, no DB field needed.

**Q2. Add user flow — before or after signup?**
Option A: Admin enters email → user signs up later → already has `granted: true` row waiting.
Option B: User signs up first (gets `granted: false`) → admin approves from panel.
Option C: Both — admin can pre-approve emails AND approve pending sign-ups.
Proposal: Option C.

**Q3. Landing page at `/` or `/welcome`?**
If landing page goes at `/`, the current `/` (daily queue) would move to `/home` or `/queue`.
This is a significant routing change. Alternatively, keep `/` gated and put landing at `/welcome`
(public, no auth required). Which do you prefer?

**Q4. Analytics scope for now?**
What per-user stats do you want? Options:
- Minimal: solved count, last active date
- Medium: + queues generated, topics distribution (which topics solved most)
- Full: + daily streaks, sub-type breakdown, difficulty split

**Q5. Email notifications?**
Should you get an email when someone requests access, or is checking the admin panel manually fine?
If email: which provider? (Supabase has built-in email, or Resend is easy to add)

**Q6. Revoke behaviour?**
If you revoke access mid-session, should that user be immediately signed out,
or can they finish their current session (kicked on next page load / token refresh)?
Proposal: kicked on next page load (middleware re-checks on every request).
