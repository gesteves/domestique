import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GooglePollenClient,
  GooglePollenApiError,
} from '../../src/clients/google-pollen.js';

function createMockResponse<T>(
  data: T,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}
): Partial<Response> {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  };
}

describe('GooglePollenClient', () => {
  let client: GooglePollenClient;
  const mockFetch = vi.fn();

  beforeEach(() => {
    client = new GooglePollenClient({ apiKey: 'test-api-key' });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  describe('getPollenForecast', () => {
    it('GETs /forecast:lookup with the expected query params', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ regionCode: 'US', dailyInfo: [] }));

      await client.getPollenForecast(42.87, -112.58);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = new URL(mockFetch.mock.calls[0][0] as string);
      expect(url.origin + url.pathname).toBe('https://pollen.googleapis.com/v1/forecast:lookup');
      expect(url.searchParams.get('key')).toBe('test-api-key');
      expect(url.searchParams.get('location.latitude')).toBe('42.87');
      expect(url.searchParams.get('location.longitude')).toBe('-112.58');
      expect(url.searchParams.get('days')).toBe('1');
      expect(url.searchParams.get('plantsDescription')).toBe('false');
      // No languageCode → response stays in English by default
      expect(url.searchParams.get('languageCode')).toBeNull();
    });

    it('passes through a custom days value', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ dailyInfo: [] }));

      await client.getPollenForecast(0, 0, 3);

      const url = new URL(mockFetch.mock.calls[0][0] as string);
      expect(url.searchParams.get('days')).toBe('3');
    });
  });

  describe('error handling', () => {
    it('throws GooglePollenApiError with category=authentication for 401', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 401 }));

      await expect(client.getPollenForecast(0, 0)).rejects.toMatchObject({
        name: 'GooglePollenApiError',
        category: 'authentication',
        statusCode: 401,
      });
    });

    it('throws GooglePollenApiError with category=rate_limit for 429', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 429 }));

      await expect(client.getPollenForecast(0, 0)).rejects.toMatchObject({
        name: 'GooglePollenApiError',
        category: 'rate_limit',
        isRetryable: true,
      });
    });

    it('throws GooglePollenApiError with category=not_found for 404', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 404 }));

      await expect(client.getPollenForecast(0, 0)).rejects.toMatchObject({
        name: 'GooglePollenApiError',
        category: 'not_found',
      });
    });

    it('wraps fetch errors as a network GooglePollenApiError', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

      const err = await client.getPollenForecast(0, 0).catch((e) => e);
      expect(err).toBeInstanceOf(GooglePollenApiError);
      expect(err.category).toBe('network');
      expect(err.isRetryable).toBe(true);
    });
  });
});
