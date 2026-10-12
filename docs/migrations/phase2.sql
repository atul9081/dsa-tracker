-- ============================================================
-- Phase 2 Migration — Run in Supabase SQL Editor
-- Run each block in order. Safe to re-run (uses IF NOT EXISTS).
-- ============================================================

-- ── 1. Add timing columns to user_progress ─────────────────
ALTER TABLE user_progress
  ADD COLUMN IF NOT EXISTS attempt_started_at  TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS solve_duration_secs INTEGER     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS first_attempted_at  TIMESTAMPTZ DEFAULT NULL;

-- ── 2. Create user_settings table ──────────────────────────
CREATE TABLE IF NOT EXISTS user_settings (
  user_id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_count           INTEGER DEFAULT 5
                        CHECK (daily_count BETWEEN 1 AND 20),
  hard_count            INTEGER DEFAULT 2,
  medium_count          INTEGER DEFAULT 3,
  easy_count            INTEGER DEFAULT 0,
  difficulty_mode       TEXT    DEFAULT 'standard'
                        CHECK (difficulty_mode IN ('chill','standard','grind','custom')),
  enabled_topic_slugs   TEXT[]  DEFAULT NULL,  -- NULL = all topics enabled
  topic_weight_overrides JSONB  DEFAULT '{}',  -- { "graph": 2.0, "dp": 0.5 }
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_settings' AND policyname = 'own_settings'
  ) THEN
    CREATE POLICY "own_settings" ON user_settings
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END
$$;

-- ── 3. Rebuild problems_with_status view with timing columns ─
DROP VIEW IF EXISTS problems_with_status;

CREATE VIEW problems_with_status AS
  SELECT
    p.*,
    COALESCE(up.status, 'TO_DO')  AS status,
    up.updated_at                  AS status_updated_at,
    up.attempt_started_at,
    up.solve_duration_secs,
    up.first_attempted_at
  FROM problems p
  LEFT JOIN user_progress up
    ON p.id = up.problem_id AND up.user_id = auth.uid();

-- ── Done ────────────────────────────────────────────────────
-- After running this, redeploy / restart your Next.js server.
