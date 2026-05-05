/**
 * Persist TrainerRoad training-phase markers (Base, Build, Specialty,
 * Recovery Week) seen on the iCal feed so they survive the feed's ~3-4 week
 * lookback window. Without this, once an active phase's start marker rolls
 * out of the feed we lose the anchor needed to compute "you are currently in
 * week N of <phase>".
 *
 * Markers are stored as a single JSON array under a fixed key. The data is
 * tiny (a handful of entries per year), so the read-modify-write cost is
 * negligible. When Redis is unavailable, loadMarkers returns an empty list
 * and rememberMarkers is a no-op — callers fall back to live-feed-only
 * behavior.
 */

import { isRedisAvailable, redisGetJson, redisSetJson } from './redis.js';

export const TRAINING_PHASE_NAMES = [
  'Base',
  'Build',
  'Specialty',
  'Recovery Week',
] as const;

export type TrainingPhaseName = (typeof TRAINING_PHASE_NAMES)[number];

export interface CachedPhaseMarker {
  /** Local YYYY-MM-DD date the phase starts */
  date: string;
  name: TrainingPhaseName;
}

const KEY = 'domestique:training-phase-markers:v1';
const TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

/**
 * Read all cached markers, sorted ascending by date. Returns an empty array
 * when Redis is not configured or unreachable.
 */
export async function loadMarkers(): Promise<CachedPhaseMarker[]> {
  if (!(await isRedisAvailable())) return [];
  const cached = await redisGetJson<CachedPhaseMarker[]>(KEY);
  if (!Array.isArray(cached)) return [];
  return [...cached].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Merge `seen` markers into the cache, deduping by date (later writes win
 * on conflict so a marker edited in TR can overwrite the cached entry), and
 * refresh the TTL. No-op when Redis is not configured or unreachable.
 */
export async function rememberMarkers(
  seen: CachedPhaseMarker[]
): Promise<void> {
  if (seen.length === 0) return;
  if (!(await isRedisAvailable())) return;

  const existing = (await redisGetJson<CachedPhaseMarker[]>(KEY)) ?? [];
  const byDate = new Map<string, CachedPhaseMarker>();
  for (const m of existing) byDate.set(m.date, m);
  for (const m of seen) byDate.set(m.date, m);

  const merged = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  await redisSetJson(KEY, merged, TTL_SECONDS);
}

/**
 * Test-only: Redis key for the cache. Exposed so tests can clear it.
 * @internal
 */
export const _CACHE_KEY_FOR_TESTING = KEY;
