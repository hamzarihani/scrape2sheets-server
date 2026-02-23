/**
 * Quick Rate Limiter Test Script
 * 
 * Usage: node test-rate-limit.js
 * 
 * Make sure your server is running on port 4000
 */

const http = require('http');

// Test configuration
const HOST = 'localhost';
const PORT = 4000;
const PATH = '/health';

async function makeRequest() {
  return new Promise((resolve) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path: PATH,
      method: 'GET',
    };

    const req = http.request(options, (res) => {
      const headers = {
        'RateLimit-Limit': res.headers['ratelimit-limit'],
        'RateLimit-Remaining': res.headers['ratelimit-remaining'],
        'RateLimit-Reset': res.headers['ratelimit-reset'],
        'Retry-After': res.headers['retry-after']
      };
      
      resolve({
        status: res.statusCode,
        headers
      });
    });

    req.on('error', (error) => {
      resolve({ error: error.message });
    });

    req.end();
  });
}

async function testRateLimit() {
  console.log('🧪 Testing Rate Limiter...\n');
  console.log('Configuration:');
  console.log('- Endpoint: http://' + HOST + ':' + PORT + PATH);
  console.log('- Expected Limit: 200 requests/minute');
  console.log('- Note: /health is excluded from rate limiting\n');

  console.log('Making 10 test requests...\n');

  for (let i = 1; i <= 10; i++) {
    const result = await makeRequest();
    
    if (result.error) {
      console.log(`❌ Request ${i}: Error - ${result.error}`);
      break;
    }

    const status = result.status === 200 ? '✅' : result.status === 429 ? '⚠️' : '❌';
    console.log(`${status} Request ${i}:`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Limit: ${result.headers['RateLimit-Limit'] || 'N/A (health endpoint)'}`);
    console.log(`   Remaining: ${result.headers['RateLimit-Remaining'] || 'N/A'}`);
    
    if (result.status === 429) {
      console.log(`   ⏱️  Retry After: ${result.headers['Retry-After']} seconds`);
    }
    console.log('');

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('\n📊 Test Complete!\n');
  console.log('To test rate limiting on a protected endpoint:');
  console.log('1. Start your server: cd backend && npm start');
  console.log('2. Change PATH to "/api/scrape/test" (limit: 30/min)');
  console.log('3. Make 31+ requests to see rate limiting in action\n');
}

// Run the test
if (require.main === module) {
  testRateLimit().catch(console.error);
}

module.exports = { testRateLimit };

