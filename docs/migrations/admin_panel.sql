-- ============================================================
-- Admin Panel Migration
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Extend user_access with admin flag + display metadata
ALTER TABLE user_access
  ADD COLUMN IF NOT EXISTS is_admin      BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email         TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS display_name  TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS requested_at  TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS admin_notes   TEXT        DEFAULT NULL;

-- 2. Mark yourself as admin (update email/user_id as needed)
UPDATE user_access
  SET is_admin = true,
      email    = 'vedant.dev.jsr@gmail.com'
  WHERE user_id = '132f68cd-86c4-4995-8235-8ab3013940a4';

-- 3. Populate emails + display_name for all existing rows from auth.users
--    (uses user_id join, not email IS NULL — avoids skipping admin row set in step 2)
UPDATE user_access ua
  SET email        = COALESCE(ua.email, u.email),
      display_name = COALESCE(
        ua.display_name,
        u.raw_user_meta_data->>'full_name',
        u.raw_user_meta_data->>'name'
      )
  FROM auth.users u
  WHERE ua.user_id = u.id;

-- 4. Update trigger to capture email + display_name on new user signup
CREATE OR REPLACE FUNCTION handle_new_user_access()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_access (user_id, granted, email, display_name, requested_at)
  VALUES (
    NEW.id,
    false,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify:
-- SELECT user_id, email, display_name, is_admin, granted FROM user_access;
