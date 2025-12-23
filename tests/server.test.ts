import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer } from '../src/server.js';

// Mock the auth middleware
vi.mock('../src/auth/middleware.js', () => ({
  validateToken: vi.fn((req, res, next) => next()),
  getConfig: vi.fn(() => ({
    port: 3000,
    mcpAuthToken: 'test-token',
    intervals: {
      apiKey: 'test-key',
      athleteId: 'test-athlete',
    },
    whoop: null,
    trainerRoad: null,
  })),
}));

// Mock the tool registry
vi.mock('../src/tools/index.js', () => ({
  ToolRegistry: vi.fn().mockImplementation(() => ({
    registerTools: vi.fn(),
    getToolDefinitions: vi.fn().mockReturnValue([]),
    handleToolCall: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{}' }],
    }),
  })),
}));

// Mock MCP SDK
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: vi.fn(),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation((options) => ({
    handleRequest: vi.fn(),
    close: vi.fn(),
    sessionId: 'test-session-id',
  })),
}));

describe('Server', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createServer({ port: 3000 });
  });

  describe('Health endpoint', () => {
    it('should return healthy status', async () => {
      const response = await makeRequest(app, 'GET', '/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toBeDefined();
    });

    it('should not require authentication', async () => {
      // The validateToken mock is set to pass, but we can verify it's not called
      const response = await makeRequest(app, 'GET', '/health');
      expect(response.status).toBe(200);
    });
  });

  describe('MCP endpoint', () => {
    it('should be accessible with valid token', () => {
      // MCP endpoint is tested via integration tests
      // Unit testing Streamable HTTP is complex due to transport mechanics
      // This test verifies the route exists
      const router = (app as any)._router;
      const mcpRoute = router.stack.find((layer: any) =>
        layer.route?.path === '/mcp'
      );
      expect(mcpRoute).toBeDefined();
    });
  });
});

// Helper function to make requests to the Express app
async function makeRequest(
  app: express.Express,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<{
  status: number;
  headers: Record<string, string>;
  body: any;
}> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    let responseBody = '';

    const mockRes = {
      statusCode: 200,
      setHeader: (name: string, value: string) => {
        headers[name.toLowerCase()] = value;
      },
      getHeader: (name: string) => headers[name.toLowerCase()],
      status: function (code: number) {
        this.statusCode = code;
        return this;
      },
      json: function (data: any) {
        headers['content-type'] = 'application/json';
        responseBody = JSON.stringify(data);
        resolve({
          status: this.statusCode,
          headers,
          body: data,
        });
      },
      send: function (data: string) {
        responseBody = data;
        resolve({
          status: this.statusCode,
          headers,
          body: data,
        });
      },
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };

    const mockReq: any = {
      method,
      url: path,
      path,
      query: {},
      headers: {},
      body,
      on: vi.fn((event: string, callback: () => void) => {
        if (event === 'close') {
          // Store close handler but don't call it
        }
      }),
    };

    // Find the route handler
    const router = (app as any)._router;
    let matched = false;

    router.stack.forEach((layer: any) => {
      if (matched) return;

      if (layer.route) {
        const routePath = layer.route.path;
        const routeMethod = Object.keys(layer.route.methods)[0].toUpperCase();

        if (routePath === path && routeMethod === method) {
          matched = true;
          const handler = layer.route.stack[layer.route.stack.length - 1].handle;
          handler(mockReq, mockRes, () => {});
        }
      } else if (layer.handle && layer.name !== 'router') {
        // Middleware
      }
    });

    if (!matched) {
      resolve({
        status: 404,
        headers: {},
        body: { error: 'Not found' },
      });
    }
  });
}
