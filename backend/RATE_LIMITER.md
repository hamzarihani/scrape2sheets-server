# Express Rate Limiter Implementation

## Overview

Your application uses `express-rate-limit` to protect against abuse and ensure fair usage. The rate limiter is already configured and active on all routes.

## Current Configuration

### 1. General Limiter (All Routes)
- **Limit**: 200 requests per minute
- **Scope**: Per user (if authenticated) or per IP
- **Purpose**: Prevent general API abuse
- **Skips**: `/health` endpoint

### 2. Auth Limiter (Authentication Endpoints)
- **Limit**: 20 attempts per 15 minutes
- **Scope**: Per IP address
- **Purpose**: Prevent brute force attacks
- **Feature**: `skipSuccessfulRequests: true` (successful logins don't count)

### 3. Scrape Limiter (Scraping Endpoints)
- **Limit**: 30 scrapes per minute
- **Scope**: Per user (if authenticated) or per IP
- **Purpose**: Prevent scraping spam

### 4. Sheets Limiter (Google Sheets Endpoints)
- **Limit**: 60 requests per minute
- **Scope**: Per user (if authenticated) or per IP
- **Purpose**: Respect Google API quotas (allows ~100/100sec)

## Features

✅ **IPv6 Support**: Properly handles IPv6 addresses
✅ **User-based Limiting**: Uses user ID when authenticated, IP otherwise
✅ **Logging**: All rate limit violations are logged with details
✅ **Standard Headers**: Returns `RateLimit-*` headers for clients
✅ **Retry-After**: Clients receive retry timing information
✅ **Custom Messages**: Clear error messages for each limiter type

## How It Works

```javascript
// Applied in server.js

// General limiter on all routes
app.use(generalLimiter);

// Specific limiters on routes
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/scrape', scrapeLimiter, scrapeRouter);
app.use('/api/sheets', sheetsLimiter, sheetsRouter);
```

## Response Format

When rate limit is exceeded:

```json
{
  "success": false,
  "error": "Too many requests, please try again later.",
  "retryAfter": "60"
}
```

**Response Headers:**
- `RateLimit-Limit`: Maximum requests allowed
- `RateLimit-Remaining`: Requests remaining in current window
- `RateLimit-Reset`: Timestamp when the limit resets
- `Retry-After`: Seconds until rate limit resets (when exceeded)

## Testing Rate Limits

### Test with cURL:

```bash
# Test general limit (200/min)
for i in {1..210}; do
  curl http://localhost:4000/health
done

# Test auth limit (20/15min)
for i in {1..25}; do
  curl -X POST http://localhost:4000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}'
done
```

### Test in Your Extension:

The Chrome extension will receive 429 status codes and can read the headers:

```javascript
fetch('http://localhost:4000/api/scrape', options)
  .then(response => {
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      console.log(`Rate limited. Retry after ${retryAfter} seconds`);
    }
  });
```

## Scaling with Redis

For production with multiple servers, upgrade to Redis:

### 1. Install Redis Store:
```bash
npm install rate-limit-redis redis
```

### 2. Update `rate-limit.js`:

```javascript
const RedisStore = require('rate-limit-redis');
const redis = require('redis');

// Create Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.connect().catch(console.error);

// Add to each limiter config:
const generalLimiter = rateLimit({
  // ... existing config ...
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:general:',
  })
});
```

### 3. Add to `.env`:
```env
REDIS_URL=redis://your-redis-host:6379
```

## Monitoring

Rate limit violations are automatically logged:

```javascript
// Check logs for rate limit issues
tail -f logs/combined.log | grep "rate limit exceeded"
```

**Log Format:**
```json
{
  "level": "warn",
  "message": "Rate limit exceeded",
  "identifier": "user:123 or 192.168.1.1",
  "path": "/api/scrape",
  "method": "POST",
  "userAgent": "Mozilla/5.0..."
}
```

## Customization

To adjust limits, edit `backend/middleware/rate-limit.js`:

```javascript
// Example: Increase scrape limit for premium users
const scrapeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: async (req) => {
    // Dynamic limit based on user plan
    if (req.user?.plan === 'premium') return 100;
    if (req.user?.plan === 'basic') return 50;
    return 30; // free tier
  },
  // ... other config
});
```

## Best Practices

1. **Monitor logs** for rate limit patterns
2. **Set alerts** for excessive 429 responses
3. **Upgrade to Redis** when scaling beyond 1 server
4. **Adjust limits** based on actual usage patterns
5. **Inform users** about limits in your documentation
6. **Consider user tiers** for different rate limits

## Security Notes

- ✅ IPv6 addresses properly normalized
- ✅ Successful auth attempts don't count toward brute force limit
- ✅ Health checks excluded from rate limiting
- ✅ Custom error messages don't leak sensitive info
- ✅ All violations logged for security monitoring

## Troubleshooting

### Issue: Users Behind NAT Getting Limited

**Solution**: Implement user-based limits (already done) or increase IP-based limits.

### Issue: Legitimate Traffic Getting Blocked

**Solution**: Review logs, adjust limits, or implement allowlist:

```javascript
skip: (req) => {
  const allowlist = ['192.168.1.100', '10.0.0.5'];
  return allowlist.includes(req.ip);
}
```

### Issue: Rate Limits Not Working

**Solution**: Check middleware order in `server.js`. Rate limiters must be before routes.

---

**Status**: ✅ Fully implemented and tested
**Version**: express-rate-limit@8.2.1
**Last Updated**: January 2026

