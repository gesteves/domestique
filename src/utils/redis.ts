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
const WHOOP_REFRESH_LOCK_KEY = 'whoop:refresh_lock';
const LOCK_TTL_SECONDS = 10; // Max time to hold lock before auto-release

export interface WhoopTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp
}

/**
 * Stored refresh token with version tracking to detect concurrent updates
 */
export interface StoredRefreshToken {
  token: string;
  version: number;
  updatedAt: number;
}

/**
 * Attempt to acquire a distributed lock for token refresh.
 * Uses Redis SET NX EX pattern for mutual exclusion.
 * Returns true if lock was acquired, false if already held by another process.
 */
export async function acquireRefreshLock(lockId: string): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client) {
      // No Redis = no distributed locking, allow the refresh
      console.log('[Redis] No Redis client, skipping lock acquisition');
      return true;
    }

    // SET key value NX EX ttl - only sets if key doesn't exist
    const result = await client.set(WHOOP_REFRESH_LOCK_KEY, lockId, {
      NX: true, // Only set if not exists
      EX: LOCK_TTL_SECONDS, // Auto-expire after TTL
    });

    const acquired = result === 'OK';
    console.log(`[Redis] Lock acquisition attempt: ${acquired ? 'SUCCESS' : 'FAILED (held by another)'}`);
    return acquired;
  } catch (error) {
    console.error('[Redis] Error acquiring refresh lock:', error);
    // On error, allow the refresh to proceed (fail open)
    return true;
  }
}

/**
 * Release the distributed lock for token refresh.
 * Only releases if the lock is held by the given lockId (prevents releasing someone else's lock).
 */
export async function releaseRefreshLock(lockId: string): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) return;

    // Only delete if we own the lock (compare lockId)
    const currentLockId = await client.get(WHOOP_REFRESH_LOCK_KEY);
    if (currentLockId === lockId) {
      await client.del(WHOOP_REFRESH_LOCK_KEY);
      console.log('[Redis] Lock released');
    } else {
      console.log('[Redis] Lock not released (not owner or already expired)');
    }
  } catch (error) {
    console.error('[Redis] Error releasing refresh lock:', error);
  }
}

/**
 * Check if a refresh lock is currently held
 */
export async function isRefreshLockHeld(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client) return false;

    const lockValue = await client.get(WHOOP_REFRESH_LOCK_KEY);
    return lockValue !== null;
  } catch (error) {
    console.error('[Redis] Error checking refresh lock:', error);
    return false;
  }
}

/**
 * Store Whoop tokens in Redis
 * Access token is cached until 5 minutes before expiry
 * Refresh token is stored with version tracking for concurrent update detection
 */
export async function storeWhoopTokens(tokens: WhoopTokens): Promise<{ success: boolean; version: number }> {
  const client = await getRedisClient();
  if (!client) return { success: false, version: 0 };

  // Validate tokens
  if (!tokens.accessToken || typeof tokens.accessToken !== 'string') {
    console.error('Invalid access token:', typeof tokens.accessToken);
    return { success: false, version: 0 };
  }
  if (!tokens.refreshToken || typeof tokens.refreshToken !== 'string') {
    console.error('Invalid refresh token:', typeof tokens.refreshToken);
    return { success: false, version: 0 };
  }

  try {
    // Get current version to increment
    const currentData = await redisGetJson<StoredRefreshToken>(WHOOP_REFRESH_TOKEN_KEY);
    const newVersion = (currentData?.version ?? 0) + 1;

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

    // Store refresh token with version tracking
    const storedRefreshToken: StoredRefreshToken = {
      token: tokens.refreshToken,
      version: newVersion,
      updatedAt: Date.now(),
    };
    await client.set(
      WHOOP_REFRESH_TOKEN_KEY,
      JSON.stringify(storedRefreshToken)
    );

    console.log(`[Redis] Stored tokens with version ${newVersion}`);
    return { success: true, version: newVersion };
  } catch (error) {
    console.error('Error storing Whoop tokens:', error);
    return { success: false, version: 0 };
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
 * Get stored Whoop refresh token with version info
 */
export async function getWhoopRefreshToken(): Promise<StoredRefreshToken | null> {
  const data = await redisGetJson<StoredRefreshToken>(WHOOP_REFRESH_TOKEN_KEY);
  if (!data) {
    // Fallback: try to read as plain string (legacy format)
    const legacyToken = await redisGet(WHOOP_REFRESH_TOKEN_KEY);
    if (legacyToken && !legacyToken.startsWith('{')) {
      // Plain string token, return with version 0
      return { token: legacyToken, version: 0, updatedAt: 0 };
    }
    return null;
  }
  return data;
}

/**
 * Invalidate the cached Whoop access token.
 * Call this when a 401 is received to force a token refresh on next request.
 */
export async function invalidateWhoopAccessToken(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client) return false;

    await client.del(WHOOP_ACCESS_TOKEN_KEY);
    console.log('[Redis] Access token invalidated');
    return true;
  } catch (error) {
    console.error('[Redis] Error invalidating access token:', error);
    return false;
  }
}

/**
 * Get the current version of the stored refresh token.
 * Used to detect if another process has updated the token.
 */
export async function getRefreshTokenVersion(): Promise<number> {
  const data = await getWhoopRefreshToken();
  return data?.version ?? 0;
}
