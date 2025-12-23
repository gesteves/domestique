import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createServer } from 'http';
import { createServer as createExpressServer } from '../src/server.js';

// Mock the auth middleware
vi.mock('../src/auth/middleware.js', () => ({
  validateToken: vi.fn((req: any, res: any, next: any) => next()),
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
  ToolRegistry: vi.fn().mockImplementation(function() {
    return {
      registerTools: vi.fn(),
      getToolDefinitions: vi.fn().mockReturnValue([]),
      handleToolCall: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{}' }],
      }),
    };
  }),
}));

// Mock MCP SDK
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(function() {
    return {
      setRequestHandler: vi.fn(),
      connect: vi.fn(),
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(function() {
    return {
      handleRequest: vi.fn(),
      close: vi.fn(),
      sessionId: 'test-session-id',
    };
  }),
}));

describe('Server', () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const app = await createExpressServer({ port: 3000 });
    
    // Create a real HTTP server for testing
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 3000;
    baseUrl = `http://localhost:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('Health endpoint', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${baseUrl}/health`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe('healthy');
      expect(body.timestamp).toBeDefined();
    });

    it('should not require authentication', async () => {
      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);
    });
  });

  describe('MCP endpoint', () => {
    it('should be accessible with valid token', async () => {
      // MCP endpoint exists and responds (auth is mocked to pass)
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({}),
      });
      
      // The endpoint exists - we get a response (not 404)
      expect(response.status).not.toBe(404);
    });
  });
});

// Import afterEach for cleanup
import { afterEach } from 'vitest';
