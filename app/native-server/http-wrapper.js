#!/usr/bin/env node

const http = require('http');
const url = require('url');

// Import MCP client
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

// Configuration
const PORT = 12307;
const MCP_SERVER_URL = 'http://127.0.0.1:12306/mcp';

// MCP client instance and state management
let mcpClient = null;
let isInitializing = false;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000; // 2 seconds

// Initialize MCP client
async function initializeMcpClient() {
  // Prevent multiple simultaneous initializations
  if (isInitializing) {
    console.log('MCP client initialization already in progress, skipping...');
    return false;
  }

  if (isConnected && mcpClient) {
    console.log('MCP client already connected, skipping initialization...');
    return true;
  }

  isInitializing = true;

  try {
    console.log('Initializing MCP client...');

    // Close existing client if it exists
    if (mcpClient) {
      try {
        await mcpClient.close();
      } catch (closeError) {
        console.log('Error closing existing client:', closeError.message);
      }
      mcpClient = null;
    }

    mcpClient = new Client(
      {
        name: 'HTTP-Wrapper-Client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );

    const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), {});
    await mcpClient.connect(transport);

    isConnected = true;
    reconnectAttempts = 0;
    console.log('MCP client connected successfully');

    // Set up connection monitoring
    setupConnectionMonitoring();

    return true;
  } catch (error) {
    console.error('Failed to initialize MCP client:', error);
    isConnected = false;

    // Attempt reconnection if we haven't exceeded max attempts
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      console.log(
        `Reconnection attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS} in ${RECONNECT_DELAY}ms...`,
      );
      setTimeout(() => {
        reconnectAttempts++;
        initializeMcpClient();
      }, RECONNECT_DELAY);
    } else {
      console.error('Max reconnection attempts reached. Manual intervention required.');
    }

    return false;
  } finally {
    isInitializing = false;
  }
}

// Monitor connection health and reconnect if needed
function setupConnectionMonitoring() {
  if (!mcpClient) return;

  // Check connection health every 30 seconds
  const healthCheckInterval = setInterval(async () => {
    if (!mcpClient || !isConnected) {
      clearInterval(healthCheckInterval);
      return;
    }

    try {
      // Send a simple ping to check if connection is alive
      await mcpClient.sendRequest({
        jsonrpc: '2.0',
        id: 'health-check',
        method: 'ping',
        params: {},
      });
    } catch (error) {
      console.log('Connection health check failed, attempting reconnection...');
      isConnected = false;
      clearInterval(healthCheckInterval);
      await initializeMcpClient();
    }
  }, 30000);
}

// Send request to MCP server using proper client
async function sendToMcpServer(message) {
  if (!mcpClient || !isConnected) {
    throw new Error('MCP client not initialized or not connected');
  }

  try {
    // For tool calls, use the proper MCP client method
    if (message.method === 'tools/call') {
      const result = await mcpClient.callTool(
        {
          name: message.params.name,
          arguments: message.params.arguments,
        },
        undefined,
        {
          timeout: 30000, // 30 second timeout
        },
      );
      return result;
    } else {
      // For other methods, send as generic message
      const result = await mcpClient.sendRequest(message);
      return result;
    }
  } catch (error) {
    // If we get a connection error, try to reconnect
    if (error.message.includes('connection') || error.message.includes('closed')) {
      console.log('Connection error detected, attempting reconnection...');
      isConnected = false;
      await initializeMcpClient();
      // Retry the request once after reconnection
      if (isConnected && mcpClient) {
        return await sendToMcpServer(message);
      }
    }
    throw new Error(`MCP client error: ${error.message}`);
  }
}

// HTTP server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check
  if (pathname === '/ping' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        message: 'HTTP Wrapper Server is running',
        mcpServerUrl: MCP_SERVER_URL,
        mcpClientReady: mcpClient !== null && isConnected,
        connectionStatus: {
          isConnected,
          isInitializing,
          reconnectAttempts,
          maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
        },
        note: 'Connects directly to MCP server using MCP client',
      }),
    );
    return;
  }

  // Get cookie tool endpoint
  if (pathname === '/tools/get-cookie' && method === 'POST') {
    try {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          const { url: targetUrl } = JSON.parse(body);

          if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'URL parameter is required' }));
            return;
          }

          console.log(`Get cookie request for URL: ${targetUrl}`);

          if (!mcpClient || !isConnected) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'MCP client not ready',
                message: 'Please wait for MCP client initialization',
                status: {
                  isConnected,
                  isInitializing,
                  reconnectAttempts,
                },
              }),
            );
            return;
          }

          // Create MCP tool call message
          const mcpMessage = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'chrome_get_cookie',
              arguments: {
                url: targetUrl,
              },
            },
          };

          console.log('Sending to MCP server via client:', mcpMessage);

          try {
            // Send request to MCP server using client
            const response = await sendToMcpServer(mcpMessage);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: true,
                message: `Cookies retrieved from ${targetUrl}`,
                response: response,
                request: mcpMessage,
              }),
            );
          } catch (mcpError) {
            console.error('MCP client communication error:', mcpError);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'Failed to communicate with MCP server',
                details: mcpError.message,
                suggestion: 'Make sure the MCP server is running at ' + MCP_SERVER_URL,
              }),
            );
          }
        } catch (parseError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON in request body' }));
        }
      });
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // List available tools
  if (pathname === '/tools' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        tools: [
          {
            name: 'get-cookie',
            endpoint: '/tools/get-cookie',
            method: 'POST',
            description: 'Get cookies from a specified website',
            parameters: {
              url: 'string - URL of the website to get cookies from',
            },
            note: 'Connects directly to MCP server using MCP client at ' + MCP_SERVER_URL,
            status: mcpClient && isConnected ? 'ready' : 'initializing',
            connectionInfo: {
              isConnected,
              isInitializing,
              reconnectAttempts,
            },
          },
        ],
      }),
    );
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// Start server
server.listen(PORT, async () => {
  console.log(`HTTP Wrapper Server running on http://127.0.0.1:${PORT}`);
  console.log('Available endpoints:');
  console.log(`  GET  /ping - Health check`);
  console.log(`  GET  /tools - List available tools`);
  console.log(`  POST /tools/get-cookie - Get cookies from a website`);
  console.log('');
  console.log(`Connecting to MCP server at: ${MCP_SERVER_URL}`);
  console.log('Note: This wrapper uses MCP client for proper protocol handling');

  // Initialize MCP client after server starts
  setTimeout(async () => {
    await initializeMcpClient();
  }, 1000);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  if (mcpClient) {
    try {
      await mcpClient.close();
    } catch (error) {
      console.log('Error closing MCP client:', error.message);
    }
  }
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  if (mcpClient) {
    try {
      await mcpClient.close();
    } catch (error) {
      console.log('Error closing MCP client:', error.message);
    }
  }
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit, just log the error
});
