import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CachedPhaseMarker } from '../../src/utils/training-phase-cache.js';

// In-memory backing store the redis mock writes through.
let store = new Map<string, string>();
let isAvailable = true;

vi.mock('../../src/utils/redis.js', () => ({
  isRedisAvailable: vi.fn(async () => isAvailable),
  redisGetJson: vi.fn(async (key: string) => {
    const raw = store.get(key);
    return raw ? JSON.parse(raw) : null;
  }),
  redisSetJson: vi.fn(async (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value));
    return true;
  }),
}));

describe('training-phase-cache', () => {
  beforeEach(() => {
    store = new Map();
    isAvailable = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('loadMarkers', () => {
    it('returns an empty array when Redis is unavailable', async () => {
      isAvailable = false;
      const { loadMarkers } = await import('../../src/utils/training-phase-cache.js');
      expect(await loadMarkers()).toEqual([]);
    });

    it('returns an empty array when nothing has been cached yet', async () => {
      const { loadMarkers } = await import('../../src/utils/training-phase-cache.js');
      expect(await loadMarkers()).toEqual([]);
    });

    it('returns cached markers sorted ascending by date', async () => {
      const { loadMarkers, _CACHE_KEY_FOR_TESTING } = await import(
        '../../src/utils/training-phase-cache.js'
      );
      store.set(
        _CACHE_KEY_FOR_TESTING,
        JSON.stringify([
          { date: '2025-02-23', name: 'Recovery Week' },
          { date: '2024-12-29', name: 'Build' },
          { date: '2025-01-26', name: 'Specialty' },
        ] satisfies CachedPhaseMarker[])
      );

      const result = await loadMarkers();

      expect(result.map((m) => m.date)).toEqual([
        '2024-12-29',
        '2025-01-26',
        '2025-02-23',
      ]);
    });
  });

  describe('rememberMarkers', () => {
    it('is a no-op when Redis is unavailable', async () => {
      isAvailable = false;
      const { rememberMarkers, _CACHE_KEY_FOR_TESTING } = await import(
        '../../src/utils/training-phase-cache.js'
      );

      await rememberMarkers([{ date: '2024-12-29', name: 'Build' }]);

      expect(store.get(_CACHE_KEY_FOR_TESTING)).toBeUndefined();
    });

    it('writes a fresh cache when none exists', async () => {
      const { rememberMarkers, loadMarkers } = await import(
        '../../src/utils/training-phase-cache.js'
      );

      await rememberMarkers([
        { date: '2025-01-26', name: 'Specialty' },
        { date: '2024-12-29', name: 'Build' },
      ]);

      const result = await loadMarkers();
      expect(result).toEqual([
        { date: '2024-12-29', name: 'Build' },
        { date: '2025-01-26', name: 'Specialty' },
      ]);
    });

    it('merges new markers with existing cache, deduping by date', async () => {
      const { rememberMarkers, loadMarkers, _CACHE_KEY_FOR_TESTING } = await import(
        '../../src/utils/training-phase-cache.js'
      );
      store.set(
        _CACHE_KEY_FOR_TESTING,
        JSON.stringify([
          { date: '2024-12-29', name: 'Build' },
        ] satisfies CachedPhaseMarker[])
      );

      await rememberMarkers([
        { date: '2025-01-26', name: 'Specialty' },
        { date: '2024-12-29', name: 'Build' }, // duplicate
      ]);

      const result = await loadMarkers();
      expect(result).toEqual([
        { date: '2024-12-29', name: 'Build' },
        { date: '2025-01-26', name: 'Specialty' },
      ]);
    });

    it('lets the new value win when the same date already exists with a different name', async () => {
      const { rememberMarkers, loadMarkers, _CACHE_KEY_FOR_TESTING } = await import(
        '../../src/utils/training-phase-cache.js'
      );
      store.set(
        _CACHE_KEY_FOR_TESTING,
        JSON.stringify([
          { date: '2024-12-29', name: 'Base' }, // stale
        ] satisfies CachedPhaseMarker[])
      );

      await rememberMarkers([{ date: '2024-12-29', name: 'Build' }]);

      const result = await loadMarkers();
      expect(result).toEqual([{ date: '2024-12-29', name: 'Build' }]);
    });

    it('refreshes the TTL on each write', async () => {
      const redis = await import('../../src/utils/redis.js');
      const { rememberMarkers } = await import(
        '../../src/utils/training-phase-cache.js'
      );

      await rememberMarkers([{ date: '2024-12-29', name: 'Build' }]);

      const calls = vi.mocked(redis.redisSetJson).mock.calls;
      expect(calls).toHaveLength(1);
      const [, , ttl] = calls[0];
      expect(ttl).toBe(60 * 60 * 24 * 365);
    });

    it('skips the write entirely when given an empty list', async () => {
      const redis = await import('../../src/utils/redis.js');
      const { rememberMarkers } = await import(
        '../../src/utils/training-phase-cache.js'
      );

      await rememberMarkers([]);

      expect(vi.mocked(redis.redisSetJson)).not.toHaveBeenCalled();
    });
  });
});
