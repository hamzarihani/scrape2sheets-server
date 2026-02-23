const { createClient } = require('redis');
const logger = require('../utils/logger');

let redisClient = null;

if (process.env.REDIS_URL) {
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('[Redis] Max reconnection attempts reached, falling back to basic stores');
            return new Error('Max retries reached');
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    redisClient.on('error', (err) => {
      logger.error('[Redis] Client Error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('[Redis] Connected successfully');
    });

    redisClient.connect().catch((err) => {
      logger.error('[Redis] Connection failed:', err);
    });
  } catch (error) {
    logger.error('[Redis] Failed to initialize client:', error);
  }
} else {
  logger.info('[Redis] REDIS_URL not set');
}

/**
 * Check if Redis is connected and ready
 * @returns {boolean}
 */
const isRedisConnected = () => {
  return redisClient !== null && redisClient.isOpen;
};

module.exports = {
  redisClient,
  isRedisConnected
};
