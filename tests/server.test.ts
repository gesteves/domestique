import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from 'http';
import { z } from 'zod';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import { createServer as createExpressServer } from '../src/server.js';

// Mock the auth middleware (keep the real Origin validator)
vi.mock('../src/auth/middleware.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/auth/middleware.js')>();
  return {
    ...actual,
    validateToken: vi.fn((req: any, res: any, next: any) => next()),
    getConfig: vi.fn(() => ({
      port: 3000,
      mcpAuthToken: 'test-token',
      mcpAllowedOrigins: ['claude.example'],
      intervals: {
        apiKey: 'test-key',
        athleteId: 'test-athlete',
      },
      whoop: null,
      trainerRoad: null,
      // No longer read by the server; set so the removed-endpoints test would
      // catch a regression that re-registers the /api routes.
      apiSecret: 'test-secret',
    })),
  };
});

// Mock the tool registry: register one trivial tool on the real McpServer so
// the real SDK handler can be exercised end to end.
vi.mock('../src/tools/index.js', () => ({
  ToolRegistry: vi.fn().mockImplementation(function () {
    return {
      registerTools: vi.fn((server: any) => {
        server.registerTool(
          'echo',
          {
            title: 'Echo',
            description: 'Echoes its input',
            inputSchema: z.object({ text: z.string() }),
            outputSchema: z.object({ echoed: z.string() }),
          },
          async ({ text }: { text: string }) => {
            const structuredContent = { echoed: text };
            return {
              content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
              structuredContent,
            };
          }
        );
      }),
    };
  }),
}));

const MODERN_VERSION = '2026-07-28';
const LEGACY_VERSION = '2025-11-25';

/** Headers + body for a 2026-07-28 (stateless, per-request `_meta`) request. */
function modernRequest(
  method: string,
  params: Record<string, unknown> = {},
  extraHeaders: Record<string, string> = {}
): RequestInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: 'Bearer test-token',
    'MCP-Protocol-Version': MODERN_VERSION,
    'Mcp-Method': method,
    ...extraHeaders,
  };
  if (typeof params.name === 'string' && !('Mcp-Name' in extraHeaders)) {
    headers['Mcp-Name'] = params.name;
  }
  return {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: MODERN_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {},
          [CLIENT_INFO_META_KEY]: { name: 'test-client', version: '1.0.0' },
        },
      },
    }),
  };
}

/** Parse a JSON or single-message SSE response body into the JSON-RPC message. */
async function readJsonRpc(response: Response): Promise<any> {
  const text = await response.text();
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .pop();
    return JSON.parse(data ?? 'null');
  }
  return JSON.parse(text);
}

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

  describe('MCP endpoint (2026-07-28)', () => {
    it('answers server/discover with supported versions', async () => {
      const response = await fetch(`${baseUrl}/mcp`, modernRequest('server/discover'));
      const body = await readJsonRpc(response);

      expect(response.status).toBe(200);
      expect(body.result.resultType).toBe('complete');
      expect(body.result.supportedVersions).toContain(MODERN_VERSION);
    });

    it('lists tools with cache hints and no session header', async () => {
      const response = await fetch(`${baseUrl}/mcp`, modernRequest('tools/list'));
      const body = await readJsonRpc(response);

      expect(response.status).toBe(200);
      expect(response.headers.get('mcp-session-id')).toBeNull();
      expect(body.result.resultType).toBe('complete');
      expect(body.result.tools.map((t: any) => t.name)).toEqual(['echo']);
      expect(body.result.tools[0].outputSchema).toBeDefined();
      expect(typeof body.result.ttlMs).toBe('number');
      expect(['public', 'private']).toContain(body.result.cacheScope);
    });

    it('calls a tool and returns structuredContent', async () => {
      const response = await fetch(
        `${baseUrl}/mcp`,
        modernRequest('tools/call', { name: 'echo', arguments: { text: 'hi' } })
      );
      const body = await readJsonRpc(response);

      expect(response.status).toBe(200);
      expect(body.result.resultType).toBe('complete');
      expect(body.result.structuredContent).toEqual({ echoed: 'hi' });
    });

    it('rejects a header/body mismatch with HeaderMismatch (-32020)', async () => {
      const response = await fetch(
        `${baseUrl}/mcp`,
        modernRequest('tools/list', {}, { 'Mcp-Method': 'prompts/list' })
      );
      const body = await readJsonRpc(response);

      expect(response.status).toBe(400);
      expect(body.error.code).toBe(-32020);
    });
  });

  describe('MCP endpoint (legacy 2025-11-25 clients)', () => {
    const legacyHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer test-token',
    };

    it('serves initialize statelessly, without minting a session', async () => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: legacyHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: LEGACY_VERSION,
            capabilities: {},
            clientInfo: { name: 'legacy-client', version: '1.0.0' },
          },
        }),
      });
      const body = await readJsonRpc(response);

      expect(response.status).toBe(200);
      expect(response.headers.get('mcp-session-id')).toBeNull();
      expect(body.result.protocolVersion).toBe(LEGACY_VERSION);
      expect(body.result.serverInfo.name).toBe('domestique');
    });

    it('ignores a stale session ID instead of returning 404', async () => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...legacyHeaders,
          'mcp-protocol-version': LEGACY_VERSION,
          'mcp-session-id': 'stale-session-id-from-before-deployment',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      });
      const body = await readJsonRpc(response);

      expect(response.status).toBe(200);
      expect(body.result.tools.map((t: any) => t.name)).toEqual(['echo']);
    });

    it('returns 405 for GET (no standalone SSE stream)', async () => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'GET',
        headers: { Accept: 'text/event-stream', Authorization: 'Bearer test-token' },
      });

      expect(response.status).toBe(405);
    });
  });

  describe('MCP endpoint Origin validation', () => {
    it.each([
      ['http://localhost:6274'],
      ['https://claude.example'],
    ])('allows Origin %s', async (origin) => {
      const response = await fetch(
        `${baseUrl}/mcp`,
        modernRequest('server/discover', {}, { Origin: origin })
      );
      expect(response.status).toBe(200);
    });

    it('rejects an unlisted Origin with 403', async () => {
      const response = await fetch(
        `${baseUrl}/mcp`,
        modernRequest('server/discover', {}, { Origin: 'https://evil.example' })
      );
      expect(response.status).toBe(403);
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

  describe('Removed endpoints', () => {
    it.each([
      ['POST', '/webhooks/whoop'],
      ['PUT', '/api/location'],
      ['POST', '/api/activities/descriptions'],
      ['POST', '/admin/notify-tools-changed'],
    ])('%s %s returns 404', async (method, path) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: 'Bearer test-secret',
          'Content-Type': 'application/json',
        },
        body: '{}',
      });

      expect(response.status).toBe(404);
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
