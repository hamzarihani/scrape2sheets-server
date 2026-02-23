const express = require('express');
const Stripe = require('stripe');
const { requireAuth } = require('../middleware/auth');
const { supabase } = require('../services/supabase-service');
const logger = require('../utils/logger');

const router = express.Router();

// Initialize Stripe client (will be null if config is missing)
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    logger.info('[Billing] Stripe client initialized');
  } catch (error) {
    logger.error('[Billing] Failed to initialize Stripe client:', error.message);
  }
} else {
  logger.error('[Billing] STRIPE_SECRET_KEY environment variable is missing - billing features will be disabled');
}

// Plan configuration mapping Stripe price IDs to plan details
// Filter out undefined values to prevent issues with missing env vars
const PLAN_CONFIG = {};

if (process.env.STRIPE_STARTER_PRICE_ID) {
  PLAN_CONFIG[process.env.STRIPE_STARTER_PRICE_ID] = {
    plan: 'STARTER',
    scrapes: 250,
    period: 'monthly'
  };
} else {
  logger.warn('[Billing] STRIPE_STARTER_PRICE_ID environment variable is missing');
}

if (process.env.STRIPE_PRO_PRICE_ID) {
  PLAN_CONFIG[process.env.STRIPE_PRO_PRICE_ID] = {
    plan: 'PRO',
    scrapes: 999999,
    period: 'monthly'
  };
} else {
  logger.warn('[Billing] STRIPE_PRO_PRICE_ID environment variable is missing');
}

// Log configuration status on startup
logger.info('[Billing] Stripe configuration loaded', {
  hasSecretKey: !!process.env.STRIPE_SECRET_KEY,
  hasStarterPriceId: !!process.env.STRIPE_STARTER_PRICE_ID,
  hasProPriceId: !!process.env.STRIPE_PRO_PRICE_ID,
  configuredPlans: Object.keys(PLAN_CONFIG).length,
  starterPriceId: process.env.STRIPE_STARTER_PRICE_ID ? process.env.STRIPE_STARTER_PRICE_ID.substring(0, 20) + '...' : 'not set',
  proPriceId: process.env.STRIPE_PRO_PRICE_ID ? process.env.STRIPE_PRO_PRICE_ID.substring(0, 20) + '...' : 'not set',
  configuredPriceIds: Object.keys(PLAN_CONFIG).map(id => id.substring(0, 20) + '...')
});

/**
 * POST /api/billing/checkout
 * Create a Stripe Checkout Session for upgrading to a paid plan
 */
