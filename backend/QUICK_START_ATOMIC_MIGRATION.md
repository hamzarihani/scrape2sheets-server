# Quick Start: Atomic Usage Migration

## ⚡ 5-Minute Setup Guide

### Step 1: Open Supabase Dashboard (2 min)

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Select your project: **scrape2sheets**
3. Click **SQL Editor** in left sidebar
4. Click **+ New query**

### Step 2: Run Migration (1 min)

Copy and paste this entire SQL script:

```sql
-- Atomic Usage Increment Function
-- Prevents race conditions when checking/incrementing usage limits

DROP FUNCTION IF EXISTS increment_usage_if_allowed(uuid);

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
  -- Lock row and read current state
  SELECT
    usage_this_month,
    plan_limits_scrapes,
    plan,
    subscription_status
  INTO v_usage, v_limit, v_plan, v_status
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 0, 'FREE'::text, 'none'::text;
    RETURN;
  END IF;

  -- Apply past_due enforcement
  IF v_status = 'past_due' THEN
    v_limit := 5;
  END IF;

  -- Check limit BEFORE incrementing
  IF v_usage >= v_limit THEN
    RETURN QUERY SELECT false, v_usage, v_limit, v_plan, v_status;
    RETURN;
  END IF;

  -- Increment atomically
  UPDATE users
  SET usage_this_month = usage_this_month + 1, updated_at = now()
  WHERE id = p_user_id
  RETURNING usage_this_month, plan_limits_scrapes, plan, subscription_status
  INTO v_usage, v_limit, v_plan, v_status;

  RETURN QUERY SELECT true, v_usage, v_limit, v_plan, v_status;
END;
$$;

COMMENT ON FUNCTION increment_usage_if_allowed(uuid) IS
'Atomically increment usage counter if under limit. Uses row-level locking to prevent race conditions.';
```

Click **Run** (or press `Ctrl+Enter`)

### Step 3: Verify (1 min)

Run this to confirm it worked:

```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_name = 'increment_usage_if_allowed';
```

Should return:
```
routine_name
----------------------------
increment_usage_if_allowed
```

### Step 4: Test (1 min)

Get a user ID and test:

```sql
-- Get a user ID
SELECT id FROM users LIMIT 1;

-- Test the function (replace UUID)
SELECT * FROM increment_usage_if_allowed('YOUR-USER-ID-HERE'::uuid);
```

Expected output:
```
allowed | new_usage | effective_limit | plan | subscription_status
--------|-----------|-----------------|------|--------------------
true    | 1         | 5               | FREE | none
```

### ✅ Done!

The backend code is already updated. Next time you deploy, it will automatically use the atomic function.

---

## What This Fixes

**Before:** Two users hitting the endpoint at the same time could both bypass the limit

**After:** Impossible to bypass limits - checks and increments happen atomically

---

## Deployment

The code changes are already in your backend. Just commit and push:

```bash
git add .
git commit -m "Add atomic usage counter (prevents race conditions)"
git push origin main
```

Railway will auto-deploy.

---

## Monitoring

After deployment, check logs for:

```
✅ [Sheets API] Usage incremented atomically
   userId: xxx
   newUsage: 1
   limit: 5
```

If you see:
```
❌ function increment_usage_if_allowed does not exist
```

Go back to Step 2 and run the migration again.

---

## Need Help?

See full guide: `ATOMIC_USAGE_MIGRATION_GUIDE.md`
