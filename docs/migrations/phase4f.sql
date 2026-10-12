-- Add cses_ratio column to user_settings
-- Value: 0.0 – 1.0 (fraction of daily queue from CSES)
-- NULL = auto (proportional to pool sizes)
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS cses_ratio REAL DEFAULT NULL;
