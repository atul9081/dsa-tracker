-- ============================================================
-- Plan 6.1 — display_name backfill correction
-- Run in: Supabase SQL Editor
-- ============================================================

-- Fix rows where display_name was previously set to the email address
-- (by the old API route fallback). Reset them to the real OAuth name,
-- or NULL if no name exists — so the admin panel can show '—' instead
-- of duplicating the email.

UPDATE user_access ua
SET display_name = COALESCE(
  u.raw_user_meta_data->>'full_name',
  u.raw_user_meta_data->>'name'
  -- intentionally no email fallback
)
FROM auth.users u
WHERE ua.user_id = u.id
  AND (
    -- was set to email (old bug) — reset to real name or NULL
    ua.display_name = u.email
    -- or still null — try to fill with real name
    OR ua.display_name IS NULL
  );

-- Verify: rows where display_name = email should now be NULL or real name
SELECT user_id, email, display_name FROM user_access ORDER BY requested_at DESC LIMIT 20;
