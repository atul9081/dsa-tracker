-- ============================================================
-- Phase 4 Migration
-- Run in Supabase SQL Editor (dashboard.supabase.com → SQL Editor)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. queue_history — append-only log of every generated queue
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS queue_history (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  problem_ids  INTEGER[] NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,   -- increments per regeneration per day
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_queue_history_user_date ON queue_history (user_id, date);
ALTER TABLE queue_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_queue_history" ON queue_history
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 2. user_access — whitelist gate
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_access (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE user_access ENABLE ROW LEVEL SECURITY;
-- Users can read their own access row (middleware uses service role, so this is for client-side checks)
CREATE POLICY "own_access_read" ON user_access
  FOR SELECT USING (user_id = auth.uid());

-- Trigger: auto-insert with granted=false when a new user signs up
CREATE OR REPLACE FUNCTION handle_new_user_access()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_access (user_id, granted)
  VALUES (NEW.id, false)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_access_created ON auth.users;
CREATE TRIGGER on_auth_user_access_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user_access();

-- Grant access to all existing users (from context/whitelist_users.json).
-- These accounts already exist and must not be locked out on deploy.
INSERT INTO user_access (user_id, granted)
VALUES
  -- vedant.dev.jsr@gmail.com
  ('132f68cd-86c4-4995-8235-8ab3013940a4', true),
  -- atulsingh0178@gmail.com
  ('7cf1da7d-1ccb-4f49-ad28-c2251e8c7c8d', true),
  -- zafeeralam469@gmail.com
  ('c08db32f-f9db-413a-b374-68ebfa2762c7', true),
  -- vascetica25@gmail.com (Vedant Asati)
  ('e4bc2988-7e63-4a0d-9a01-b0c38f480c3f', true)
ON CONFLICT (user_id) DO UPDATE SET granted = true;

-- ────────────────────────────────────────────────────────────
-- 3. problems table — add sub_type, source, external_url
-- ────────────────────────────────────────────────────────────
ALTER TABLE problems
  ADD COLUMN IF NOT EXISTS sub_type     TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS source       TEXT    NOT NULL DEFAULT 'leetcode',
  ADD COLUMN IF NOT EXISTS external_url TEXT    DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_problems_sub_type ON problems(sub_type);
CREATE INDEX IF NOT EXISTS idx_problems_source   ON problems(source);

-- ────────────────────────────────────────────────────────────
-- 4. user_settings — add enabled_sources and cooldown_days
-- ────────────────────────────────────────────────────────────
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS enabled_sources TEXT[]  NOT NULL DEFAULT ARRAY['leetcode'],
  ADD COLUMN IF NOT EXISTS cooldown_days   INTEGER NOT NULL DEFAULT 7;

-- ────────────────────────────────────────────────────────────
-- 5. Rebuild problems_with_status view to expose new columns
-- ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS problems_with_status;

CREATE VIEW problems_with_status AS
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
