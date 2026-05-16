import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logMcpRequest, isMcpRequestLoggingEnabled } from '../../src/utils/request-logger.js';

describe('request-logger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = process.env.LOG_MCP_REQUESTS;

  // The logger emits a single `[MCP Request] <json>` line. Strip the scope
  // prefix and parse the JSON payload back out for assertions.
  const parsePayload = (callIndex = 0): any => {
    const line = consoleLogSpy.mock.calls[callIndex][0] as string;
    expect(line.startsWith('[MCP Request] ')).toBe(true);
    return JSON.parse(line.slice('[MCP Request] '.length));
  };

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    if (originalEnv === undefined) {
      delete process.env.LOG_MCP_REQUESTS;
    } else {
      process.env.LOG_MCP_REQUESTS = originalEnv;
    }
  });

  describe('isMcpRequestLoggingEnabled', () => {
    it('returns true when LOG_MCP_REQUESTS=true', () => {
      process.env.LOG_MCP_REQUESTS = 'true';
      expect(isMcpRequestLoggingEnabled()).toBe(true);
    });

    it('returns false when LOG_MCP_REQUESTS is unset', () => {
      delete process.env.LOG_MCP_REQUESTS;
      expect(isMcpRequestLoggingEnabled()).toBe(false);
    });

    it('returns false when LOG_MCP_REQUESTS=false', () => {
      process.env.LOG_MCP_REQUESTS = 'false';
      expect(isMcpRequestLoggingEnabled()).toBe(false);
    });

    it('returns false for any non-"true" value', () => {
      process.env.LOG_MCP_REQUESTS = '1';
      expect(isMcpRequestLoggingEnabled()).toBe(false);
    });
  });

  describe('logMcpRequest', () => {
    it('does nothing when logging is disabled', () => {
      delete process.env.LOG_MCP_REQUESTS;
      logMcpRequest({ method: 'tools/call', params: { name: 'foo' } });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('logs tools/call with name, arguments, and _meta', () => {
      process.env.LOG_MCP_REQUESTS = 'true';
      logMcpRequest({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'get_todays_summary',
          arguments: { foo: 'bar' },
          _meta: { 'openai/userLocation': { city: 'Madrid' } },
        },
      });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const parsed = parsePayload(0);
      expect(parsed).toEqual({
        method: 'tools/call',
        id: 7,
        tool: 'get_todays_summary',
        arguments: { foo: 'bar' },
        meta: { 'openai/userLocation': { city: 'Madrid' } },
      });
    });

    it('logs initialize with clientInfo, protocolVersion, and capabilities', () => {
      process.env.LOG_MCP_REQUESTS = 'true';
      logMcpRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          clientInfo: { name: 'claude-ai', version: '1.0.0' },
          capabilities: { sampling: {} },
        },
      });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const parsed = parsePayload(0);
      expect(parsed).toEqual({
        method: 'initialize',
        id: 1,
        protocolVersion: '2025-11-25',
        clientInfo: { name: 'claude-ai', version: '1.0.0' },
        capabilities: { sampling: {} },
      });
    });

    it('omits meta key when _meta is absent', () => {
      process.env.LOG_MCP_REQUESTS = 'true';
      logMcpRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_athlete_profile', arguments: {} },
      });

      const parsed = parsePayload(0);
      expect(parsed).not.toHaveProperty('meta');
      expect(parsed.tool).toBe('get_athlete_profile');
    });

    it('logs other methods with just method and id', () => {
      process.env.LOG_MCP_REQUESTS = 'true';
      logMcpRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
      });

      const parsed = parsePayload(0);
      expect(parsed).toEqual({ method: 'tools/list', id: 3 });
    });

    it('handles JSON-RPC batch arrays', () => {
      process.env.LOG_MCP_REQUESTS = 'true';
      logMcpRequest([
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'get_todays_summary', arguments: {} },
        },
      ]);

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });

    it('skips messages without a method (e.g. JSON-RPC responses)', () => {
      process.env.LOG_MCP_REQUESTS = 'true';
      logMcpRequest({ jsonrpc: '2.0', id: 1, result: { ok: true } });
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('handles null and undefined bodies safely', () => {
      process.env.LOG_MCP_REQUESTS = 'true';
      logMcpRequest(null);
      logMcpRequest(undefined);
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('handles missing params gracefully', () => {
      process.env.LOG_MCP_REQUESTS = 'true';
      logMcpRequest({ jsonrpc: '2.0', id: 4, method: 'ping' });
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const parsed = parsePayload(0);
      expect(parsed).toEqual({ method: 'ping', id: 4 });
    });
  });
});
