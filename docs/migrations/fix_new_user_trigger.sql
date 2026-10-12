-- ============================================================
-- Fix: "Database error saving new user" on OAuth signup
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- Step 1: See all triggers on auth.users (diagnostic)
SELECT trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'auth' AND event_object_table = 'users';

-- ============================================================
-- Step 2: Drop any existing triggers + functions that touch
--         user_access on new user creation. The auth/callback
--         route handles the upsert, so the trigger is redundant.
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_created    ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created_v2 ON auth.users;
DROP TRIGGER IF EXISTS handle_new_user_trigger  ON auth.users;
DROP TRIGGER IF EXISTS new_user_trigger         ON auth.users;

DROP FUNCTION IF EXISTS public.handle_new_user()    CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user_v2() CASCADE;

-- ============================================================
-- Step 3: Re-create ONE clean trigger with a full exception
--         guard so it can NEVER block user creation.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_access (user_id, granted)
  VALUES (NEW.id, false)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error but never block the user creation.
    RAISE WARNING 'handle_new_user: % %', SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Step 4: Verify
-- ============================================================
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_schema = 'auth' AND event_object_table = 'users';
