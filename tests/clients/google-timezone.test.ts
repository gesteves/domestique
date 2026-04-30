import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GoogleTimezoneClient,
  GoogleTimezoneApiError,
} from '../../src/clients/google-timezone.js';

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

describe('GoogleTimezoneClient', () => {
  let client: GoogleTimezoneClient;
  const mockFetch = vi.fn();

  beforeEach(() => {
    client = new GoogleTimezoneClient({ apiKey: 'test-api-key' });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  describe('getTimezone', () => {
    it('GETs /timezone/json with the expected query params and returns timeZoneId', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 'OK',
          timeZoneId: 'America/Los_Angeles',
          timeZoneName: 'Pacific Daylight Time',
          rawOffset: -28800,
          dstOffset: 3600,
        })
      );

      const result = await client.getTimezone(37.7749, -122.4194, 1714521600);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = new URL(mockFetch.mock.calls[0][0] as string);
      expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/timezone/json');
      expect(url.searchParams.get('key')).toBe('test-api-key');
      expect(url.searchParams.get('location')).toBe('37.7749,-122.4194');
      expect(url.searchParams.get('timestamp')).toBe('1714521600');

      expect(result).toBe('America/Los_Angeles');
    });

    it('defaults timestamp to "now" when omitted', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ status: 'OK', timeZoneId: 'Australia/Sydney' })
      );

      const before = Math.floor(Date.now() / 1000);
      await client.getTimezone(-33.8688, 151.2093);
      const after = Math.floor(Date.now() / 1000);

      const url = new URL(mockFetch.mock.calls[0][0] as string);
      const ts = parseInt(url.searchParams.get('timestamp') ?? '0', 10);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('throws not_found when timeZoneId is missing', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ status: 'ZERO_RESULTS' })
      );

      const err = await client.getTimezone(0, 0).catch((e) => e);
      expect(err).toBeInstanceOf(GoogleTimezoneApiError);
      expect(err.category).toBe('not_found');
    });
  });

  describe('error handling', () => {
    it('throws GoogleTimezoneApiError with category=authentication for 401', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 401 }));

      await expect(client.getTimezone(0, 0)).rejects.toMatchObject({
        name: 'GoogleTimezoneApiError',
        category: 'authentication',
        statusCode: 401,
      });
    });

    it('throws GoogleTimezoneApiError with category=rate_limit for 429', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 429 }));

      await expect(client.getTimezone(0, 0)).rejects.toMatchObject({
        name: 'GoogleTimezoneApiError',
        category: 'rate_limit',
        isRetryable: true,
      });
    });

    it('wraps fetch errors as a network GoogleTimezoneApiError', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

      const err = await client.getTimezone(0, 0).catch((e) => e);
      expect(err).toBeInstanceOf(GoogleTimezoneApiError);
      expect(err.category).toBe('network');
      expect(err.isRetryable).toBe(true);
    });
  });
});
