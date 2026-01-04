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
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(function() {
    return {
      setRequestHandler: vi.fn(),
      connect: vi.fn(),
      close: vi.fn(),
      resource: vi.fn(),
      registerPrompt: vi.fn(),
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(function(options?: any) {
    // Call session initialized callback if provided
    if (options?.onsessioninitialized) {
      setTimeout(() => options.onsessioninitialized('test-session-id'), 0);
    }
    return {
      start: vi.fn(),
      handleRequest: vi.fn().mockImplementation(async (req: any, res: any) => {
        // Mock a successful response
        if (!res.headersSent) {
          res.status(200).json({ success: true });
        }
      }),
      close: vi.fn().mockResolvedValue(undefined),
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

    it('should register daily_summary prompt on session initialization', async () => {
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');

      // Make a request to trigger session initialization
      await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({}),
      });

      // Verify registerPrompt was called with correct arguments
      const mockInstance = (McpServer as any).mock.results[0]?.value;
      expect(mockInstance.registerPrompt).toHaveBeenCalledWith(
        'daily_summary',
        {
          title: 'Daily Summary',
          description:
            'Get a complete overview of your fitness status today including recovery, strain, workouts, and fitness metrics',
        },
        expect.any(Function)
      );
    });
  });

  describe('Root redirect', () => {
    it('should redirect to GitHub repository', async () => {
      const response = await fetch(`${baseUrl}/`, {
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://github.com/gesteves/domestique');
    });
  });

  describe('OAuth callback endpoint', () => {
    it('should display authorization code when provided', async () => {
      const response = await fetch(`${baseUrl}/callback?code=test-auth-code`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(body).toContain('Authorization Successful');
      expect(body).toContain('test-auth-code');
      expect(body).toContain('Copy');
      expect(body).toContain('Next steps');
    });

    it('should display error when OAuth error is returned', async () => {
      const response = await fetch(
        `${baseUrl}/callback?error=access_denied&error_description=User+denied+access`
      );
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(body).toContain('Authorization Failed');
      expect(body).toContain('User denied access');
      expect(body).toContain('try authorizing again');
    });

    it('should display info message when no code or error present', async () => {
      const response = await fetch(`${baseUrl}/callback`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(body).toContain('No Authorization Code');
      expect(body).toContain('OAuth authorization codes');
      expect(body).toContain('npm run whoop:auth');
    });

    it('should not require authentication', async () => {
      const response = await fetch(`${baseUrl}/callback`);
      expect(response.status).toBe(200);
    });
  });
});

// Import afterEach for cleanup
import { afterEach } from 'vitest';
