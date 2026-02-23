const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');


// Validate required environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl) {
  logger.error('[Supabase Service] Missing required environment variable: SUPABASE_URL');
  throw new Error('SUPABASE_URL environment variable is not set');
}

if (!supabaseServiceKey) {
  logger.error('[Supabase Service] Missing required environment variable: SUPABASE_SERVICE_KEY');
  throw new Error('SUPABASE_SERVICE_KEY environment variable is not set');
}
// Initialize Supabase client with service key for admin operations
const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

/**
 * Get Supabase client instance
 * @returns {Object} Supabase client
 */
function getSupabaseClient() {
  return supabase;
}


/**
 * Get user by ID from users table
 * @param {string} userId - User UUID
 * @returns {Promise<Object|null>} User object or null
 */
async function getUserById(userId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (error) {
      logger.error('[Supabase] Error fetching user:', error);
      return null;
    }
    
    return data;
  } catch (error) {
    logger.error('[Supabase] Exception fetching user:', error);
    return null;
  }
}

/**
 * Get Google provider access token for a user
 * Uses admin API to access auth.identities table
 * @param {string} userId - User UUID
 * @returns {Promise<string|null>} Google provider access token or null
 */
async function getGoogleProviderToken(userId) {
  try {
    // Query auth.identities using admin client
    // This requires direct database access via RPC or using the admin API
    const { data, error } = await supabase
      .from('identities')
      .select('provider_token, provider_refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .single();
    
    if (error) {
      // identities table is in auth schema, not public
      // Need to use admin.auth API instead
      logger.debug('[Supabase] Cannot query identities table directly, using auth.admin');
      
      // Use admin.auth to get user with identities
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
      
      if (userError || !userData.user) {
        logger.error('[Supabase] Error getting user via admin API:', userError);
        return null;
      }
      
      // Find Google identity
      const googleIdentity = userData.user.identities?.find(i => i.provider === 'google');
      
      if (!googleIdentity || !googleIdentity.identity_data) {
        logger.warn('[Supabase] No Google identity found for user:', userId);
        return null;
      }
      
      // Note: Supabase doesn't expose provider_token directly in identities
      // This is a security limitation of Supabase OAuth
      logger.error('[Supabase] Provider tokens not accessible via Supabase OAuth');
      return null;
    }
    
    return data?.provider_token || null;
  } catch (error) {
    logger.error('[Supabase] Exception getting provider token:', error);
    return null;
  }
}


module.exports = {
  getSupabaseClient,
  getUserById,
  getGoogleProviderToken,
  supabase
};

