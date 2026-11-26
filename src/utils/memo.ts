/**
 * Wrap an async fetcher with a cache plus single-flight.
 *
 * - First caller triggers the fetch.
 * - Concurrent callers share the in-flight promise (no thundering herd).
 * - Once resolved, subsequent calls return the cached value until `ttlMs`
 *   elapses (or forever when `ttlMs` is omitted); the next call after expiry
 *   refetches.
 * - If the fetch rejects, the cache is NOT populated; the next call retries.
 *
 * Note that clients holding these caches live for the whole process (the
 * ToolRegistry is created once at startup and shared by every request), so
 * anything the user can edit — FTP, zones, timezone, unit preferences —
 * should pass a TTL so edits are picked up without a restart.
 */
export function memoize<T>(fetcher: () => Promise<T>, ttlMs?: number): () => Promise<T> {
  let cached: { value: T; expiresAt: number } | null = null;
  let inFlight: Promise<T> | null = null;

  return async () => {
    if (cached && Date.now() < cached.expiresAt) return cached.value;
    if (inFlight) return inFlight;
    inFlight = fetcher()
      .then((value) => {
        cached = { value, expiresAt: ttlMs === undefined ? Infinity : Date.now() + ttlMs };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
