-- ============================================================
-- Plan 6.2 — Add `revoked` column to user_access
-- Run in: Supabase SQL Editor BEFORE deploying code changes
-- ============================================================

-- Add the column. Default false so all existing rows are treated as
-- non-revoked (pending users stay pending, granted users stay granted).
ALTER TABLE public.user_access
  ADD COLUMN IF NOT EXISTS revoked boolean NOT NULL DEFAULT false;

-- Verify
SELECT user_id, email, granted, revoked, is_admin
FROM user_access
ORDER BY requested_at DESC;
