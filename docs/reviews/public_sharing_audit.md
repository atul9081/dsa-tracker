# Public Sharing Safety Audit

> Full audit of every attack surface before sharing the link publicly.
> Verdict: **✅ Safe to share publicly** — all checks passed (Oct 13, 2026).
> Both open verification items confirmed. See the Verification Log at the bottom.

---

## Surface 1 — API routes are not behind middleware

**Question**: Middleware skips `/api/*` paths. Could a random person call `/api/queue`, `/api/progress`, `/api/settings` directly without being in the whitelist?

**Finding**: Every API route calls `supabase.auth.getUser()` as its first line and returns `401` if no user. `createClient()` (the server helper) uses the **anon key + the user's session cookie**. Without a valid Supabase session cookie, `getUser()` returns null. There is no session cookie without going through Google OAuth or email signup.

**Verdict**: ✅ Safe. Unauthenticated API calls get `401` without touching any DB data.

---

## Surface 2 — Email signup bypass: new users reach the app without approval

**Question**: The login page has both Google OAuth AND email+password signup. Can someone sign up via email and skip the approval gate?

**Finding**: Yes — and this is **by design** in the existing system. Both flows create a Supabase auth user. The `auth/callback` route (OAuth) and Supabase's email confirmation flow both result in a user with a valid session. The `user_access` row is created with `granted=false` by a DB trigger (or the safety-net upsert in `auth/callback`). Middleware then checks `granted` and redirects to `/waiting`.

So email signup doesn't bypass approval — the user lands on `/waiting` just like a Google signup.

**But there's a subtlety**: the login page shows a "Sign Up" mode with email + password. This still needs email confirmation (Supabase default), so bots can't easily mass-create accounts. But if you have email confirmations **disabled** in Supabase settings, unconfirmed emails could create sessions.

> [!IMPORTANT]
> **Check**: Supabase Dashboard → Authentication → Settings → "Enable email confirmations" should be **ON**. If it's off, anyone can create an account instantly without confirming their email.

**Verdict**: ✅ Safe. Email confirmations confirmed ON (Oct 13, 2026).

---

## Surface 3 — RLS: can one user read another user's data?

**Question**: All API routes use `createClient()` with the **anon key + user session cookie**. Does RLS prevent user A from reading user B's progress, settings, queue?

**Finding**: All API routes query tables filtered by `.eq('user_id', user.id)` in the application code. But this alone is not sufficient — if RLS is off or misconfigured, a crafted API call that changes `user_id` could leak data.

**Key observation**: The API routes always set `user_id: user.id` from the **server-verified** `getUser()` call — they never trust `user_id` from the request body for reads. For writes, `user_id` is always set from the server-side authenticated user, not from the request payload.

For example in `/api/progress`:

```ts
const {
  data: { user },
} = await supabase.auth.getUser(); // server-verified
row.user_id = user.id; // never from body
```

**However**, if RLS is disabled on any table, a malicious authenticated user could potentially craft a Supabase PostgREST query directly (using the anon key + their session) to read other users' data. The anon key is public (exposed to the browser, by design with Supabase).

> [!IMPORTANT]
> **Check in Supabase → Table Editor → each table's RLS status:**
>
> - `user_progress` — RLS must be ON, policy: `user_id = auth.uid()`
> - `user_settings` — RLS must be ON
> - `daily_queues` — RLS must be ON
> - `queue_history` — RLS must be ON
> - `user_access` — RLS must be ON (users must NOT be able to set their own `granted=true`)
>
> The application code filters correctly, but RLS is the actual enforcement layer if someone hits Supabase directly.

**Verdict**: ✅ Safe. RLS confirmed ON with correct `user_id = auth.uid()` policies on all user-scoped tables (Oct 13, 2026). See Verification Log for full output.

---

## Surface 4 — Admin privilege escalation

**Question**: Can a regular approved user get admin access by manipulating their own `user_access` row?

**Finding**:

- All `/api/admin/*` routes call `getAdminUser()` which does: `auth.getUser()` → fetch `user_access.is_admin` using the **service role client** (bypasses RLS) → return null if not admin.
- The service role client is server-only (`SUPABASE_SERVICE_ROLE_KEY` — not a `NEXT_PUBLIC_` var, never in the browser bundle).
- A regular user using their session + anon key cannot write `is_admin=true` to their own `user_access` row — only if RLS allows it. If RLS policy on `user_access` is `user_id = auth.uid()` for SELECT only and no INSERT/UPDATE policy for non-service-role, this is blocked.

> [!IMPORTANT]
> **Check**: `user_access` RLS policy must NOT allow users to UPDATE their own `is_admin` field. The policy for UPDATE/INSERT should only allow the service role (i.e., no user-facing UPDATE policy at all).

**Verdict**: ✅ Safe as long as RLS blocks users from self-updating `is_admin`. Verify this policy exists.

---

## Surface 5 — Skip and queue regeneration: abuse by approved users

