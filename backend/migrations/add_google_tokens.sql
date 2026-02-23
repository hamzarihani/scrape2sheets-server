-- Migration: Add Google Provider Token Storage
-- Date: 2026-01-07
-- Purpose: Store Google OAuth tokens for direct Google Sheets API access

-- Add columns to users table to store Google provider tokens
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS google_provider_token TEXT,
ADD COLUMN IF NOT EXISTS google_provider_refresh_token TEXT;

-- Add index for token lookups (optional, for performance)
CREATE INDEX IF NOT EXISTS idx_users_google_tokens ON users(id) WHERE google_provider_token IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN users.google_provider_token IS 'Google OAuth access token for Sheets API access';
COMMENT ON COLUMN users.google_provider_refresh_token IS 'Google OAuth refresh token for token renewal';





