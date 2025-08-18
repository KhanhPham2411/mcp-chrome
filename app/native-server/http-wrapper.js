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

// MCP client instance
let mcpClient = null;

// Initialize MCP client
async function initializeMcpClient() {
  try {
    console.log('Initializing MCP client...');

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

    console.log('MCP client connected successfully');
    return true;
  } catch (error) {
    console.error('Failed to initialize MCP client:', error);
    return false;
  }
}

// Send request to MCP server using proper client
async function sendToMcpServer(message) {
  if (!mcpClient) {
    throw new Error('MCP client not initialized');
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
        mcpClientReady: mcpClient !== null,
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

          if (!mcpClient) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'MCP client not ready',
                message: 'Please wait for MCP client initialization',
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
            status: mcpClient ? 'ready' : 'initializing',
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
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (mcpClient) {
    mcpClient.close();
  }
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  if (mcpClient) {
    mcpClient.close();
  }
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
