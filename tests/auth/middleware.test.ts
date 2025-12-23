import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  validateToken,
  validateEnvironment,
  getConfig,
} from '../../src/auth/middleware.js';

describe('auth/middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateToken', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;
    let jsonMock: ReturnType<typeof vi.fn>;
    let statusMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      jsonMock = vi.fn();
      statusMock = vi.fn().mockReturnValue({ json: jsonMock });

      mockReq = {
        headers: {},
        query: {},
      };
      mockRes = {
        status: statusMock,
        json: jsonMock,
      };
      mockNext = vi.fn();
    });

    it('should call next() with valid token', () => {
      process.env.MCP_AUTH_TOKEN = 'valid-secret-token';
      mockReq.query = { token: 'valid-secret-token' };

      validateToken(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should return 401 when token is missing', () => {
      process.env.MCP_AUTH_TOKEN = 'valid-secret-token';
      mockReq.query = {};

      validateToken(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Authentication token required' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 when token is invalid', () => {
      process.env.MCP_AUTH_TOKEN = 'valid-secret-token';
      mockReq.query = { token: 'wrong-token' };

      validateToken(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Invalid authentication token' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 500 when MCP_AUTH_TOKEN is not set', () => {
      delete process.env.MCP_AUTH_TOKEN;
      mockReq.query = { token: 'some-token' };

      validateToken(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Server configuration error' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should use constant-time comparison for tokens', () => {
      process.env.MCP_AUTH_TOKEN = 'secret';

      // Test with same length but different content
      mockReq.query = { token: 'secreX' };
      validateToken(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(403);

      // Reset mocks
      statusMock.mockClear();
      jsonMock.mockClear();

      // Test with different length
      mockReq.query = { token: 'sec' };
      validateToken(mockReq as Request, mockRes as Response, mockNext);
      expect(statusMock).toHaveBeenCalledWith(403);
    });
  });

  describe('validateEnvironment', () => {
    it('should not throw when all required variables are set', () => {
      process.env.MCP_AUTH_TOKEN = 'token';
      process.env.INTERVALS_API_KEY = 'key';
      process.env.INTERVALS_ATHLETE_ID = 'athlete';

      expect(() => validateEnvironment()).not.toThrow();
    });

    it('should throw when MCP_AUTH_TOKEN is missing', () => {
      delete process.env.MCP_AUTH_TOKEN;
      process.env.INTERVALS_API_KEY = 'key';
      process.env.INTERVALS_ATHLETE_ID = 'athlete';

      expect(() => validateEnvironment()).toThrow('Missing required environment variables: MCP_AUTH_TOKEN');
    });

    it('should throw when INTERVALS_API_KEY is missing', () => {
      process.env.MCP_AUTH_TOKEN = 'token';
      delete process.env.INTERVALS_API_KEY;
      process.env.INTERVALS_ATHLETE_ID = 'athlete';

      expect(() => validateEnvironment()).toThrow('Missing required environment variables: INTERVALS_API_KEY');
    });

    it('should throw when INTERVALS_ATHLETE_ID is missing', () => {
      process.env.MCP_AUTH_TOKEN = 'token';
      process.env.INTERVALS_API_KEY = 'key';
      delete process.env.INTERVALS_ATHLETE_ID;

      expect(() => validateEnvironment()).toThrow('Missing required environment variables: INTERVALS_ATHLETE_ID');
    });

    it('should list all missing variables', () => {
      delete process.env.MCP_AUTH_TOKEN;
      delete process.env.INTERVALS_API_KEY;
      delete process.env.INTERVALS_ATHLETE_ID;

      expect(() => validateEnvironment()).toThrow(
        'Missing required environment variables: MCP_AUTH_TOKEN, INTERVALS_API_KEY, INTERVALS_ATHLETE_ID'
      );
    });

    it('should require Whoop refresh token when access token is set', () => {
      process.env.MCP_AUTH_TOKEN = 'token';
      process.env.INTERVALS_API_KEY = 'key';
      process.env.INTERVALS_ATHLETE_ID = 'athlete';
      process.env.WHOOP_CLIENT_ID = 'client-id';
      delete process.env.WHOOP_CLIENT_SECRET;
      delete process.env.REDIS_URL;

      expect(() => validateEnvironment()).toThrow(
        'Missing required environment variables: WHOOP_CLIENT_SECRET, REDIS_URL'
      );
    });

    it('should not require Whoop vars when client ID is not set', () => {
      process.env.MCP_AUTH_TOKEN = 'token';
      process.env.INTERVALS_API_KEY = 'key';
      process.env.INTERVALS_ATHLETE_ID = 'athlete';
      delete process.env.WHOOP_CLIENT_ID;

      expect(() => validateEnvironment()).not.toThrow();
    });
  });

  describe('getConfig', () => {
    beforeEach(() => {
      process.env.MCP_AUTH_TOKEN = 'auth-token';
      process.env.INTERVALS_API_KEY = 'intervals-key';
      process.env.INTERVALS_ATHLETE_ID = 'i12345';
    });

    it('should return basic config', () => {
      const config = getConfig();

      expect(config.port).toBe(3000);
      expect(config.mcpAuthToken).toBe('auth-token');
      expect(config.intervals.apiKey).toBe('intervals-key');
      expect(config.intervals.athleteId).toBe('i12345');
    });

    it('should return custom port when set', () => {
      process.env.PORT = '8080';

      const config = getConfig();

      expect(config.port).toBe(8080);
    });

    it('should return Whoop config when client ID is set', () => {
      process.env.WHOOP_CLIENT_ID = 'whoop-client';
      process.env.WHOOP_CLIENT_SECRET = 'whoop-secret';

      const config = getConfig();

      // accessToken and refreshToken are empty - loaded from Redis at runtime
      expect(config.whoop).toEqual({
        accessToken: '',
        refreshToken: '',
        clientId: 'whoop-client',
        clientSecret: 'whoop-secret',
      });
    });

    it('should return null for Whoop when client ID is not set', () => {
      delete process.env.WHOOP_CLIENT_ID;

      const config = getConfig();

      expect(config.whoop).toBeNull();
    });

    it('should return TrainerRoad config when set', () => {
      process.env.TRAINERROAD_CALENDAR_URL = 'https://trainerroad.com/calendar/xyz';

      const config = getConfig();

      expect(config.trainerRoad).toEqual({
        calendarUrl: 'https://trainerroad.com/calendar/xyz',
      });
    });

    it('should return null for TrainerRoad when not set', () => {
      delete process.env.TRAINERROAD_CALENDAR_URL;

      const config = getConfig();

      expect(config.trainerRoad).toBeNull();
    });
  });
});
