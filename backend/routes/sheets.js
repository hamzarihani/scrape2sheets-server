const express = require('express');
const { z } = require('zod');
const logger = require('../utils/logger');
const { createSpreadsheet, generateSheetName } = require('../services/sheets-service');
const { requireAuth } = require('../middleware/auth');
const { supabase } = require('../services/supabase-service');

const router = express.Router();

/**
 * Refresh a user's Google OAuth access token using their stored refresh token.
 * Updates the new access token in the database and returns it.
 */
async function refreshGoogleToken(userId) {
  const { data: user, error } = await supabase
    .from('users')
    .select('google_provider_refresh_token')
    .eq('id', userId)
    .single();

  if (error || !user?.google_provider_refresh_token) {
    throw new Error('No Google refresh token available. Please sign in again.');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: user.google_provider_refresh_token,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
  });

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!resp.ok) {
    const body = await resp.text();
    logger.error('[Auth] Google token refresh failed', { status: resp.status, body });
    throw new Error('Failed to refresh Google token. Please sign in again.');
  }

  const tokens = await resp.json();
  const newAccessToken = tokens.access_token;

  await supabase
    .from('users')
    .update({ google_provider_token: newAccessToken, updated_at: new Date().toISOString() })
    .eq('id', userId);

  const { invalidateUserCache } = require('../services/user-cache-service');
  await invalidateUserCache(userId);

  logger.info('[Auth] Google token refreshed successfully and cache invalidated', { userId });
  return newAccessToken;
}

// Apply authentication to all routes
router.use(requireAuth);

// Request schema for export endpoint
const exportSchema = z.object({
  data: z.array(z.record(z.string(), z.any())).min(1, 'Data array must contain at least 1 item'),
  instruction: z.string().min(1).max(500),
  smartFormatting: z.boolean().optional().default(true),
});

/**
 * POST /api/sheets/export
 * 
 * Creates a new Google Spreadsheet with AI-generated name and populates it with data
 * 
 * Headers:
 *   Authorization: Bearer <access_token>
 * 
 * Body:
 *   {
 *     data: Array<Object>,      // Extracted data to export
 *     instruction: string        // Original user instruction (used for AI naming)
 *   }
 * 
 * Response:
 *   {
 *     success: true,
 *     spreadsheetUrl: string,
 *     spreadsheetId: string,
 *     sheetName: string          // AI-generated name
 *   }
 */
router.post('/export', async (req, res, next) => {
  try {
    // Validate request body
    const parsed = exportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request body',
        details: parsed.error.flatten(),
      });
    }

    const { data, instruction, smartFormatting } = parsed.data;

    logger.info('[Sheets API] Export request', {
      userId: req.userId,
      dataRows: data.length,
      instructionLength: instruction.length,
    });

    // ATOMIC USAGE INCREMENT: Check and increment in a single DB transaction
    // This prevents race conditions where multiple concurrent requests could bypass limits
    const { data: usageResult, error: rpcError } = await supabase
      .rpc('increment_usage_if_allowed', { p_user_id: req.userId });

    if (rpcError) {
      logger.error('[Sheets API] Failed to check/increment usage:', rpcError);
      return res.status(500).json({
        success: false,
        error: 'Failed to process request. Please try again.'
      });
    }

    if (!usageResult || usageResult.length === 0) {
      logger.error('[Sheets API] RPC returned no data for user:', { userId: req.userId });
      return res.status(500).json({
        success: false,
        error: 'Failed to verify usage limits.'
      });
    }

    const { allowed, new_usage, effective_limit, plan, subscription_status } = usageResult[0];

    // Check if request was allowed
    if (!allowed) {
      const errorMsg = subscription_status === 'past_due'
        ? 'Your payment is past due. Please update your payment method.'
        : plan === 'FREE'
          ? 'Free plan limit reached. Please upgrade to continue.'
          : 'Monthly limit reached. Limit resets next billing cycle.';

      logger.warn('[Sheets API] Limit reached (atomic check):', {
        userId: req.userId,
        plan,
        usage: new_usage,
        limit: effective_limit
      });

      return res.status(403).json({
        success: false,
        error: errorMsg,
        usage: {
          current: new_usage,
          limit: effective_limit
        }
      });
    }

    // ✅ Usage already incremented atomically! No race condition possible.
    logger.info('[Sheets API] Usage incremented atomically', {
      userId: req.userId,
      newUsage: new_usage,
      limit: effective_limit
    });

    // Invalidate user cache since usage was updated
    const { invalidateUserCache } = require('../services/user-cache-service');
    await invalidateUserCache(req.userId);

    // Get Google OAuth provider token from cached user profile
    const googleToken = req.user.google_provider_token;
    
    if (!googleToken) {
      logger.error('[Sheets API] No Google provider token stored for user:', { userId: req.userId });
      return res.status(401).json({
        success: false,
        error: 'Google authentication not found. Please sign in again to reconnect Google Sheets.'
      });
    }

    logger.info('[Sheets API] Using stored Google provider token');

    // Generate AI-powered sheet name
    logger.info('[Sheets API] Generating sheet name with AI...');
    const sheetName = await generateSheetName(data, instruction);
    logger.info('[Sheets API] Sheet name generated', { sheetName });

    // Create spreadsheet with data using Google token, auto-refresh on 401
    logger.info('[Sheets API] Creating spreadsheet...', { smartFormatting });
    let activeToken = googleToken;
    let spreadsheetId, spreadsheetUrl;
    try {
      ({ spreadsheetId, spreadsheetUrl } = await createSpreadsheet(
        activeToken, sheetName, data, smartFormatting
      ));
    } catch (err) {
      if (err.message.includes('expired') || err.message.includes('Invalid')) {
        logger.info('[Sheets API] Token expired, attempting refresh...');
        activeToken = await refreshGoogleToken(req.userId);
        ({ spreadsheetId, spreadsheetUrl } = await createSpreadsheet(
          activeToken, sheetName, data, smartFormatting
        ));
      } else {
        throw err;
      }
    }

    logger.info('[Sheets API] Export complete', {
      spreadsheetId,
      sheetName,
      rows: data.length,
    });

    // Save activity (usage already incremented atomically at the start)
    const { error: activityError } = await supabase
      .from('activities')
      .insert({
        user_id: req.userId,
        sheet_name: sheetName,
        spreadsheet_url: spreadsheetUrl,
        spreadsheet_id: spreadsheetId,
        item_count: data.length,
        instruction: instruction,
        timestamp: new Date().toISOString(),
      });

    if (activityError) {
      logger.error('[Sheets API] Failed to save activity:', activityError);
      // Continue anyway - don't fail the request for activity logging
    }

    return res.json({
      success: true,
      spreadsheetUrl,
      spreadsheetId,
      sheetName,
      usage: {
        current: new_usage,
        limit: effective_limit
      }
    });

  } catch (error) {
    logger.error('[Sheets API] Export failed', { 
      error: error.message,
      stack: error.stack,
    });
    
    // Handle specific error cases
    if (error.message.includes('token') || error.message.includes('authenticate')) {
      return res.status(401).json({
        success: false,
        error: error.message,
      });
    } else if (error.message.includes('Permission denied') || error.message.includes('authorized')) {
      return res.status(403).json({
        success: false,
        error: error.message,
      });
    } else if (error.message.includes('rate limit')) {
      return res.status(429).json({
        success: false,
        error: error.message,
        retryAfter: 60, // seconds
      });
    }
    
    return next(error);
  }
});

module.exports = router;

