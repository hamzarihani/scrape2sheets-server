const { redisClient, isRedisConnected } = require('./redis-service');
const logger = require('../utils/logger');

const USER_CACHE_PREFIX = 'user:profile:';
const CACHE_TTL = 3600; // 1 hour in seconds

/**
 * Get user profile from cache
 * @param {string} userId 
 * @returns {Promise<Object|null>}
 */
async function getCachedUser(userId) {
  if (!isRedisConnected()) return null;

  try {
    const data = await redisClient.get(`${USER_CACHE_PREFIX}${userId}`);
    if (data) {
      logger.debug('[UserCache] Hit:', userId);
      return JSON.parse(data);
    }
    logger.debug('[UserCache] Miss:', userId);
    return null;
  } catch (error) {
    logger.error('[UserCache] Get error:', error);
    return null;
  }
}

/**
 * Set user profile in cache
 * @param {string} userId 
 * @param {Object} userData 
 */
async function setCachedUser(userId, userData) {
  if (!isRedisConnected()) return;

  try {
    await redisClient.set(
      `${USER_CACHE_PREFIX}${userId}`,
      JSON.stringify(userData),
      { EX: CACHE_TTL }
    );
    logger.debug('[UserCache] Saved:', userId);
  } catch (error) {
    logger.error('[UserCache] Set error:', error);
  }
}

/**
 * Invalidate user profile from cache
 * @param {string} userId 
 */
async function invalidateUserCache(userId) {
  if (!isRedisConnected()) return;

  try {
    await redisClient.del(`${USER_CACHE_PREFIX}${userId}`);
    logger.info('[UserCache] Invalidated:', userId);
  } catch (error) {
    logger.error('[UserCache] Invalidate error:', error);
  }
}

module.exports = {
  getCachedUser,
  setCachedUser,
  invalidateUserCache
};