router.post('/checkout', requireAuth, async (req, res) => {
  try {
    // Check if Stripe is properly configured
    if (!stripe) {
      logger.error('[Billing] Stripe not configured - STRIPE_SECRET_KEY missing or invalid');
      return res.status(503).json({
        success: false,
        error: 'Billing service is not configured. Please contact support.'
      });
    }

    if (Object.keys(PLAN_CONFIG).length === 0) {
      logger.error('[Billing] No price IDs configured');
      return res.status(503).json({
        success: false,
        error: 'Billing plans are not configured. Please contact support.'
      });
    }

    const { targetPlan } = req.body;

    logger.info('[Billing] Checkout request received', {
      userId: req.userId,
      targetPlan
    });

    if (!targetPlan) {
      logger.warn('[Billing] Missing targetPlan in request');
      return res.status(400).json({ success: false, error: 'Missing targetPlan' });
    }

    let priceId;
    switch (targetPlan.toLowerCase()) {
      case 'starter':
        priceId = process.env.STRIPE_STARTER_PRICE_ID;
        break;
      case 'pro':
        priceId = process.env.STRIPE_PRO_PRICE_ID;
        break;
      default:
        logger.warn('[Billing] Invalid targetPlan received', { targetPlan });
        return res.status(400).json({ success: false, error: 'Invalid plan selected' });
    }

    if (!priceId) {
      logger.error('[Billing] Price ID not configured for plan', { targetPlan });
      return res.status(503).json({
        success: false,
        error: 'The selected plan is not currently available. Please contact support.'
      });
    }

    // Validate priceId exists in PLAN_CONFIG
    if (!PLAN_CONFIG[priceId]) {
      logger.warn('[Billing] Price ID not found in PLAN_CONFIG', {
        priceId: priceId.substring(0, 20) + '...',
        targetPlan
      });
      return res.status(503).json({
        success: false,
        error: 'Billing configuration error. Please contact support.'
      });
    }

    // User is already attached to req (full profile from cache/DB)
    const user = req.user;

    // Get or create Stripe customer
    let customerId = user.stripe_customer_id;

    if (!customerId) {
      // Get user email from Supabase auth
      const { data: { user: authUser } } = await supabase.auth.admin.getUserById(req.userId);

      const customer = await stripe.customers.create({
        email: authUser?.email,
        metadata: { supabase_user_id: req.userId }
      });
      customerId = customer.id;

      await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', req.userId);
    } else {
      // Verify customer exists in Stripe, if not, create a new one
      try {
        await stripe.customers.retrieve(customerId);
      } catch (error) {
        logger.warn('[Billing] Customer ID in DB does not exist in Stripe, creating new customer', { customerId, userId: req.userId });

        // Get user email from Supabase auth
        const { data: { user: authUser } } = await supabase.auth.admin.getUserById(req.userId);
        const customer = await stripe.customers.create({
          email: authUser?.email,
          metadata: { supabase_user_id: req.userId }
        });
        customerId = customer.id;

        // Update database with new customer ID
        await supabase
          .from('users')
          .update({ stripe_customer_id: customerId })
          .eq('id', req.userId);
      }
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/?checkout=success`,
      cancel_url: `${process.env.FRONTEND_URL}/?checkout=cancelled`,
      metadata: { supabase_user_id: req.userId },
      subscription_data: {
        metadata: { supabase_user_id: req.userId }
      }
    });

    logger.info('[Billing] Checkout session created', {
      userId: req.userId,
      sessionId: session.id,
      hasUrl: !!session.url,
      url: session.url ? session.url.substring(0, 50) + '...' : null
    });

    if (!session.url) {
      logger.error('[Billing] Checkout session created but URL is missing', {
        sessionId: session.id,
        session: JSON.stringify(session).substring(0, 200)
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to generate checkout URL. Please try again.'
      });
    }

    res.json({ success: true, url: session.url });
  } catch (error) {
    logger.error('[Billing] Checkout error:', {
      error: error.message,
      errorType: error.type,
      errorCode: error.code,
      stack: error.stack,
      userId: req.userId,
      priceId: req.body?.priceId ? req.body.priceId.substring(0, 20) + '...' : null
    });

    // Provide more specific error messages based on error type
    let errorMessage = 'Failed to create checkout session';
    let statusCode = 500;

    // Handle Stripe-specific errors
    if (error.type === 'StripeInvalidRequestError') {
      errorMessage = error.message || 'Invalid Stripe request. Please check your configuration.';
      statusCode = 400;
    } else if (error.type === 'StripeAuthenticationError') {
      errorMessage = 'Stripe authentication failed. Please check your API keys.';
      statusCode = 500;
    } else if (error.type === 'StripeAPIError') {
      errorMessage = 'Stripe API error. Please try again later.';
      statusCode = 502;
    } else if (error.message) {
      errorMessage = error.message;
    }

    // Don't expose internal error details in production (but always show Stripe configuration errors)
    if (process.env.NODE_ENV === 'production' && statusCode === 500 && error.type !== 'StripeInvalidRequestError') {
      errorMessage = 'An error occurred while processing your request. Please try again.';
    }

    res.status(statusCode).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/billing/portal
 * Create a Stripe Customer Portal session for managing subscription
 */
router.post('/portal', requireAuth, async (req, res) => {
  try {
    // Check if Stripe is properly configured
    if (!stripe) {
      logger.error('[Billing] Stripe not configured - cannot create portal session');
      return res.status(503).json({ 
        success: false, 
        error: 'Billing service is not configured. Please contact support.' 
      });
    }

    const user = req.user;

    if (!user?.stripe_customer_id) {
      return res.status(400).json({ success: false, error: 'No billing account found. Please subscribe first.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/`
    });

    logger.info('[Billing] Portal session created', { userId: req.userId });

    res.json({ success: true, url: session.url });
  } catch (error) {
    logger.error('[Billing] Portal error:', error);
    res.status(500).json({ success: false, error: 'Failed to create portal session' });
  }
});

/**
 * GET /api/billing/status
 * Return current plan, usage, and subscription status
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    res.json({
      success: true,
      billing: {
        plan: user.plan,
        usage: user.usage_this_month,
        limit: user.plan_limits_scrapes,
        period: user.plan_limits_period,
        subscriptionStatus: user.subscription_status,
        billingDate: user.billing_date
      }
    });
  } catch (error) {
    logger.error('[Billing] Status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get billing status' });
  }
});

/**
 * GET /api/billing/config
 * Return configured Stripe price IDs (for debugging - shows partial IDs only)
 */
