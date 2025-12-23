#!/usr/bin/env node
/**
 * Stdio transport entry point for Claude Desktop
 * Use this for local testing with Claude Desktop
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getConfig } from './auth/middleware.js';
import { ToolRegistry } from './tools/index.js';

async function main() {
  const config = getConfig();

  // Create tool registry with API clients
  const toolRegistry = new ToolRegistry({
    intervals: config.intervals,
    whoop: config.whoop,
    trainerroad: config.trainerRoad,
  });

  // Create MCP server instance
  const server = new McpServer({
    name: 'domestique',
    version: '1.0.0',
  });

  // Register tools
  toolRegistry.registerTools(server);

  // Create stdio transport
  const transport = new StdioServerTransport();

  // Connect server to transport
  await server.server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
