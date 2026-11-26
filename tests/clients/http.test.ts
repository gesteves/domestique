import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  httpRequestJson,
  httpRequestText,
  httpRequestVoid,
} from '../../src/clients/http.js';
import { ApiError, IntervalsApiError, type ErrorContext } from '../../src/errors/index.js';

const mockFetch = vi.fn();

const builders = {
  toHttpError: (status: number, context: ErrorContext, body: string | undefined) =>
    IntervalsApiError.fromHttpStatus(status, context, body),
  toNetworkError: (context: ErrorContext, original?: Error) =>
    IntervalsApiError.networkError(context, original),
};

const ctx: ErrorContext = { operation: 'test', resource: 'r' };

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockFetch.mockReset();
});

describe('httpRequestJson', () => {
  it('returns parsed JSON on 2xx', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ foo: 'bar' }),
    });

    const result = await httpRequestJson<{ foo: string }>({
      url: 'https://example.test/api',
      context: ctx,
      ...builders,
    });

    expect(result).toEqual({ foo: 'bar' });
  });

  it('throws the caller-provided ApiError subclass on non-2xx and includes the body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"error":"not found"}'),
    });

    await expect(
      httpRequestJson({ url: 'https://example.test/missing', context: ctx, ...builders })
    ).rejects.toBeInstanceOf(IntervalsApiError);
  });

  it('throws a networkError when fetch itself rejects', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    let caught: unknown;
    try {
      await httpRequestJson({ url: 'https://example.test/api', context: ctx, ...builders });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(IntervalsApiError);
    expect((caught as ApiError).category).toBe('network');
  });

  it('reads the response body only once on the success path', async () => {
    const json = vi.fn().mockResolvedValue({ ok: true });
    const text = vi.fn().mockResolvedValue('');
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json, text });

    await httpRequestJson({ url: 'https://example.test/api', context: ctx, ...builders });

    expect(json).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
  });

  it('reads the response body only once on the failure path', async () => {
    const text = vi.fn().mockResolvedValue('boom');
    const json = vi.fn();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json, text });

    await expect(
      httpRequestJson({ url: 'https://example.test/api', context: ctx, ...builders })
    ).rejects.toBeInstanceOf(IntervalsApiError);

    expect(text).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
  });
});

describe('httpRequestText', () => {
  it('returns the body text on 2xx', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve('hello'),
    });

    const result = await httpRequestText({
      url: 'https://example.test/api',
      context: ctx,
      ...builders,
    });

    expect(result).toBe('hello');
  });

  it('throws on non-2xx with the response body included', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () => Promise.resolve('busy'),
    });

    await expect(
      httpRequestText({ url: 'https://example.test/api', context: ctx, ...builders })
    ).rejects.toBeInstanceOf(IntervalsApiError);
  });
});

describe('httpRequestVoid', () => {
  it('resolves on 2xx without consuming the body', async () => {
    const text = vi.fn().mockResolvedValue('');
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text });

    await expect(
      httpRequestVoid({ url: 'https://example.test/api', method: 'DELETE', context: ctx, ...builders })
    ).resolves.toBeUndefined();

    expect(text).not.toHaveBeenCalled();
  });

  it('throws on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve('forbidden'),
    });

    await expect(
      httpRequestVoid({ url: 'https://example.test/api', method: 'DELETE', context: ctx, ...builders })
    ).rejects.toBeInstanceOf(IntervalsApiError);
  });
});

describe('secret-bearing URLs in error logs', () => {
  it('logs logUrl instead of url when the URL itself is secret', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('') });

    await expect(
      httpRequestText({
        url: 'https://calendar.example.test/ics/PRIVATE-TOKEN',
        logUrl: 'calendar feed (URL redacted)',
        context: ctx,
        ...builders,
      })
    ).rejects.toBeInstanceOf(IntervalsApiError);

    const logged = errorSpy.mock.calls.flat().join('\n');
    expect(logged).not.toContain('PRIVATE-TOKEN');
    expect(logged).toContain('calendar feed (URL redacted)');
    errorSpy.mockRestore();
  });

  it('redacts an API key query parameter on network failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(
      httpRequestJson({ url: 'https://example.test/api?key=AIzaSECRET', context: ctx, ...builders })
    ).rejects.toBeInstanceOf(IntervalsApiError);

    const logged = errorSpy.mock.calls.flat().join('\n');
    expect(logged).not.toContain('AIzaSECRET');
    errorSpy.mockRestore();
  });
});

describe('request timeouts', () => {
  it('passes an abort signal to fetch', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) });

    await httpRequestJson({ url: 'https://example.test/api', context: ctx, ...builders });

    expect(mockFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('reports a timeout as a retryable network error that says it timed out', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

    const err = await httpRequestJson({ url: 'https://example.test/api', context: ctx, timeoutMs: 5000, ...builders }).catch((e) => e);

    expect(err).toBeInstanceOf(IntervalsApiError);
    expect(err.isRetryable).toBe(true);
    expect(err.message).toContain('timed out after 5s');
    errorSpy.mockRestore();
  });

  it('actually aborts a request that never responds', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })
    );

    const err = await httpRequestJson({ url: 'https://example.test/api', context: ctx, timeoutMs: 20, ...builders }).catch((e) => e);

    expect(err).toBeInstanceOf(IntervalsApiError);
    expect(err.message).toContain('timed out');
    errorSpy.mockRestore();
  });
});
