import { describe, it, expect, vi } from 'vitest';
import { memoize } from '../../src/utils/memo.js';

describe('memoize', () => {
  it('returns the fetched value on first call', async () => {
    const fetcher = vi.fn().mockResolvedValue('value');
    const memoized = memoize(fetcher);

    expect(await memoized()).toBe('value');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('caches the value across subsequent calls', async () => {
    const fetcher = vi.fn().mockResolvedValue(42);
    const memoized = memoize(fetcher);

    await memoized();
    await memoized();
    await memoized();

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent calls into a single fetch', async () => {
    let resolveFetch: ((value: string) => void) | null = null;
    const fetcher = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolveFetch = resolve; })
    );
    const memoized = memoize(fetcher);

    // Fire three concurrent calls before any resolves.
    const calls = [memoized(), memoized(), memoized()];
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFetch!('shared');
    const results = await Promise.all(calls);

    expect(results).toEqual(['shared', 'shared', 'shared']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not cache rejections — the next call retries', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce('recovered');
    const memoized = memoize(fetcher);

    await expect(memoized()).rejects.toThrow('first failure');
    expect(await memoized()).toBe('recovered');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('caches the value once the fetch resolves, even after a failed attempt', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('success')
      .mockResolvedValueOnce('should not be called');
    const memoized = memoize(fetcher);

    await expect(memoized()).rejects.toThrow();
    expect(await memoized()).toBe('success');
    expect(await memoized()).toBe('success');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight rejection — concurrent callers all see the same error', async () => {
    let rejectFetch: ((reason: Error) => void) | null = null;
    const fetcher = vi.fn().mockImplementation(
      () => new Promise<string>((_, reject) => { rejectFetch = reject; })
    );
    const memoized = memoize(fetcher);

    const calls = [memoized(), memoized()];
    rejectFetch!(new Error('shared failure'));

    const results = await Promise.allSettled(calls);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // After the in-flight settles, a new call retries.
    fetcher.mockResolvedValueOnce('retry');
    expect(await memoized()).toBe('retry');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
