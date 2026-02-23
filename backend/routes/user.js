const express = require('express');
const { supabase } = require('../services/supabase-service');
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/user/me
 * Get current user profile combining auth.users and users table
 */
router.get('/me', async (req, res) => {
  try {
    logger.info('[User] Fetching user profile:', { userId: req.userId });
    
    // req.user already contains full profile from cache/DB
    const userProfile = req.user;
    
    // Combine auth info (from req.user) with remaining profile data
    const user = {
      id: req.userId,
      email: userProfile.email,
      name: userProfile.user_metadata?.full_name || userProfile.email,
      picture: userProfile.user_metadata?.avatar_url,
      plan: userProfile.plan,
      usage_this_month: userProfile.usage_this_month,
      plan_limits_scrapes: userProfile.plan_limits_scrapes,
      plan_limits_period: userProfile.plan_limits_period,
      subscription_status: userProfile.subscription_status,
      smart_formatting: userProfile.smart_formatting,
      trial_start_date: userProfile.trial_start_date,
      billing_date: userProfile.billing_date
    };
    
    res.json({
      success: true,
      user
    });
  } catch (error) {
    logger.error('[User] Exception fetching user profile:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/user/activities
 * Fetch user's activity history (last 50, sorted by timestamp DESC)
 */
router.get('/activities', async (req, res) => {
  try {
    logger.info('[User] Fetching activities:', { userId: req.userId });
    
    const { data: activities, error } = await supabase
      .from('activities')
      .select('*')
      .eq('user_id', req.userId)
      .order('timestamp', { ascending: false })
      .limit(50);
    
    if (error) {
      logger.error('[User] Error fetching activities:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch activities'
      });
    }
    
    res.json({
      success: true,
      activities: activities || []
    });
  } catch (error) {
    logger.error('[User] Exception fetching activities:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * DELETE /api/user/activities
 * Clear all user activities
 */
router.delete('/activities', async (req, res) => {
  try {
    logger.info('[User] Clearing activities:', { userId: req.userId });
    
    const { error } = await supabase
      .from('activities')
      .delete()
      .eq('user_id', req.userId);
    
    if (error) {
      logger.error('[User] Error clearing activities:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to clear activities'
      });
    }
    
    res.json({
      success: true,
      message: 'All activities cleared successfully'
    });
  } catch (error) {
    logger.error('[User] Exception clearing activities:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * PATCH /api/user/settings
 * Update user settings (smart_formatting, etc.)
 */
router.patch('/settings', async (req, res) => {
  try {
    const { smart_formatting } = req.body;
    
    logger.info('[User] Updating settings:', { userId: req.userId, smart_formatting });
    
    // Prepare update data
    const updateData = {
      updated_at: new Date().toISOString()
    };
    
    if (typeof smart_formatting === 'boolean') {
      updateData.smart_formatting = smart_formatting;
    }
    
    // Update user settings
    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', req.userId)
      .select()
      .single();
    
    if (error) {
      logger.error('[User] Error updating settings:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update settings'
      });
    }

    // Invalidate cache
    const { invalidateUserCache } = require('../services/user-cache-service');
    await invalidateUserCache(req.userId);
    
    res.json({
      success: true,
      settings: {
        smart_formatting: data.smart_formatting
      }
    });
  } catch (error) {
    logger.error('[User] Exception updating settings:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * DELETE /api/user/delete-account
 * Permanently delete the authenticated user's account and related data
 */
router.delete('/delete-account', async (req, res) => {
  try {
    const userId = req.userId;

    logger.info('[User] Deleting account:', { userId });

    // 1) Delete user activities (non-fatal if none exist)
    const { error: activitiesError } = await supabase
      .from('activities')
      .delete()
      .eq('user_id', userId);

    if (activitiesError) {
      logger.error('[User] Error deleting activities during account deletion:', activitiesError);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete account activities. Please try again.'
      });
    }

    // 2) Delete user record (includes Google tokens and plan data)
    const { error: userError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (userError) {
      logger.error('[User] Error deleting user record during account deletion:', userError);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete account data. Please try again.'
      });
    }

    // 3) Delete Supabase auth user (removes ability to sign in again)
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);

    if (authError) {
      logger.error('[User] Error deleting Supabase auth user:', authError);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete authentication record. Please contact support.'
      });
    }

    // Invalidate cache
    const { invalidateUserCache } = require('../services/user-cache-service');
    await invalidateUserCache(userId);

    return res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    logger.error('[User] Exception deleting account:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;
