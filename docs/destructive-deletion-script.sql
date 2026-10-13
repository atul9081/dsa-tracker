-- WARNING: DESCRUCTIVE DELETION SCRIPT
-- WARNING: DESCRUCTIVE DELETION SCRIPT
-- WARNING: DESCRUCTIVE DELETION SCRIPT

-- CHECK AND CONFIRM MULTIPLE TIMES BEFORE RUNNING
-- CHECK AND CONFIRM MULTIPLE TIMES BEFORE RUNNING
-- CHECK AND CONFIRM MULTIPLE TIMES BEFORE RUNNING

DO $delete_user$
DECLARE
  target_email text := 'user@example.com';
  matching_ids uuid[];
  target_id uuid;
  owned_objects bigint;
BEGIN
  IF target_email IS NULL OR btrim(target_email) = '' THEN
    RAISE EXCEPTION 'Set target_email before running this script';
  END IF;

  SELECT array_agg(id ORDER BY id)
  INTO matching_ids
  FROM auth.users
  WHERE lower(email) = lower(target_email);

  IF COALESCE(cardinality(matching_ids), 0) = 0 THEN
    RAISE EXCEPTION 'No Auth account found for that email';
  ELSIF cardinality(matching_ids) > 1 THEN
    RAISE EXCEPTION
      'Found % Auth accounts for that email; refusing to delete any',
      cardinality(matching_ids);
  END IF;

  target_id := matching_ids[1];

  SELECT count(*)
  INTO owned_objects
  FROM storage.objects
  WHERE owner_id = target_id::text
     OR owner = target_id;

  IF owned_objects > 0 THEN
    RAISE EXCEPTION
      'This user owns % Storage objects. Remove or reassign them through the Storage API, then rerun.',
      owned_objects;
  END IF;

  -- Remove these user-linked Auth records that do not cascade automatically.
  DELETE FROM auth.flow_state
  WHERE user_id = target_id;

  DELETE FROM auth.scim_users
  WHERE user_id = target_id;

  -- Removes the Auth account and rows linked with ON DELETE CASCADE.
  DELETE FROM auth.users
  WHERE id = target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth account was not deleted';
  END IF;

  RAISE NOTICE 'Deleted Auth account for %', target_email;
END
$delete_user$;