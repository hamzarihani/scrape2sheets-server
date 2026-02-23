const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
const logger = require('../utils/logger');
const { redisClient, isRedisConnected } = require('../services/redis-service');

/**
 * Rate Limiting Middleware
 * 
 * Supports Redis-based rate limiting for multi-server deployments.
 * Falls back to in-memory limiting if Redis is unavailable.
 */

// Helper to create a unique RedisStore for each limiter (required by v7)
const createStore = (prefix) => {
  if (redisClient) {
    try {
      return new RedisStore({
        sendCommand: (...args) => {
          if (!isRedisConnected()) return Promise.reject(new Error('Redis not connected'));
          return redisClient.sendCommand(args);
        },
        prefix: `rl:${prefix}:`,
      });
    } catch (error) {
      logger.error(`[RateLimit] Failed to initialize RedisStore for ${prefix}:`, error);
    }
  }
  return undefined;
};

// Custom handler for rate limit exceeded
const rateLimitHandler = (req, res) => {
  const identifier = req.user?.id || req.ip;
  logger.warn('Rate limit exceeded', {
    identifier,
    path: req.path,
    method: req.method,
    userAgent: req.get('user-agent')
  });

  res.status(429).json({
    success: false,
    error: 'Too many requests, please try again later.',
    retryAfter: res.getHeader('Retry-After')
  });
};

// Extract IP address with proper IPv6 and proxy support
const getClientIp = (req) => {
  // Check for forwarded IP (if behind proxy/load balancer)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list, take the first one
    return forwarded.split(',')[0].trim();
  }

  // Fallback to direct connection IP
  return req.ip || req.connection.remoteAddress || 'unknown';
};

// Custom key generator - use user ID if authenticated, otherwise IP (with IPv6 support)
const keyGenerator = (req) => {
  // If user is authenticated, use their ID
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }
  // Otherwise use IP with proper IPv6 handling
  return `ip:${getClientIp(req)}`;
};

// Common configuration for all limiters
const commonConfig = {
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
};

// General API rate limit - 200 requests per minute per IP/user
const generalLimiter = rateLimit({
  ...commonConfig,
  store: createStore('gen'),
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  message: {
    success: false,
    error: 'Too many requests, please try again later.'
  },
  handler: rateLimitHandler,
  keyGenerator,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

// Auth endpoints - stricter to prevent brute force attacks
const authLimiter = rateLimit({
  ...commonConfig,
  store: createStore('auth'),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per 15 min
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later.'
  },
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('user-agent')
    });
    res.status(429).json({
      success: false,
      error: 'Too many authentication attempts. Please try again later.',
      retryAfter: res.getHeader('Retry-After')
    });
  },
  // Use IP for auth endpoints (before user is authenticated)
  skipSuccessfulRequests: true // Don't count successful logins toward the limit
});

// Scrape endpoint - prevents spam while respecting plan-based monthly limits
const scrapeLimiter = rateLimit({
  ...commonConfig,
  store: createStore('scrape'),
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 scrapes per minute per user
  message: {
    success: false,
    error: 'Scrape limit reached. Please wait before trying again.'
  },
  handler: (req, res) => {
    const userId = req.user?.id || req.ip;
    logger.warn('Scrape rate limit exceeded', {
      userId,
      path: req.path
    });
    res.status(429).json({
      success: false,
      error: 'Scrape rate limit reached. Please wait before trying again.',
      retryAfter: res.getHeader('Retry-After')
    });
  },
  keyGenerator
});

// Sheets endpoint - Google allows ~100/100sec, we allow 60/min
const sheetsLimiter = rateLimit({
  ...commonConfig,
  store: createStore('sheets'),
  windowMs: 60 * 1000, // 1 minute  
  max: 60, // 60 requests per minute
  message: {
    success: false,
    error: 'Too many sheets requests, please try again later.'
  },
  handler: (req, res) => {
    const userId = req.user?.id || req.ip;
    logger.warn('Sheets rate limit exceeded', {
      userId,
      path: req.path
    });
    res.status(429).json({
      success: false,
      error: 'Too many Google Sheets requests. Please wait before trying again.',
      retryAfter: res.getHeader('Retry-After')
    });
  },
  keyGenerator
});

module.exports = {
  generalLimiter,
  authLimiter,
  scrapeLimiter,
  sheetsLimiter,
  isRedisConnected
};
