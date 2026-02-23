# Environment Variables Template

Copy these to your Railway dashboard under the **Variables** tab.

## Required Variables

```env
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain.com
EXTENSION_ID=hpapkedgoldjeihmghiljojgaebcfhlo
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key-here
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://your-backend.railway.app/api/auth/google/callback
GEMINI_API_KEY=your-gemini-api-key
```

## Optional Variables

```env
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
LOG_LEVEL=info
```

## Stripe Billing Variables

```env
STRIPE_SECRET_KEY=sk_live_your_stripe_secret_key
STRIPE_STARTER_PRICE_ID=price_1SwmDDDOZ8j6nCQTdVETqmDa
STRIPE_PRO_PRICE_ID=price_1SwmDVDOZ8j6nCQTbxftCP6i
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

## Local Development

For local development, create a `.env` file in the project root with:

```env
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:3000
EXTENSION_ID=your-local-extension-id
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
GEMINI_API_KEY=your-gemini-api-key
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_STARTER_PRICE_ID=price_1SwmDDDOZ8j6nCQTdVETqmDa
STRIPE_PRO_PRICE_ID=price_1SwmDVDOZ8j6nCQTbxftCP6i
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

## Notes

- `PORT` is automatically set by Railway (don't set manually)
- Never commit `.env` files to git
- Use Railway's environment variables for production
- Update `GOOGLE_REDIRECT_URI` to match your Railway domain

