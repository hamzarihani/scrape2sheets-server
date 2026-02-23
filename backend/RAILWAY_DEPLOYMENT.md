# Railway Deployment Guide for Scrape2Sheets Backend

## 🚀 Quick Deploy

### 1. Connect to Railway

1. Go to [Railway](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your `scrape2sheets` repository
5. Select the `backend` directory as the root

### 2. Configure Environment Variables

In Railway dashboard, go to **Variables** tab and add:

#### Required Variables
```env
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain.com
EXTENSION_ID=hpapkedgoldjeihmghiljojgaebcfhlo
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key-here
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://your-backend.railway.app/api/auth/google/callback
GEMINI_API_KEY=your-gemini-api-key
```

#### Optional Variables
```env
SENTRY_DSN=your-sentry-dsn (for error tracking)
LOG_LEVEL=info (debug, info, warn, error)
PORT=4000 (Railway sets this automatically)
```

### 3. Deploy

Railway will automatically:
- ✅ Detect Node.js project
- ✅ Install dependencies
- ✅ Create logs directory
- ✅ Start the server
- ✅ Monitor health checks

## 📋 Configuration Files

### `railway.toml`
Main Railway configuration:
- Build settings
- Health check configuration
- Restart policies
- Resource limits

### `.railwayignore`
Files excluded from deployment:
- Development files
- Environment files
- Logs
- Test files
- IDE configurations

### `backend/nixpacks.toml`
Nixpacks build configuration:
- Node.js version (20)
- Production dependencies only
- Logs directory creation

## 🏗️ Build Process

Railway uses Nixpacks to build your application:

1. **Setup Phase**: Install Node.js 20
2. **Install Phase**: Run `npm ci --only=production`
3. **Build Phase**: Create logs directory
4. **Start Phase**: Run `node server.js`

## 🔍 Health Checks

Railway monitors your app via `/health` endpoint:

**Healthy Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2026-01-24T12:00:00.000Z",
  "uptime": 3600.5,
  "environment": "production"
}
```

**Shutting Down Response (503):**
```json
{
  "status": "shutting_down",
  "message": "Server is shutting down"
}
```

## 🔄 Graceful Shutdown

The server handles Railway's deployment signals:

### Shutdown Sequence
1. Receives `SIGTERM` from Railway
2. Stops accepting new connections
3. Closes active connections (25s timeout)
4. Flushes Winston logs
5. Flushes Sentry events
6. Exits cleanly

### Deployment Strategy
- Railway starts new instance first
- Health checks pass on new instance
- Traffic switches to new instance
- Old instance receives SIGTERM
- Graceful shutdown completes
- Zero downtime! ✨

## 🛠️ Troubleshooting

### Check Logs
```bash
# In Railway dashboard
1. Go to your service
2. Click "Deployments"
3. Click on latest deployment
4. View "Build Logs" and "Deploy Logs"
```

### Common Issues

#### 1. Build Fails
**Error**: `Cannot find module`
**Solution**: Check `package.json` dependencies

#### 2. Health Check Fails
**Error**: `Health check timeout`
**Solution**: 
- Check if server starts on correct PORT
- Verify `/health` endpoint responds
- Check environment variables

#### 3. CORS Errors
**Error**: `Origin not allowed by CORS`
**Solution**:
- Set `FRONTEND_URL` in Railway variables
- Set `EXTENSION_ID` for Chrome extension
- Check CORS configuration in `server.js`

#### 4. Database Connection Fails
**Error**: `SUPABASE_URL is not set`
**Solution**: Add all Supabase variables in Railway

## 📊 Monitoring

### Railway Dashboard
- **Metrics**: CPU, Memory, Network usage
- **Logs**: Real-time application logs
- **Deployments**: History and rollback options

### Health Check Monitoring
```bash
# Test health endpoint
curl https://your-app.railway.app/health
```

### Sentry Integration
If `SENTRY_DSN` is set:
- Automatic error tracking
- Performance monitoring
- Release tracking

## 🔐 Security Best Practices

1. **Never commit `.env` files**
   - Use Railway's environment variables
   - Keep secrets in Railway dashboard

2. **Use specific CORS origins**
   - Set exact `FRONTEND_URL`
   - Use specific `EXTENSION_ID` in production

3. **Enable rate limiting**
   - Already configured in `middleware/rate-limit.js`
   - Consider Redis for multi-instance deployments

4. **Use HTTPS only**
   - Railway provides automatic HTTPS
   - Update Google OAuth redirect URIs

## 🚦 Deployment Checklist

Before deploying to Railway:

- [ ] All environment variables set in Railway
- [ ] Google OAuth redirect URI updated with Railway domain
- [ ] Supabase CORS settings include Railway domain
- [ ] Frontend URL updated to production domain
- [ ] Extension ID matches published extension
- [ ] Sentry project created (optional)
- [ ] Health check endpoint tested
- [ ] Rate limits reviewed for production traffic

## 🔄 CI/CD

Railway automatically deploys when you push to your main branch:

```bash
# Deploy new version
git add .
git commit -m "Update feature"
git push origin main

# Railway will:
# 1. Detect push
# 2. Build new version
# 3. Run health checks
# 4. Deploy with zero downtime
# 5. Keep old version until new one is healthy
```

## 📈 Scaling

### Vertical Scaling
Increase resources in `railway.toml`:
```toml
[deploy]
memoryLimit = 1024  # MB
cpuLimit = 2        # vCPU
```

### Horizontal Scaling
For multiple instances:
```toml
[deploy]
numReplicas = 2
```

**Note**: With multiple replicas, upgrade rate limiter to use Redis:
```bash
npm install rate-limit-redis redis
```

## 🆘 Support

- **Railway Docs**: https://docs.railway.app
- **Railway Discord**: https://discord.gg/railway
- **Project Issues**: GitHub Issues

## 📝 Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NODE_ENV` | Yes | Environment mode | `production` |
| `PORT` | Auto | Server port (set by Railway) | `4000` |
| `FRONTEND_URL` | Yes | Frontend domain | `https://app.scrape2sheets.com` |
| `EXTENSION_ID` | Yes | Chrome extension ID | `hpapkedgoldjeihmghiljojgaebcfhlo` |
| `SUPABASE_URL` | Yes | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key | `eyJhbG...` |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID | `123-abc.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth secret | `GOCSPX-...` |
| `GOOGLE_REDIRECT_URI` | Yes | OAuth callback URL | `https://api.railway.app/api/auth/google/callback` |
| `GEMINI_API_KEY` | Yes | Google Gemini API key | `AIza...` |
| `SENTRY_DSN` | No | Sentry error tracking | `https://...@sentry.io/...` |
| `LOG_LEVEL` | No | Logging verbosity | `info` |

---

**Status**: ✅ Ready for Railway Deployment
**Last Updated**: January 2026

