const express = require('express');
const { supabase } = require('../services/supabase-service');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/auth/google/url
 * Generate Google OAuth URL via Supabase
 */
router.get('/google/url', async (req, res) => {
  try {
    logger.info('[Auth] Generating Google OAuth URL via Supabase');
    
    // Get extension ID from environment or use placeholder
    const extensionId = process.env.EXTENSION_ID;
    const redirectUrl = extensionId 
      ? `https://${extensionId}.chromiumapp.org/` 
      : 'http://localhost:3000'; // fallback
    
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        scopes: 'email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    });
    
    if (error) {
      logger.error('[Auth] Error generating OAuth URL:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate OAuth URL'
      });
    }
    
    logger.info('[Auth] OAuth URL generated successfully');
    
    res.json({
      success: true,
      url: data.url
    });
  } catch (error) {
    logger.error('[Auth] Exception generating OAuth URL:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/auth/callback
 * Handle OAuth callback from extension
 * Extract tokens from Supabase redirect, verify user, create/update in database
 */
router.post('/callback', async (req, res) => {
  try {
    const { redirectUrl } = req.body;
    
    if (!redirectUrl) {
      logger.warn('[Auth] Missing redirectUrl in callback');
      return res.status(400).json({
        success: false,
        error: 'Missing redirectUrl'
      });
    }
    
    logger.info('[Auth] Processing OAuth callback');
    
    // Parse tokens from redirect URL hash
    const url = new URL(redirectUrl);
    const hashParams = new URLSearchParams(url.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    const providerToken = hashParams.get('provider_token');
    const providerRefreshToken = hashParams.get('provider_refresh_token');
    
    if (!accessToken) {
      logger.error('[Auth] No access token in redirect URL');
      return res.status(400).json({
        success: false,
        error: 'No access token in redirect URL'
      });
    }
    
    logger.info('[Auth] OAuth tokens received', { 
      hasProviderToken: !!providerToken,
      hasProviderRefresh: !!providerRefreshToken 
    });
    
    // Get user from Supabase using the access token
    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
    
    if (userError || !user) {
      logger.error('[Auth] Error getting user:', userError);
      return res.status(401).json({
        success: false,
        error: 'Failed to authenticate user'
      });
    }
    
    logger.info('[Auth] User authenticated:', { userId: user.id, email: user.email });
    
    // Check if user exists in our users table
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();
    
    let dbUser;
    
    if (!existingUser) {
      // New user - create with default plan and Google tokens
      logger.info('[Auth] Creating new user in database');
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          id: user.id,
          plan: 'FREE',
          usage_this_month: 0,
          plan_limits_scrapes: 5,
          plan_limits_period: 'monthly',
          subscription_status: 'none',
          smart_formatting: true,
          google_provider_token: providerToken,
          google_provider_refresh_token: providerRefreshToken,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (createError) {
        logger.error('[Auth] Error creating user:', createError);
        return res.status(500).json({
          success: false,
          error: 'Failed to create user'
        });
      }

      if (!newUser) {
        logger.error('[Auth] User insert succeeded but no data returned');
        return res.status(500).json({
          success: false,
          error: 'Failed to retrieve created user'
        });
      }

      logger.info('[Auth] New user created successfully:', { userId: user.id });
      dbUser = newUser;
    } else {
      // Existing user - update timestamp and refresh Google tokens
      logger.info('[Auth] Updating existing user with fresh tokens');
      const updateData = {
        updated_at: new Date().toISOString()
      };
      
      // Update Google tokens if provided (user re-authenticated)
      if (providerToken) {
        updateData.google_provider_token = providerToken;
      }
      if (providerRefreshToken) {
        updateData.google_provider_refresh_token = providerRefreshToken;
      }
      
      const { data: updated } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', user.id)
        .select()
        .single();
      
      dbUser = updated || existingUser;
    }
    
    // Return session token and user data
    const responseData = {
      success: true,
      session: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user_id: user.id
      },
      user: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.email,
        picture: user.user_metadata?.avatar_url,
        plan: dbUser.plan,
        usage_this_month: dbUser.usage_this_month,
        plan_limits_scrapes: dbUser.plan_limits_scrapes,
        plan_limits_period: dbUser.plan_limits_period,
        subscription_status: dbUser.subscription_status,
        smart_formatting: dbUser.smart_formatting
      }
    };

    logger.info('[Auth] Callback successful, sending response:', { userId: user.id, email: user.email });
    res.json(responseData);
  } catch (error) {
    logger.error('[Auth] Exception in callback:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/auth/signout
 * Sign out user and optionally revoke tokens
 */
router.post('/signout', requireAuth, async (req, res) => {
  try {
    logger.info('[Auth] User signing out:', { userId: req.userId });
    
    // Sign out from Supabase
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      logger.warn('[Auth] Error signing out:', error);
      // Continue anyway
    }
    
    res.json({
      success: true,
      message: 'Signed out successfully'
    });
  } catch (error) {
    logger.error('[Auth] Exception signing out:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;

