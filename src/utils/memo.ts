/**
 * Wrap an async fetcher with a session-lifetime cache plus single-flight.
 *
 * - First caller triggers the fetch.
 * - Concurrent callers share the in-flight promise (no thundering herd).
 * - Once resolved, subsequent calls return the cached value indefinitely.
 * - If the fetch rejects, the cache is NOT populated; the next call retries.
 *
 * Use for derived/profile data that's effectively constant for the session
 * (timezone, sport settings, unit preferences, body measurements). Not appropriate
 * when the value can change during the session — use a TTL'd cache for those.
 */
export function memoize<T>(fetcher: () => Promise<T>): () => Promise<T> {
  let cached: { value: T } | null = null;
  let inFlight: Promise<T> | null = null;

  return async () => {
    if (cached) return cached.value;
    if (inFlight) return inFlight;
    inFlight = fetcher()
      .then((value) => {
        cached = { value };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
