-- ── Plan 5: system_settings table ────────────────────────────────────────────
-- Run in: Supabase SQL Editor → New query
-- Purpose: Stores global toggles (approval_required, site_enabled) read by
--          middleware on every request via the service role key.
--
-- Safety: additive only — no existing table touched.
--         App behaviour is unchanged until middleware.ts is updated (Step 2).

CREATE TABLE IF NOT EXISTS public.system_settings (
  id                integer      PRIMARY KEY DEFAULT 1,
  approval_required boolean      NOT NULL DEFAULT true,
  site_enabled      boolean      NOT NULL DEFAULT true,
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)   -- enforces exactly one row
);

-- Insert the default row if not already present
INSERT INTO public.system_settings (id, approval_required, site_enabled)
VALUES (1, true, true)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS (no policies needed — service role key bypasses RLS entirely;
-- anon key is blocked by default when no SELECT policy exists)
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Verify
SELECT
  id,
  approval_required,
  site_enabled,
  updated_at
FROM public.system_settings;
