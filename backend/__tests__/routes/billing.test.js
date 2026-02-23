// Mock dependencies before requiring the module
jest.mock('../../services/supabase-service', () => ({
  supabase: {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(),
    update: jest.fn().mockReturnThis(),
    auth: {
      admin: {
        getUserById: jest.fn()
      }
    }
  }
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

// Plan configuration for testing
const PLAN_CONFIG = {
  'price_starter_test': {
    plan: 'STARTER',
    scrapes: 250,
    period: 'monthly'
  },
  'price_pro_test': {
    plan: 'PRO',
    scrapes: 999999,
    period: 'monthly'
  }
};

describe('Billing Configuration', () => {
  describe('Plan Configuration', () => {
    it('should have STARTER plan configured', () => {
      expect(PLAN_CONFIG['price_starter_test']).toBeDefined();
      expect(PLAN_CONFIG['price_starter_test'].plan).toBe('STARTER');
      expect(PLAN_CONFIG['price_starter_test'].scrapes).toBe(250);
    });

    it('should have PRO plan configured', () => {
      expect(PLAN_CONFIG['price_pro_test']).toBeDefined();
      expect(PLAN_CONFIG['price_pro_test'].plan).toBe('PRO');
      expect(PLAN_CONFIG['price_pro_test'].scrapes).toBe(999999);
    });

    it('should return undefined for unknown price ID', () => {
      expect(PLAN_CONFIG['price_unknown']).toBeUndefined();
    });
  });
});

describe('Stripe Webhook Event Handling', () => {
  // Simulate webhook event handling logic
  const handleWebhookEvent = async (event, supabase, stripe) => {
    const results = { updated: false, plan: null, status: null };

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        const subscriptionId = session.subscription;

        if (!userId || !subscriptionId) {
          return { ...results, error: 'Missing userId or subscriptionId' };
        }

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price?.id;
        const planConfig = PLAN_CONFIG[priceId];

        if (!planConfig) {
          return { ...results, error: 'Unknown price ID' };
        }

        results.updated = true;
        results.plan = planConfig.plan;
        results.status = 'active';
        return results;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.supabase_user_id;

        if (!userId) {
          return { ...results, error: 'Missing userId' };
        }

        results.updated = true;
        results.plan = 'FREE';
        results.status = 'canceled';
        return results;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (!subscriptionId) {
          return { ...results, error: 'Missing subscriptionId' };
        }

        results.updated = true;
        results.status = 'past_due';
        return results;
      }

      default:
        return results;
    }
  };

  describe('checkout.session.completed', () => {
    it('should upgrade user to STARTER plan', async () => {
      const mockStripe = {
        subscriptions: {
          retrieve: jest.fn().mockResolvedValue({
            items: {
              data: [{ price: { id: 'price_starter_test' } }]
            }
          })
        }
      };

      const event = {
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: { supabase_user_id: 'user-123' },
            subscription: 'sub_test123'
          }
        }
      };

      const result = await handleWebhookEvent(event, null, mockStripe);

      expect(result.updated).toBe(true);
      expect(result.plan).toBe('STARTER');
      expect(result.status).toBe('active');
    });

    it('should upgrade user to PRO plan', async () => {
      const mockStripe = {
        subscriptions: {
          retrieve: jest.fn().mockResolvedValue({
            items: {
              data: [{ price: { id: 'price_pro_test' } }]
            }
          })
        }
      };

      const event = {
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: { supabase_user_id: 'user-123' },
            subscription: 'sub_test123'
          }
        }
      };

      const result = await handleWebhookEvent(event, null, mockStripe);

      expect(result.updated).toBe(true);
      expect(result.plan).toBe('PRO');
      expect(result.status).toBe('active');
    });

    it('should handle missing user ID', async () => {
      const event = {
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: {},
            subscription: 'sub_test123'
          }
        }
      };

      const result = await handleWebhookEvent(event, null, {});

      expect(result.error).toBe('Missing userId or subscriptionId');
    });

    it('should handle unknown price ID', async () => {
      const mockStripe = {
        subscriptions: {
          retrieve: jest.fn().mockResolvedValue({
            items: {
              data: [{ price: { id: 'price_unknown' } }]
            }
          })
        }
      };

      const event = {
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: { supabase_user_id: 'user-123' },
            subscription: 'sub_test123'
          }
        }
      };

      const result = await handleWebhookEvent(event, null, mockStripe);

      expect(result.error).toBe('Unknown price ID');
    });
  });

  describe('customer.subscription.deleted', () => {
    it('should downgrade user to FREE plan', async () => {
      const event = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            metadata: { supabase_user_id: 'user-123' }
          }
        }
      };

      const result = await handleWebhookEvent(event, null, null);

      expect(result.updated).toBe(true);
      expect(result.plan).toBe('FREE');
      expect(result.status).toBe('canceled');
    });

    it('should handle missing user ID', async () => {
      const event = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            metadata: {}
          }
        }
      };

      const result = await handleWebhookEvent(event, null, null);

      expect(result.error).toBe('Missing userId');
    });
  });

  describe('invoice.payment_failed', () => {
    it('should mark subscription as past_due', async () => {
      const event = {
        type: 'invoice.payment_failed',
        data: {
          object: {
            subscription: 'sub_test123'
          }
        }
      };

      const result = await handleWebhookEvent(event, null, null);

      expect(result.updated).toBe(true);
      expect(result.status).toBe('past_due');
    });

    it('should handle missing subscription ID', async () => {
      const event = {
        type: 'invoice.payment_failed',
        data: {
          object: {}
        }
      };

      const result = await handleWebhookEvent(event, null, null);

      expect(result.error).toBe('Missing subscriptionId');
    });
  });

  describe('Unknown Events', () => {
    it('should ignore unknown event types', async () => {
      const event = {
        type: 'unknown.event.type',
        data: { object: {} }
      };

      const result = await handleWebhookEvent(event, null, null);

      expect(result.updated).toBe(false);
    });
  });
});

