import express, { Request, Response } from 'express';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { validateToken, createOriginValidator, getConfig } from './auth/middleware.js';
import { ToolRegistry } from './tools/index.js';
import { logMcpRequest, isMcpRequestLoggingEnabled } from './utils/request-logger.js';
import { logInfo, logError } from './utils/logger.js';

export interface ServerOptions {
  port: number;
}

/** Escape a string for safe interpolation into HTML text or a quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Read a query parameter as a single string (Express parses repeats as arrays). */
function queryString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export async function createServer(options: ServerOptions): Promise<express.Express> {
  const app = express();

  const config = getConfig();

  // Create tool registry with API clients (shared across connections)
  const toolRegistry = new ToolRegistry({
    intervals: config.intervals,
    whoop: config.whoop,
    trainerroad: config.trainerRoad,
    googleWeather: config.googleWeather,
    googleAirQuality: config.googleAirQuality,
    googlePollen: config.googlePollen,
    googleElevation: config.googleElevation,
    googleGeocoding: config.googleGeocoding,
    googleTimezone: config.googleTimezone,
  });

  logInfo('Server', 'Tool registry created');

  // Stateless MCP handler (2026-07-28 spec: no sessions, no initialize
  // handshake). The factory runs once per request and returns a fresh
  // McpServer; the tool registry and its clients/caches are shared. 2025-era
  // clients that still send `initialize` are served statelessly by the same
  // factory (the SDK's default `legacy: 'stateless'`).
  const mcpHandler = createMcpHandler(
    () => {
      const server = new McpServer({ name: 'domestique', version: '1.0.0' });
      toolRegistry.registerTools(server);
      return server;
    },
    { onerror: (error) => logError('Server', 'MCP handler error', error) }
  );
  const handleMcpRequest = toNodeHandler(mcpHandler, {
    onerror: (error) => logError('Server', 'Error handling MCP request', error),
  });
  const validateOrigin = createOriginValidator(config.mcpAllowedOrigins);

  app.use(express.json());

  if (isMcpRequestLoggingEnabled()) {
    logInfo('MCP Request', 'Logging enabled (LOG_MCP_REQUESTS=true)');
  }

  // Health check endpoint (no auth required)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // Root redirect to GitHub
  app.get('/', (_req: Request, res: Response) => {
    res.redirect(302, 'https://github.com/gesteves/domestique');
  });

  // OAuth callback page for Whoop authorization
  app.get('/callback', (req: Request, res: Response) => {
    // All three are attacker-controllable (anyone can craft a /callback link),
    // so they're HTML-escaped before interpolation below.
    const code = queryString(req.query.code);
    const error = queryString(req.query.error);
    const errorDescription = queryString(req.query.error_description);

    let content: string;
    let statusClass: string;
    let icon: string;

    if (error) {
      // OAuth error
      statusClass = 'text-red-600';
      icon = `<svg class="w-12 h-12 mx-auto mb-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;
      content = `
        <h2 class="text-xl font-semibold ${statusClass} mb-2">Authorization Failed</h2>
        <p class="text-gray-600 mb-4">${escapeHtml(errorDescription || error)}</p>
        <p class="text-sm text-gray-500">Please close this window and try authorizing again.</p>
      `;
    } else if (code) {
      // Success - show the code
      statusClass = 'text-green-600';
      icon = `<svg class="w-12 h-12 mx-auto mb-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
      content = `
        <h2 class="text-xl font-semibold ${statusClass} mb-4">Authorization Successful</h2>
        <p class="text-gray-600 mb-2">Your authorization code:</p>
        <div class="flex mb-6">
          <input
            type="text"
            id="code"
            value="${escapeHtml(code)}"
            readonly
            class="flex-1 px-3 py-2 border border-gray-300 rounded-l-md bg-gray-50 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onclick="copyCode()"
            id="copyBtn"
            class="px-4 py-2 bg-blue-600 text-white rounded-r-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            Copy
          </button>
        </div>
        <div class="text-left text-sm text-gray-600">
          <p class="font-medium mb-2">Next steps:</p>
          <ol class="list-decimal list-inside space-y-1">
            <li>Copy the code above</li>
            <li>Return to your terminal</li>
            <li>Paste the code when prompted</li>
            <li>Close this window</li>
          </ol>
        </div>
      `;
    } else {
      // No code or error - direct visit
      statusClass = 'text-gray-600';
      icon = `<svg class="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
      content = `
        <h2 class="text-xl font-semibold ${statusClass} mb-2">No Authorization Code</h2>
        <p class="text-gray-600 mb-4">This page is used to receive OAuth authorization codes from Whoop.</p>
        <p class="text-sm text-gray-500">To authorize, run <code class="bg-gray-100 px-1 rounded">npm run whoop:auth</code> and follow the instructions.</p>
      `;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Whoop Authorization - Domestique</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-gray-100 flex items-center justify-center p-4">
  <div class="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
    ${icon}
    ${content}
  </div>
  <script>
    function copyCode() {
      const codeInput = document.getElementById('code');
      const copyBtn = document.getElementById('copyBtn');
      if (codeInput) {
        navigator.clipboard.writeText(codeInput.value).then(() => {
          copyBtn.textContent = 'Copied!';
          copyBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
          copyBtn.classList.add('bg-green-600');
          setTimeout(() => {
            copyBtn.textContent = 'Copy';
            copyBtn.classList.remove('bg-green-600');
            copyBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
          }, 2000);
        });
      }
    }
  </script>
</body>
</html>`;

    res.type('html').send(html);
  });

  // MCP endpoint - handles all Streamable HTTP requests (modern and legacy)
  app.all('/mcp', validateToken, validateOrigin, async (req: Request, res: Response) => {
    // Optional: log incoming JSON-RPC request (tool calls, discover, etc.)
    // including any client-supplied `_meta` field. Controlled by LOG_MCP_REQUESTS.
    logMcpRequest(req.body);

    try {
      // express.json() has already drained the body stream, so hand the
      // parsed body to the adapter.
      await handleMcpRequest(req, res, req.body);
    } catch (error) {
      logError('Server', 'Error handling MCP request', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  // Error handling middleware
  app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    logError('Server', 'Unhandled server error', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export async function startServer(options: ServerOptions): Promise<void> {
  const app = await createServer(options);

  app.listen(options.port, () => {
    logInfo('Server', `Domestique MCP server running on port ${options.port}`);
    logInfo('Server', `Health check: http://localhost:${options.port}/health`);
    logInfo('Server', `MCP endpoint: http://localhost:${options.port}/mcp`);
  });
}
