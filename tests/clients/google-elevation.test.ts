import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GoogleElevationClient,
  GoogleElevationApiError,
} from '../../src/clients/google-elevation.js';

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

describe('GoogleElevationClient', () => {
  let client: GoogleElevationClient;
  const mockFetch = vi.fn();

  beforeEach(() => {
    client = new GoogleElevationClient({ apiKey: 'test-api-key' });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  describe('getElevation', () => {
    it('GETs /elevation/json with the expected query params', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 'OK',
          results: [
            { elevation: 1608.6, location: { lat: 43.7, lng: -110.6 }, resolution: 4.7 },
          ],
        })
      );

      const response = await client.getElevation(43.7, -110.6);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = new URL(mockFetch.mock.calls[0][0] as string);
      expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/elevation/json');
      expect(url.searchParams.get('locations')).toBe('43.7,-110.6');
      expect(url.searchParams.get('key')).toBe('test-api-key');
      expect(response.status).toBe('OK');
      expect(response.results?.[0]?.elevation).toBe(1608.6);
    });

    it('returns the raw body unchanged when Google reports a non-OK status (HTTP 200)', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ status: 'REQUEST_DENIED', error_message: 'API key invalid', results: [] })
      );

      const response = await client.getElevation(0, 0);

      expect(response.status).toBe('REQUEST_DENIED');
      expect(response.error_message).toBe('API key invalid');
    });
  });

  describe('error handling', () => {
    it('throws GoogleElevationApiError with category=authentication for 401', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 401 }));

      await expect(client.getElevation(0, 0)).rejects.toMatchObject({
        name: 'GoogleElevationApiError',
        category: 'authentication',
        statusCode: 401,
      });
    });

    it('throws GoogleElevationApiError with category=rate_limit for 429', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 429 }));

      await expect(client.getElevation(0, 0)).rejects.toMatchObject({
        name: 'GoogleElevationApiError',
        category: 'rate_limit',
        isRetryable: true,
      });
    });

    it('throws GoogleElevationApiError with category=not_found for 404', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 404 }));

      await expect(client.getElevation(0, 0)).rejects.toMatchObject({
        name: 'GoogleElevationApiError',
        category: 'not_found',
      });
    });

    it('wraps fetch errors as a network GoogleElevationApiError', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

      const err = await client.getElevation(0, 0).catch((e) => e);
      expect(err).toBeInstanceOf(GoogleElevationApiError);
      expect(err.category).toBe('network');
      expect(err.isRetryable).toBe(true);
    });
  });
});
