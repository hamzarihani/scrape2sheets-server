-- Add Stripe billing columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none';

-- Create index for Stripe customer lookups
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);

-- Migrate existing TRIAL users to FREE plan (optional - run manually if desired)
-- UPDATE users SET plan = 'FREE', plan_limits_period = 'monthly' WHERE plan = 'TRIAL';
