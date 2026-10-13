-- ============================================================
-- Plan 6 — Bug Fix Migrations
-- Run in: Supabase SQL Editor → New query
-- Run BOTH blocks — they are independent and safe to re-run.
-- ============================================================

-- ── 0a: Backfill null email / display_name in user_access ────────────────────
-- Affects users who signed up before admin_panel.sql added email/display_name
-- to the trigger. COALESCE preserves any values already set.

UPDATE user_access ua
SET
  email        = COALESCE(ua.email,        u.email),
  display_name = COALESCE(
    ua.display_name,
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    u.email   -- last resort so display falls back to email, not a UUID
  )
FROM auth.users u
WHERE ua.user_id = u.id
  AND (ua.email IS NULL OR ua.display_name IS NULL);

-- Verify:
SELECT user_id, email, display_name FROM user_access WHERE email IS NULL OR display_name IS NULL;


-- ── 0b: Recreate problems_with_status with security_invoker ──────────────────
-- Removes the "Security Definer" Supabase warning.
-- Logic is identical — auth.uid() still scopes progress to the calling user.
-- security_invoker = true means Postgres enforces RLS using the caller's role,
-- giving defense-in-depth on top of the existing auth.uid() JOIN filter.

DROP VIEW IF EXISTS problems_with_status;

CREATE VIEW problems_with_status
  WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.title,
  p.title_slug,
  p.difficulty,
  p.topic_tags,
  p.description,
  p.ac_rate,
  p.paid_only,
  p.olt_score,
  p.sub_type,
  p.source,
  p.external_url,
  COALESCE(up.status, 'TO_DO')  AS status,
  up.updated_at                  AS status_updated_at,
  up.attempt_started_at,
  up.solve_duration_secs,
  up.first_attempted_at
FROM problems p
LEFT JOIN user_progress up
  ON up.problem_id = p.id
  AND up.user_id = auth.uid();

-- Verify (should return your own problems with statuses, not others'):
SELECT id, title, status FROM problems_with_status LIMIT 5;
