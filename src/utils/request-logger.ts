/**
 * Optional MCP request logging.
 *
 * When LOG_MCP_REQUESTS=true, logs the JSON-RPC method, the tool name (for
 * tools/call), and any client-supplied `_meta` field. Useful for inspecting
 * what different MCP clients (Claude, ChatGPT, etc.) include in `_meta` —
 * ChatGPT documents its `_meta` payload, but Claude's is undocumented.
 */

interface JsonRpcMessage {
  method?: string;
  id?: unknown;
  params?: Record<string, unknown>;
}

export function isMcpRequestLoggingEnabled(): boolean {
  return process.env.LOG_MCP_REQUESTS === 'true';
}

export function logMcpRequest(body: unknown): void {
  if (!isMcpRequestLoggingEnabled()) return;
  if (!body) return;

  const messages = Array.isArray(body) ? body : [body];

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const m = msg as JsonRpcMessage;
    if (!m.method) continue;

    const params = (m.params ?? {}) as Record<string, unknown>;
    const summary: Record<string, unknown> = {
      method: m.method,
      id: m.id,
    };

    if (m.method === 'tools/call') {
      summary.tool = params.name;
      summary.arguments = params.arguments;
    } else if (m.method === 'initialize') {
      summary.protocolVersion = params.protocolVersion;
      summary.clientInfo = params.clientInfo;
      summary.capabilities = params.capabilities;
    }

    if (params._meta !== undefined) {
      summary.meta = params._meta;
    }

    console.log('[MCP Request]', JSON.stringify(summary, null, 2));
  }
}
