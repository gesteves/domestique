import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;
let connectionPromise: Promise<RedisClientType> | null = null;

/**
 * Get or create a Redis client connection.
 * Returns null if REDIS_URL is not configured.
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    return null;
  }

  // Return existing client if connected
  if (redisClient?.isOpen) {
    return redisClient;
  }

  // Return pending connection promise if one exists
  if (connectionPromise) {
    return connectionPromise;
  }

  // Create new connection
  connectionPromise = (async () => {
    try {
      const client = createClient({ url: redisUrl });

      client.on('error', (err) => {
        console.error('Redis client error:', err);
      });

      client.on('connect', () => {
        console.log('Redis connected');
      });

      await client.connect();
      redisClient = client as RedisClientType;
      return redisClient;
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      connectionPromise = null;
      throw error;
    }
  })();

  return connectionPromise;
}

/**
 * Check if Redis is available
 */
export async function isRedisAvailable(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    return client !== null && client.isOpen;
  } catch {
    return false;
  }
}

/**
 * Store a value in Redis with optional TTL
 */
export async function redisSet(
  key: string,
  value: string,
  ttlSeconds?: number
): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client) return false;

    if (ttlSeconds) {
      await client.setEx(key, ttlSeconds, value);
    } else {
      await client.set(key, value);
    }
    return true;
  } catch (error) {
    console.error('Redis SET error:', error);
    return false;
  }
}

/**
 * Get a value from Redis
 */
export async function redisGet(key: string): Promise<string | null> {
  try {
    const client = await getRedisClient();
    if (!client) return null;

    return await client.get(key);
  } catch (error) {
    console.error('Redis GET error:', error);
    return null;
  }
}

/**
 * Delete a key from Redis
 */
export async function redisDel(key: string): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client) return false;

    await client.del(key);
    return true;
  } catch (error) {
    console.error('Redis DEL error:', error);
    return false;
  }
}

/**
 * Store JSON data in Redis with optional TTL
 */
export async function redisSetJson<T>(
  key: string,
  value: T,
  ttlSeconds?: number
): Promise<boolean> {
  return redisSet(key, JSON.stringify(value), ttlSeconds);
}

/**
 * Get JSON data from Redis
 */
export async function redisGetJson<T>(key: string): Promise<T | null> {
  const value = await redisGet(key);
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Close the Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient?.isOpen) {
    await redisClient.quit();
    redisClient = null;
    connectionPromise = null;
  }
}

// Whoop token-specific helpers
const WHOOP_ACCESS_TOKEN_KEY = 'whoop:access_token';
const WHOOP_REFRESH_TOKEN_KEY = 'whoop:refresh_token';

export interface WhoopTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp
}

/**
 * Store Whoop tokens in Redis
 * Access token is cached until 5 minutes before expiry
 * Refresh token is stored permanently
 */
export async function storeWhoopTokens(tokens: WhoopTokens): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;

  // Validate tokens
  if (!tokens.accessToken || typeof tokens.accessToken !== 'string') {
    console.error('Invalid access token:', typeof tokens.accessToken);
    return false;
  }
  if (!tokens.refreshToken || typeof tokens.refreshToken !== 'string') {
    console.error('Invalid refresh token:', typeof tokens.refreshToken);
    return false;
  }

  try {
    // Calculate TTL for access token (expire 5 minutes early for safety)
    const accessTtl = Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000) - 300);

    // Store access token with TTL
    if (accessTtl > 0) {
      await client.setEx(
        WHOOP_ACCESS_TOKEN_KEY,
        accessTtl,
        JSON.stringify({
          token: tokens.accessToken,
          expiresAt: tokens.expiresAt,
        })
      );
    }

    // Store refresh token permanently (no expiry)
    await client.set(
      WHOOP_REFRESH_TOKEN_KEY,
      String(tokens.refreshToken)
    );

    return true;
  } catch (error) {
    console.error('Error storing Whoop tokens:', error);
    return false;
  }
}

/**
 * Get cached Whoop access token if valid
 */
export async function getWhoopAccessToken(): Promise<{ token: string; expiresAt: number } | null> {
  const data = await redisGetJson<{ token: string; expiresAt: number }>(WHOOP_ACCESS_TOKEN_KEY);
  if (!data) return null;

  // Double-check expiry (should already be expired in Redis, but be safe)
  if (Date.now() > data.expiresAt - 300000) {
    return null;
  }

  return data;
}

/**
 * Get stored Whoop refresh token
 */
export async function getWhoopRefreshToken(): Promise<string | null> {
  return redisGet(WHOOP_REFRESH_TOKEN_KEY);
}
