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
