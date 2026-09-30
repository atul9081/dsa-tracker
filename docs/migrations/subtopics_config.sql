-- ============================================================
-- Sub-topic Configuration Migration
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
-- Safe: additive only.
--   - ADD COLUMN IF NOT EXISTS → no-op if column already exists
--   - DEFAULT NULL → existing rows get null = all sub-types eligible = no behaviour change
-- Rollback (only if all values are still NULL):
--   ALTER TABLE user_settings DROP COLUMN enabled_sub_type_slugs;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS enabled_sub_type_slugs jsonb DEFAULT NULL;

-- Verify:
-- SELECT enabled_sub_type_slugs FROM user_settings LIMIT 3;
-- All rows should return null.