describe('Billing Checkout Validation', () => {
  describe('Price ID Validation', () => {
    it('should accept valid STARTER price ID', () => {
      const priceId = 'price_starter_test';
      const isValid = !!PLAN_CONFIG[priceId];

      expect(isValid).toBe(true);
    });

    it('should accept valid PRO price ID', () => {
      const priceId = 'price_pro_test';
      const isValid = !!PLAN_CONFIG[priceId];

      expect(isValid).toBe(true);
    });

    it('should reject invalid price ID', () => {
      const priceId = 'price_invalid';
      const isValid = !!PLAN_CONFIG[priceId];

      expect(isValid).toBe(false);
    });

    it('should reject empty price ID', () => {
      const priceId = '';
      const isValid = !!PLAN_CONFIG[priceId];

      expect(isValid).toBe(false);
    });

    it('should reject null price ID', () => {
      const priceId = null;
      const isValid = !!PLAN_CONFIG[priceId];

      expect(isValid).toBe(false);
    });
  });
});

describe('Usage Limit Logic', () => {
  const checkUsageLimit = (user) => {
    const effectiveLimit = user.subscription_status === 'past_due'
      ? 5
      : user.plan_limits_scrapes;

    return {
      limitReached: user.usage_this_month >= effectiveLimit,
      effectiveLimit,
      remaining: Math.max(0, effectiveLimit - user.usage_this_month)
    };
  };

  describe('FREE Plan', () => {
    it('should block when usage reaches limit', () => {
      const user = {
        plan: 'FREE',
        usage_this_month: 5,
        plan_limits_scrapes: 5,
        subscription_status: 'none'
      };

      const result = checkUsageLimit(user);

      expect(result.limitReached).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('should allow when under limit', () => {
      const user = {
        plan: 'FREE',
        usage_this_month: 3,
        plan_limits_scrapes: 5,
        subscription_status: 'none'
      };

      const result = checkUsageLimit(user);

      expect(result.limitReached).toBe(false);
      expect(result.remaining).toBe(2);
    });
  });

  describe('STARTER Plan', () => {
    it('should have 250 scrapes limit', () => {
      const user = {
        plan: 'STARTER',
        usage_this_month: 100,
        plan_limits_scrapes: 250,
        subscription_status: 'active'
      };

      const result = checkUsageLimit(user);

      expect(result.effectiveLimit).toBe(250);
      expect(result.remaining).toBe(150);
    });
  });

  describe('PRO Plan', () => {
    it('should have unlimited scrapes', () => {
      const user = {
        plan: 'PRO',
        usage_this_month: 200,
        plan_limits_scrapes: 999999,
        subscription_status: 'active'
      };

      const result = checkUsageLimit(user);

      expect(result.effectiveLimit).toBe(999999);
      expect(result.remaining).toBe(999799);
    });
  });

  describe('Past Due Subscription', () => {
    it('should enforce FREE limit (5) when subscription is past_due', () => {
      const user = {
        plan: 'PRO',
        usage_this_month: 5,
        plan_limits_scrapes: 999999,
        subscription_status: 'past_due'
      };

      const result = checkUsageLimit(user);

      expect(result.effectiveLimit).toBe(5);
      expect(result.limitReached).toBe(true);
    });

    it('should allow usage under reduced limit when past_due', () => {
      const user = {
        plan: 'STARTER',
        usage_this_month: 3,
        plan_limits_scrapes: 250,
        subscription_status: 'past_due'
      };

      const result = checkUsageLimit(user);

      expect(result.effectiveLimit).toBe(5);
      expect(result.limitReached).toBe(false);
      expect(result.remaining).toBe(2);
    });
  });
});
