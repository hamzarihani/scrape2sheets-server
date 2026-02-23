const winston = require('winston');
const path = require('path');
const Sentry = require('@sentry/node');
const SentryTransport = require('winston-transport-sentry-node').default;

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'cyan',
};

// Tell winston about our colors
winston.addColors(colors);

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Define console format with colors
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

// Define which transports to use
const transports = [
  // Console/stdout transport (Railway and other platforms capture stdout automatically)
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? format : consoleFormat,
  }),
];

// Only use file transports in development (multi-instance deploys lose per-container files)
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/error.log'),
      level: 'error',
      format,
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/combined.log'),
      format,
    })
  );
}


// Add Sentry transport only if DSN is configured
if (process.env.SENTRY_DSN) {
  transports.push(
    new SentryTransport({
      sentry: Sentry,
      level: 'error', // Only send error level logs to Sentry
      handleExceptions: true,
      handleRejections: true,
    })
  );
}


// Create the logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  transports,
  // Don't exit on uncaught errors
  exitOnError: false,
});

// Create a stream object for Morgan HTTP logging middleware
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

module.exports = logger;