**Question**: An approved user could spam `/api/queue/skip` (skip every problem, hundreds of times) or `/api/queue` POST (regen the entire queue repeatedly). This is computationally heavy.

**Finding**:

- `/api/queue/skip` fetches the full problem pool (paginated, up to thousands of rows per call). Spamming this = many large DB reads per request.
- `/api/queue` POST (regen) is similarly heavy — it loads all problems, filters, and writes history.
- These routes have no rate limiting today.
- The kill switch can block everyone, but not selectively block one abusive approved user.

**Current mitigations**:

- Only approved users can reach these routes.
- Vercel cold-starts add natural latency.
- Supabase free tier connection pool (100 connections) throttles under extreme load.

**Risk level**: Low for the current use case (small invite group of trusted people). If you share widely and an approved user deliberately abuses it, there's no per-user rate limit.

**Verdict**: ✅ Acceptable for small trusted group. If you grow, add rate limiting on these two routes (Upstash Redis is free tier and easy to add).

---

## Surface 6 — `SUPABASE_SERVICE_ROLE_KEY` exposure

**Question**: The service role key bypasses all RLS. Is there any risk of it leaking?

**Finding**:

- It's defined as `SUPABASE_SERVICE_ROLE_KEY` (no `NEXT_PUBLIC_` prefix) → Next.js never bundles it into client-side JavaScript.
- Only used in server-side code: `middleware.ts`, `app/api/admin/*`, `app/api/admin/settings/route.ts`.
- Verified: no `NEXT_PUBLIC_` prefix usage, no client component imports it.
- `.env.example` shows it correctly without the `NEXT_PUBLIC_` prefix.

**Verdict**: ✅ Safe. Key never reaches the browser.

---

## Surface 7 — Data cross-contamination between users

**Question**: Could user A see user B's queue, history, or progress?

**Finding**: Every query in every API route is scoped with `.eq('user_id', user.id)` where `user.id` comes from `supabase.auth.getUser()` (server-verified JWT, not from the request body). There is no endpoint that accepts `user_id` as a query parameter or body field for reads.

The admin panel (`/api/admin/users`) intentionally can read all users' data — but it's admin-only (protected by `getAdminUser()`).

**Verdict**: ✅ Safe at the application layer. Also verify RLS (Surface 3) for defense-in-depth.

---

## Surface 8 — OAuth redirect URI hijacking

**Question**: Could someone craft a malicious `redirectTo` parameter to exfiltrate auth codes?

**Finding**: In `login/page.tsx`:

```ts
options: {
  redirectTo: `${window.location.origin}/auth/callback`;
}
```

The redirect URI is constructed from `window.location.origin` — not from any user-supplied parameter. It always points to the app's own origin + `/auth/callback`. Supabase also validates that the redirect URI matches the configured allow-list in your project settings.

**Verdict**: ✅ Safe.

---

## Summary

| Surface                        | Status  | Action needed                                                                           |
| ------------------------------ | ------- | --------------------------------------------------------------------------------------- |
| API auth (401 without session) | ✅ Safe | None                                                                                    |
| Email signup bypass            | ✅ Safe | Email confirmations confirmed ON                                                        |
| RLS on user tables             | ✅ Safe | RLS confirmed ON, policies verified                                                     |
| Admin privilege escalation     | ✅ Safe | user_access has SELECT-only policy for regular users                                    |
| Skip/regen API abuse           | ✅ Safe | Acceptable for small trusted group                                                      |
| Service role key exposure      | ✅ Safe | None                                                                                    |
| Cross-user data                | ✅ Safe | None                                                                                    |
| OAuth redirect hijack          | ✅ Safe | None                                                                                    |

---

## ✅ Verification Log (Oct 13, 2026)

### 1. Email confirmations — CONFIRMED ON
Supabase Dashboard → Authentication → Settings → "Enable email confirmations" = **ON**.

### 2. RLS policies — CONFIRMED

```
| schemaname | tablename     | rowsecurity |
| ---------- | ------------- | ----------- |
| public     | daily_queues  | true        |
| public     | queue_history | true        |
| public     | user_access   | true        |
| public     | user_progress | true        |
| public     | user_settings | true        |

| tablename     | policyname        | cmd    | qual                   |
| ------------- | ----------------- | ------ | ---------------------- |
| daily_queues  | own_queues        | ALL    | (user_id = auth.uid()) |
| queue_history | own_queue_history | ALL    | (user_id = auth.uid()) |
| user_access   | own_access_read   | SELECT | (user_id = auth.uid()) |
| user_progress | own_progress      | ALL    | (user_id = auth.uid()) |
| user_settings | own_settings      | ALL    | (user_id = auth.uid()) |
```

**Key finding**: `user_access` has SELECT-only policy — regular users cannot write `granted=true` or `is_admin=true` to their own row. All writes go through the service role key (server-only).

**Final verdict: ✅ Safe to share publicly.**

