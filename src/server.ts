import express, { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { validateToken, getConfig } from './auth/middleware.js';
import { ToolRegistry } from './tools/index.js';

export interface ServerOptions {
  port: number;
}

export async function createServer(options: ServerOptions): Promise<express.Express> {
  const app = express();
  app.use(express.json());

  const config = getConfig();

  // Create tool registry with API clients (shared across connections)
  const toolRegistry = new ToolRegistry({
    intervals: config.intervals,
    whoop: config.whoop,
    trainerroad: config.trainerRoad,
  });

  console.log('Tool registry created');

  // Store active transports and servers by sessionId
  const sessions: Record<string, { transport: StreamableHTTPServerTransport; server: McpServer }> = {};

  // Health check endpoint (no auth required)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // MCP endpoint - handles all Streamable HTTP requests
  app.all('/mcp', validateToken, async (req: Request, res: Response) => {
    // Check for existing session
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // If we have an existing session, use it
    if (sessionId && sessions[sessionId]) {
      const { transport } = sessions[sessionId];
      try {
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
      return;
    }

    // For new sessions (initialization), create a new server and transport
    const mcpServer = new McpServer({
      name: 'domestique',
      version: '1.0.0',
    });

    // Register tools for this connection
    toolRegistry.registerTools(mcpServer);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        console.log(`Session initialized: ${newSessionId}`);
        sessions[newSessionId] = { transport, server: mcpServer };
      },
      onsessionclosed: (closedSessionId) => {
        console.log(`Session closed: ${closedSessionId}`);
        delete sessions[closedSessionId];
      },
    });

    // Connect the server to the transport
    await mcpServer.connect(transport);

    // Handle the request
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  // Handle session termination via DELETE
  app.delete('/mcp', validateToken, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !sessions[sessionId]) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { transport, server } = sessions[sessionId];

    try {
      await transport.close();
      await server.close();
      delete sessions[sessionId];
      console.log(`Session terminated: ${sessionId}`);
      res.status(204).send();
    } catch (error) {
      console.error('Error terminating session:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Error handling middleware
  app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export async function startServer(options: ServerOptions): Promise<void> {
  const app = await createServer(options);

  app.listen(options.port, () => {
    console.log(`Domestique MCP server running on port ${options.port}`);
    console.log(`Health check: http://localhost:${options.port}/health`);
    console.log(`MCP endpoint: http://localhost:${options.port}/mcp`);
  });
}
