#!/usr/bin/env node

/**
 * Test Graceful Shutdown
 * 
 * This script tests the graceful shutdown functionality
 * by starting the server and sending a SIGTERM signal.
 * 
 * Usage: node test-graceful-shutdown.js
 */

const { spawn } = require('child_process');
const http = require('http');

console.log('🧪 Testing Graceful Shutdown\n');

// Start the server
console.log('1️⃣  Starting server...');
const serverProcess = spawn('node', ['server.js'], {
  stdio: 'pipe',
  env: { ...process.env, PORT: '4001' } // Use different port for testing
});

let serverReady = false;
let shutdownStarted = false;

serverProcess.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(`   ${output.trim()}`);
  
  if (output.includes('Server running on port')) {
    serverReady = true;
  }
  
  if (output.includes('Starting graceful shutdown')) {
    shutdownStarted = true;
  }
  
  if (output.includes('Graceful shutdown complete')) {
    console.log('\n✅ Graceful shutdown completed successfully!\n');
  }
});

serverProcess.stderr.on('data', (data) => {
  console.error(`   Error: ${data.toString().trim()}`);
});

serverProcess.on('exit', (code) => {
  if (shutdownStarted && code === 0) {
    console.log('✅ Test passed: Server shut down gracefully with exit code 0\n');
    process.exit(0);
  } else if (code !== 0) {
    console.error(`❌ Test failed: Server exited with code ${code}\n`);
    process.exit(1);
  }
});

// Wait for server to start, then test health check and shutdown
setTimeout(async () => {
  if (!serverReady) {
    console.error('❌ Server failed to start in time');
    serverProcess.kill('SIGTERM');
    setTimeout(() => process.exit(1), 2000);
    return;
  }

  console.log('\n2️⃣  Testing health check endpoint...');
  
  try {
    const response = await new Promise((resolve, reject) => {
      http.get('http://localhost:4001/health', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
      }).on('error', reject);
    });

    if (response.status === 200 && response.data.status === 'ok') {
      console.log('   ✅ Health check passed');
      console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
    } else {
      console.error('   ❌ Health check failed');
      serverProcess.kill('SIGKILL');
      process.exit(1);
    }
  } catch (error) {
    console.error(`   ❌ Health check error: ${error.message}`);
    serverProcess.kill('SIGKILL');
    process.exit(1);
  }

  console.log('\n3️⃣  Sending SIGTERM signal (simulating Railway shutdown)...');
  serverProcess.kill('SIGTERM');

  // Give it time to shut down gracefully
  setTimeout(() => {
    if (serverProcess.exitCode === null) {
      console.error('❌ Server did not shut down in time');
      serverProcess.kill('SIGKILL');
      process.exit(1);
    }
  }, 30000); // 30 second timeout

}, 3000); // Wait 3 seconds for server to start

// Handle script interruption
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Test interrupted');
  serverProcess.kill('SIGKILL');
  process.exit(1);
});