router.get('/config', requireAuth, async (req, res) => {
  try {
    const configuredPriceIds = Object.keys(PLAN_CONFIG);
    res.json({
      success: true,
      config: {
        hasStripeClient: !!stripe,
        configuredPlansCount: configuredPriceIds.length,
        starterPriceIdPrefix: process.env.STRIPE_STARTER_PRICE_ID 
          ? process.env.STRIPE_STARTER_PRICE_ID.substring(0, 20) + '...' 
          : 'not set',
        proPriceIdPrefix: process.env.STRIPE_PRO_PRICE_ID 
          ? process.env.STRIPE_PRO_PRICE_ID.substring(0, 20) + '...' 
          : 'not set',
        configuredPriceIdsPrefix: configuredPriceIds.map(id => id.substring(0, 20) + '...')
      }
    });
  } catch (error) {
    logger.error('[Billing] Config error:', error);
    res.status(500).json({ success: false, error: 'Failed to get billing config' });
  }
});

/**
 * POST /api/billing/webhook
 * Handle Stripe webhook events
 * NOTE: This route uses raw body parsing (configured in server.js)
 */
router.post('/webhook', async (req, res) => {
  // Check if Stripe is properly configured
  if (!stripe) {
    logger.error('[Billing] Stripe not configured - cannot process webhook');
    return res.status(503).send('Billing service is not configured');
  }

  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.error('[Billing] Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  logger.info('[Billing] Webhook received:', { type: event.type });

  const { invalidateUserCache } = require('../services/user-cache-service');

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        const subscriptionId = session.subscription;

        if (!userId || !subscriptionId) break;

        // Get subscription to find the price
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price?.id;
        const planConfig = PLAN_CONFIG[priceId];

        if (!planConfig) {
          logger.warn('[Billing] Unknown price ID in checkout:', priceId);
          break;
        }

        await supabase
          .from('users')
          .update({
            plan: planConfig.plan,
            plan_limits_scrapes: planConfig.scrapes,
            plan_limits_period: planConfig.period,
            stripe_subscription_id: subscriptionId,
            subscription_status: 'active',
            usage_this_month: 0,
            billing_date: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);

        await invalidateUserCache(userId);
        logger.info('[Billing] User upgraded and cache invalidated', { userId, plan: planConfig.plan });
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) break;

        const priceId = subscription.items.data[0]?.price?.id;
        const planConfig = PLAN_CONFIG[priceId];

        const updateData = {
          subscription_status: subscription.status,
          updated_at: new Date().toISOString()
        };

        // If plan changed (upgrade/downgrade)
        if (planConfig) {
          updateData.plan = planConfig.plan;
          updateData.plan_limits_scrapes = planConfig.scrapes;
          updateData.plan_limits_period = planConfig.period;
        }

        await supabase
          .from('users')
          .update(updateData)
          .eq('id', userId);

        await invalidateUserCache(userId);
        logger.info('[Billing] Subscription updated and cache invalidated', { userId, status: subscription.status });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) break;

        await supabase
          .from('users')
          .update({
            plan: 'FREE',
            plan_limits_scrapes: 5,
            plan_limits_period: 'monthly',
            stripe_subscription_id: null,
            subscription_status: 'canceled',
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);

        await invalidateUserCache(userId);
        logger.info('[Billing] Subscription canceled, downgraded and cache invalidated', { userId });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        // Find user by subscription ID
        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('stripe_subscription_id', subscriptionId)
          .single();

        if (user) {
          await supabase
            .from('users')
            .update({
              subscription_status: 'past_due',
              updated_at: new Date().toISOString()
            })
            .eq('id', user.id);

          await invalidateUserCache(user.id);
          logger.warn('[Billing] Payment failed and cache invalidated', { userId: user.id });
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        // Only reset usage on renewal invoices (not the first one)
        if (invoice.billing_reason === 'subscription_cycle') {
          const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('stripe_subscription_id', subscriptionId)
            .single();

          if (user) {
            await supabase
              .from('users')
              .update({
                usage_this_month: 0,
                subscription_status: 'active',
                billing_date: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('id', user.id);

            await invalidateUserCache(user.id);
            logger.info('[Billing] Invoice paid, usage reset and cache invalidated', { userId: user.id });
          }
        }
        break;
      }
    }
  } catch (error) {
    logger.error('[Billing] Webhook handler error:', error);
    // Return 200 anyway to prevent Stripe from retrying
  }

  res.json({ received: true });
});

module.exports = router;
