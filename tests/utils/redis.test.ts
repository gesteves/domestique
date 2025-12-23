import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock redis module
const mockRedisClient = {
  isOpen: true,
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue(undefined),
  get: vi.fn(),
  set: vi.fn(),
  setEx: vi.fn(),
  del: vi.fn(),
  on: vi.fn(),
};

vi.mock('redis', () => ({
  createClient: vi.fn(() => mockRedisClient),
}));

describe('Redis utilities', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRedisClient.isOpen = true;
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  describe('getRedisClient', () => {
    it('should return null when REDIS_URL is not set', async () => {
      delete process.env.REDIS_URL;
      const { getRedisClient } = await import('../../src/utils/redis.js');
      const client = await getRedisClient();
      expect(client).toBeNull();
    });

    it('should create and return Redis client when REDIS_URL is set', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      const { getRedisClient } = await import('../../src/utils/redis.js');
      const client = await getRedisClient();
      expect(client).toBeTruthy();
    });
  });

  describe('isRedisAvailable', () => {
    it('should return false when REDIS_URL is not set', async () => {
      delete process.env.REDIS_URL;
      const { isRedisAvailable } = await import('../../src/utils/redis.js');
      const available = await isRedisAvailable();
      expect(available).toBe(false);
    });

    it('should return true when Redis is connected', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      mockRedisClient.isOpen = true;
      const { isRedisAvailable } = await import('../../src/utils/redis.js');
      const available = await isRedisAvailable();
      expect(available).toBe(true);
    });
  });

  describe('redisSet', () => {
    it('should return false when Redis is not available', async () => {
      delete process.env.REDIS_URL;
      const { redisSet } = await import('../../src/utils/redis.js');
      const result = await redisSet('key', 'value');
      expect(result).toBe(false);
    });

    it('should set value without TTL', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      mockRedisClient.set.mockResolvedValue('OK');
      const { redisSet } = await import('../../src/utils/redis.js');
      const result = await redisSet('key', 'value');
      expect(result).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalledWith('key', 'value');
    });

    it('should set value with TTL', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      mockRedisClient.setEx.mockResolvedValue('OK');
      const { redisSet } = await import('../../src/utils/redis.js');
      const result = await redisSet('key', 'value', 300);
      expect(result).toBe(true);
      expect(mockRedisClient.setEx).toHaveBeenCalledWith('key', 300, 'value');
    });
  });

  describe('redisGet', () => {
    it('should return null when Redis is not available', async () => {
      delete process.env.REDIS_URL;
      const { redisGet } = await import('../../src/utils/redis.js');
      const result = await redisGet('key');
      expect(result).toBeNull();
    });

    it('should return value when exists', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      mockRedisClient.get.mockResolvedValue('value');
      const { redisGet } = await import('../../src/utils/redis.js');
      const result = await redisGet('key');
      expect(result).toBe('value');
    });

    it('should return null when key does not exist', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      mockRedisClient.get.mockResolvedValue(null);
      const { redisGet } = await import('../../src/utils/redis.js');
      const result = await redisGet('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('redisDel', () => {
    it('should return false when Redis is not available', async () => {
      delete process.env.REDIS_URL;
      const { redisDel } = await import('../../src/utils/redis.js');
      const result = await redisDel('key');
      expect(result).toBe(false);
    });

    it('should delete key', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      mockRedisClient.del.mockResolvedValue(1);
      const { redisDel } = await import('../../src/utils/redis.js');
      const result = await redisDel('key');
      expect(result).toBe(true);
      expect(mockRedisClient.del).toHaveBeenCalledWith('key');
    });
  });

  describe('redisSetJson / redisGetJson', () => {
    it('should store and retrieve JSON', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      const testData = { name: 'test', value: 123 };
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.get.mockResolvedValue(JSON.stringify(testData));

      const { redisSetJson, redisGetJson } = await import('../../src/utils/redis.js');

      const setResult = await redisSetJson('json-key', testData);
      expect(setResult).toBe(true);

      const getResult = await redisGetJson<typeof testData>('json-key');
      expect(getResult).toEqual(testData);
    });

    it('should return null for invalid JSON', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      mockRedisClient.get.mockResolvedValue('invalid-json');

      const { redisGetJson } = await import('../../src/utils/redis.js');
      const result = await redisGetJson('json-key');
      expect(result).toBeNull();
    });
  });

  describe('Whoop token helpers', () => {
    it('should store Whoop tokens', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      mockRedisClient.setEx.mockResolvedValue('OK');
      mockRedisClient.set.mockResolvedValue('OK');

      const { storeWhoopTokens } = await import('../../src/utils/redis.js');
      const result = await storeWhoopTokens({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000, // 1 hour from now
      });

      expect(result).toBe(true);
      expect(mockRedisClient.setEx).toHaveBeenCalled();
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'whoop:refresh_token',
        'refresh-token'
      );
    });

    it('should return null for access token when not available', async () => {
      delete process.env.REDIS_URL;
      const { getWhoopAccessToken } = await import('../../src/utils/redis.js');
      const result = await getWhoopAccessToken();
      expect(result).toBeNull();
    });

    it('should return access token when cached', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      const expiresAt = Date.now() + 3600000;
      mockRedisClient.get.mockResolvedValue(JSON.stringify({
        token: 'cached-token',
        expiresAt,
      }));

      const { getWhoopAccessToken } = await import('../../src/utils/redis.js');
      const result = await getWhoopAccessToken();

      expect(result).toEqual({
        token: 'cached-token',
        expiresAt,
      });
    });

    it('should return null for expired access token', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      mockRedisClient.get.mockResolvedValue(JSON.stringify({
        token: 'expired-token',
        expiresAt: Date.now() - 1000, // Already expired
      }));

      const { getWhoopAccessToken } = await import('../../src/utils/redis.js');
      const result = await getWhoopAccessToken();

      expect(result).toBeNull();
    });

    it('should return refresh token when stored', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      mockRedisClient.get.mockResolvedValue('stored-refresh-token');

      const { getWhoopRefreshToken } = await import('../../src/utils/redis.js');
      const result = await getWhoopRefreshToken();

      expect(result).toBe('stored-refresh-token');
    });
  });

  describe('closeRedis', () => {
    it('should close the connection', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379';
      mockRedisClient.quit.mockResolvedValue(undefined);

      const { getRedisClient, closeRedis } = await import('../../src/utils/redis.js');

      await getRedisClient();
      await closeRedis();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });
  });
});
