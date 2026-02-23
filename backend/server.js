const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Initialize Sentry BEFORE everything else
require('./instrument');


// Initialize Sentry BEFORE requiring logger
const Sentry = require('@sentry/node');


const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const logger = require('./utils/logger');
const { requireAuth } = require('./middleware/auth');
const authRouter = require('./routes/auth');
const userRouter = require('./routes/user');
const scrapeRouter = require('./routes/scrape');
const sheetsRouter = require('./routes/sheets');
const billingRouter = require('./routes/billing');
const helmet = require('helmet');
const { generalLimiter, authLimiter, scrapeLimiter, sheetsLimiter } = require('./middleware/rate-limit');
const pkg = require('./package.json');

// Global error handlers - catch errors outside Express middleware
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection:', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: promise.toString()
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', {
    error: error.message,
    stack: error.stack
  });
  
  // Give logger and Sentry time to flush
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error);
    Sentry.close(2000).then(() => {
      process.exit(1);
    });
  } else {
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
});

const app = express();

// CORS configuration - Allow frontend AND Chrome extension
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173', // Vite dev server
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (Postman, curl, mobile apps)
    if (!origin) {
      return callback(null, true);
    }
    
    // Check web origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Check Chrome extension origins
    if (origin.startsWith('chrome-extension://')) {
      // In production, validate specific extension ID
      if (process.env.NODE_ENV === 'production' && process.env.EXTENSION_ID) {
        if (origin === `chrome-extension://${process.env.EXTENSION_ID}`) {
          return callback(null, true);
        }
      } else {
        // In development, allow any extension
        return callback(null, true);
      }
    }
    
    // Block all other origins
    logger.warn('CORS blocked origin:', { origin });
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(helmet());

// Stripe webhook needs raw body for signature verification - must be before express.json()
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev', { stream: logger.stream }));

// Request ID middleware for distributed tracing
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
});

// Apply general rate limiter to all routes
app.use(generalLimiter);

// Request timeout middleware (2 minutes for scraping requests)
app.use((req, res, next) => {
  const timeout = req.path.includes('/api/scrape') ? 120000 : 30000; // 2min for scrape, 30s for others
  req.setTimeout(timeout);
  res.setTimeout(timeout);
  next();
});

const { isRedisConnected } = require('./services/redis-service');
const { supabase } = require('./services/supabase-service');

// Health check for Railway and monitoring
let isShuttingDown = false;

app.get('/health', async (_req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({ status: 'shutting_down' });
  }

  // Check Redis status
  const redisHealthy = isRedisConnected();

  // Check Supabase status
  let supabaseHealthy = false;
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    supabaseHealthy = !error;
  } catch (err) {
    logger.error('[Health] Supabase check failed:', err);
  }

  const isHealthy = redisHealthy && supabaseHealthy;

  const healthData = {
    status: isHealthy ? 'ok' : 'degraded',
    version: pkg.version,
    uptime: process.uptime(),
    services: {
      redis: redisHealthy ? 'ok' : 'error',
      supabase: supabaseHealthy ? 'ok' : 'error',
    },
    system: {
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    }
  };

  return res.status(isHealthy ? 200 : 207).json(healthData);
});

// Test endpoint for Sentry (remove in production)
// app.get('/debug-sentry', function mainHandler(req, res) {
// throw new Error("My first Sentry error!");
//});

// Public routes (no auth required)
app.use('/api/auth', authLimiter, authRouter);

// Protected routes (auth required)
app.use('/api/user', userRouter);
app.use('/api/scrape', scrapeLimiter, scrapeRouter);
app.use('/api/sheets', sheetsLimiter, sheetsRouter);
app.use('/api/billing', billingRouter);

if (process.env.SENTRY_DSN) {
  const Sentry = require('./instrument');
  Sentry.setupExpressErrorHandler(app);
}

// Error handler
app.use((err, _req, res, _next) => {
  logger.error('Request error:', { error: err.message, stack: err.stack });
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});

const port = process.env.PORT || 4000;

let server;

if (require.main === module) {
  server = app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Health check available at /health`);
  });

  // Track active connections for graceful shutdown
  const connections = new Set();
  
  server.on('connection', (connection) => {
    connections.add(connection);
    connection.on('close', () => {
      connections.delete(connection);
    });
  });

  /**
   * Graceful shutdown handler
   */
  async function gracefulShutdown(signal) {
    logger.info(`${signal} received: Starting graceful shutdown...`);
    isShuttingDown = true;
    
    // Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed - no longer accepting connections');
    });

    const forceShutdownTimeout = setTimeout(() => {
      logger.error('Forced shutdown: Timeout exceeded');
      process.exit(1);
    }, 25000);

    try {
      connections.forEach((connection) => {
        connection.destroy();
      });
      connections.clear();

      logger.info('Flushing logs...');
      await new Promise((resolve) => {
        logger.on('finish', resolve);
        logger.end();
      });

      if (process.env.SENTRY_DSN) {
        logger.info('Flushing Sentry events...');
        await Sentry.close(2000);
      }

      logger.info('Graceful shutdown complete');
      clearTimeout(forceShutdownTimeout);
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      clearTimeout(forceShutdownTimeout);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
  if (process.platform === 'win32') {
    process.on('SIGBREAK', () => gracefulShutdown('SIGBREAK'));
  }
}

module.exports = app;
