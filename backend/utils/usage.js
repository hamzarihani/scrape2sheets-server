const logger = require('./logger');

/**
 * Check and lazily reset monthly usage if billing period has rolled over.
 * Mutates the user object in-place if reset occurs.
 *
 * @param {Object} supabase - Supabase client
 * @param {Object} user - User row (must include billing_date, usage_this_month)
 * @param {string} userId - User UUID
 * @returns {Promise<void>}
 */
async function resetMonthlyUsageIfNeeded(supabase, user, userId) {
  if (!user.billing_date) return;

  const billingDate = new Date(user.billing_date);
  const now = new Date();
  const monthsSince =
    (now.getFullYear() - billingDate.getFullYear()) * 12 +
    (now.getMonth() - billingDate.getMonth());

  if (monthsSince >= 1) {
    await supabase
      .from('users')
      .update({
        usage_this_month: 0,
        billing_date: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', userId);

    user.usage_this_month = 0;
    user.billing_date = now.toISOString();
    logger.info('[Usage] Monthly usage reset for user', { userId });
  }
}

/**
 * Get the effective scrape limit for a user, accounting for past_due status.
 * @param {Object} user - User row
 * @returns {number}
 */
function getEffectiveLimit(user) {
  return user.subscription_status === 'past_due' ? 5 : user.plan_limits_scrapes;
}

module.exports = { resetMonthlyUsageIfNeeded, getEffectiveLimit };
