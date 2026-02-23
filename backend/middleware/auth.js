const { supabase } = require('../services/supabase-service');
const logger = require('../utils/logger');

/**
 * Middleware to require authentication
 * Verifies Supabase session token from Authorization header
 * Sets req.userId and req.user for downstream handlers
 */
async function requireAuth(req, res, next) {
  try {
    // Extract Bearer token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('[Auth] Missing or invalid Authorization header');
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Missing or invalid authorization header'
      });
    }
    
    const token = authHeader.substring(7); // Remove "Bearer " prefix
    
    if (!token) {
      logger.warn('[Auth] Empty token');
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Missing access token'
      });
    }
    
    // Verify token with Supabase Auth
    const { data: { user: authUser }, error } = await supabase.auth.getUser(token);
    
    if (error) {
      logger.warn('[Auth] Invalid token:', error.message);
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Invalid or expired token'
      });
    }
    
    if (!authUser) {
      logger.warn('[Auth] No user found for token');
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: User not found'
      });
    }

    // Try to get full user profile from cache
    const { getCachedUser, setCachedUser } = require('../services/user-cache-service');
    let fullUser = await getCachedUser(authUser.id);

    if (!fullUser) {
      // Cache miss: Get user profile from Supabase 'users' table
      const { data: dbUser, error: dbError } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (dbError || !dbUser) {
        logger.error('[Auth] User profile not found in DB:', dbError);
        return res.status(404).json({
          success: false,
          error: 'User profile not found. Please try signing in again.'
        });
      }

      fullUser = dbUser;
      // Cache the profile for future requests
      await setCachedUser(authUser.id, fullUser);
    }
    
    // Set user info on request object
    req.userId = authUser.id;
    req.user = fullUser; // Now contains full profile (plan, usage, etc.)
    req.accessToken = token;
    
    next();
  } catch (error) {
    logger.error('[Auth] Authentication error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during authentication'
    });
  }
}

module.exports = {
  requireAuth
};
