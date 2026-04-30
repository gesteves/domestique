import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GoogleGeocodingClient,
  GoogleGeocodingApiError,
} from '../../src/clients/google-geocoding.js';

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

describe('GoogleGeocodingClient', () => {
  let client: GoogleGeocodingClient;
  const mockFetch = vi.fn();

  beforeEach(() => {
    client = new GoogleGeocodingClient({ apiKey: 'test-api-key' });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  describe('geocode', () => {
    it('GETs /geocode/json with the expected query params', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 'OK',
          results: [
            {
              formatted_address: 'San Francisco, CA, USA',
              geometry: { location: { lat: 37.7749, lng: -122.4194 } },
            },
          ],
        })
      );

      const result = await client.geocode('San Francisco, CA');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = new URL(mockFetch.mock.calls[0][0] as string);
      expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/geocode/json');
      expect(url.searchParams.get('key')).toBe('test-api-key');
      expect(url.searchParams.get('address')).toBe('San Francisco, CA');

      expect(result).toEqual({
        formattedAddress: 'San Francisco, CA, USA',
        latitude: 37.7749,
        longitude: -122.4194,
      });
    });

    it('returns the top result when multiple are present', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 'OK',
          results: [
            {
              formatted_address: 'Springfield, IL, USA',
              geometry: { location: { lat: 39.7817, lng: -89.6501 } },
            },
            {
              formatted_address: 'Springfield, MA, USA',
              geometry: { location: { lat: 42.1015, lng: -72.5898 } },
            },
          ],
        })
      );

      const result = await client.geocode('Springfield');
      expect(result.formattedAddress).toBe('Springfield, IL, USA');
      expect(result.latitude).toBe(39.7817);
      expect(result.longitude).toBe(-89.6501);
    });

    it('falls back to the query when formatted_address is missing', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 'OK',
          results: [{ geometry: { location: { lat: 1, lng: 2 } } }],
        })
      );

      const result = await client.geocode('somewhere');
      expect(result.formattedAddress).toBe('somewhere');
      expect(result.latitude).toBe(1);
      expect(result.longitude).toBe(2);
    });

    it('throws not_found when results is empty (ZERO_RESULTS)', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ status: 'ZERO_RESULTS', results: [] })
      );

      const err = await client.geocode('zzzzz').catch((e) => e);
      expect(err).toBeInstanceOf(GoogleGeocodingApiError);
      expect(err.category).toBe('not_found');
    });

    it('throws not_found when geometry coordinates are missing', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 'OK',
          results: [{ formatted_address: 'Nowhere' }],
        })
      );

      const err = await client.geocode('Nowhere').catch((e) => e);
      expect(err).toBeInstanceOf(GoogleGeocodingApiError);
      expect(err.category).toBe('not_found');
    });
  });

  describe('error handling', () => {
    it('throws GoogleGeocodingApiError with category=authentication for 401', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 401 }));

      await expect(client.geocode('x')).rejects.toMatchObject({
        name: 'GoogleGeocodingApiError',
        category: 'authentication',
        statusCode: 401,
      });
    });

    it('throws GoogleGeocodingApiError with category=rate_limit for 429', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 429 }));

      await expect(client.geocode('x')).rejects.toMatchObject({
        name: 'GoogleGeocodingApiError',
        category: 'rate_limit',
        isRetryable: true,
      });
    });

    it('throws GoogleGeocodingApiError with category=not_found for 404', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 404 }));

      await expect(client.geocode('x')).rejects.toMatchObject({
        name: 'GoogleGeocodingApiError',
        category: 'not_found',
      });
    });

    it('wraps fetch errors as a network GoogleGeocodingApiError', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

      const err = await client.geocode('x').catch((e) => e);
      expect(err).toBeInstanceOf(GoogleGeocodingApiError);
      expect(err.category).toBe('network');
      expect(err.isRetryable).toBe(true);
    });
  });
});
