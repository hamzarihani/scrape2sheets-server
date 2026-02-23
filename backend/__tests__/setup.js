// Jest test setup

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.PORT = '4001';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_STARTER_PRICE_ID = 'price_starter_test';
process.env.STRIPE_PRO_PRICE_ID = 'price_pro_test';
process.env.FRONTEND_URL = 'http://localhost:3000';

// Silence console logs during tests (optional - comment out to debug)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };
