-- Migration: Add Atomic Usage Increment RPC Function
-- Date: 2026-02-14
-- Purpose: Prevent race conditions when incrementing usage counters
-- This ensures proper plan limit enforcement under concurrent load

-- Drop existing function if exists (for re-running migration)
DROP FUNCTION IF EXISTS increment_usage_if_allowed(uuid);

-- Create atomic usage increment function
CREATE OR REPLACE FUNCTION increment_usage_if_allowed(p_user_id uuid)
RETURNS TABLE(
  allowed boolean,
  new_usage int,
  effective_limit int,
  plan text,
  subscription_status text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_usage int;
  v_limit int;
  v_plan text;
  v_status text;
BEGIN
  -- Lock the row for update (prevents concurrent modifications)
  -- This ensures no other request can read/modify until we're done
  SELECT
    u.usage_this_month,
    u.plan_limits_scrapes,
    u.plan,
    u.subscription_status
  INTO v_usage, v_limit, v_plan, v_status
  FROM users u
  WHERE u.id = p_user_id
  FOR UPDATE;  -- Row-level lock

  -- If user not found, return not allowed
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 0, 'FREE'::text, 'none'::text;
    RETURN;
  END IF;

  -- Apply past_due enforcement (downgrade to FREE limits)
  IF v_status = 'past_due' THEN
    v_limit := 5;
  END IF;

  -- Check if user has reached their limit BEFORE incrementing
  IF v_usage >= v_limit THEN
    -- Limit reached, don't increment
    RETURN QUERY SELECT
      false,         -- not allowed
      v_usage,       -- current usage (unchanged)
      v_limit,       -- effective limit
      v_plan,        -- plan name
      v_status;      -- subscription status
    RETURN;
  END IF;

  -- Limit not reached, increment atomically
  UPDATE users u
  SET
    usage_this_month = usage_this_month + 1,
    updated_at = now()
  WHERE u.id = p_user_id
  RETURNING
    u.usage_this_month,
    u.plan_limits_scrapes,
    u.plan,
    u.subscription_status
  INTO v_usage, v_limit, v_plan, v_status;

  -- Return success with new values
  RETURN QUERY SELECT
    true,          -- allowed
    v_usage,       -- new usage (incremented)
    v_limit,       -- effective limit
    v_plan,        -- plan name
    v_status;      -- subscription status
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION increment_usage_if_allowed(uuid) IS
'Atomically increment usage counter if under limit. Returns whether operation was allowed and current usage state. Uses row-level locking to prevent race conditions.';

-- Grant execute permission to authenticated users (adjust as needed for your RLS setup)
-- GRANT EXECUTE ON FUNCTION increment_usage_if_allowed(uuid) TO authenticated;
-- GRANT EXECUTE ON FUNCTION increment_usage_if_allowed(uuid) TO service_role;
