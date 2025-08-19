#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('Starting HTTP Wrapper Server...');
console.log('This server will maintain a persistent connection to the MCP server.');
console.log('');

// Start the HTTP wrapper server
const serverProcess = spawn('node', [path.join(__dirname, 'http-wrapper.js')], {
  stdio: 'inherit',
  cwd: __dirname,
});

// Handle process events
serverProcess.on('error', (error) => {
  console.error('Failed to start HTTP wrapper server:', error);
  process.exit(1);
});

serverProcess.on('exit', (code) => {
  if (code !== 0) {
    console.error(`HTTP wrapper server exited with code ${code}`);
    process.exit(code);
  }
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\nShutting down HTTP wrapper server...');
  serverProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\nShutting down HTTP wrapper server...');
  serverProcess.kill('SIGTERM');
});

console.log('HTTP Wrapper Server started successfully!');
console.log('Server will be available at: http://127.0.0.1:12307');
console.log('Press Ctrl+C to stop the server');
console.log('');
