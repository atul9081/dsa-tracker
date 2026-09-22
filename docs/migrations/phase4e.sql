-- ============================================================
-- Phase 4e Migration (addendum)
-- Run AFTER phase4.sql in Supabase SQL Editor
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. user_settings — new Phase 4e columns
-- ────────────────────────────────────────────────────────────

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS enabled_sources  TEXT[]  NOT NULL DEFAULT '{"leetcode"}',
  ADD COLUMN IF NOT EXISTS cooldown_days    INTEGER NOT NULL DEFAULT 7;

-- ────────────────────────────────────────────────────────────
-- 2. problems — Phase 4d columns (if not already added)
-- ────────────────────────────────────────────────────────────

ALTER TABLE problems
  ADD COLUMN IF NOT EXISTS sub_type     TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS source       TEXT NOT NULL DEFAULT 'leetcode',
  ADD COLUMN IF NOT EXISTS external_url TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_problems_sub_type ON problems(sub_type);
CREATE INDEX IF NOT EXISTS idx_problems_source   ON problems(source);

-- ────────────────────────────────────────────────────────────
-- 3. Rebuild problems_with_status view to expose new columns
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW problems_with_status AS
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
  COALESCE(up.status, 'TO_DO')        AS status,
  up.updated_at                        AS status_updated_at,
  up.attempt_started_at,
  up.solve_duration_secs,
  up.first_attempted_at
FROM problems p
LEFT JOIN user_progress up
  ON up.problem_id = p.id
  AND up.user_id = auth.uid();

-- ────────────────────────────────────────────────────────────
-- 4. user_progress — staleness join support
--    (Supabase auto-joins on FK; ensure FK exists)
-- ────────────────────────────────────────────────────────────

-- Verify FK exists (no-op if already there)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'user_progress_problem_id_fkey'
  ) THEN
    ALTER TABLE user_progress
      ADD CONSTRAINT user_progress_problem_id_fkey
      FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE;
  END IF;
END $$;
