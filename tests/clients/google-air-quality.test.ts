import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GoogleAirQualityClient,
  GoogleAirQualityApiError,
} from '../../src/clients/google-air-quality.js';

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

describe('GoogleAirQualityClient', () => {
  let client: GoogleAirQualityClient;
  const mockFetch = vi.fn();

  beforeEach(() => {
    client = new GoogleAirQualityClient({ apiKey: 'test-api-key' });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  describe('getCurrentAirQuality', () => {
    it('POSTs to /currentConditions:lookup with the expected JSON body', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ dateTime: '2025-01-28T22:04:12Z' }));

      await client.getCurrentAirQuality(42.87, -112.58);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = mockFetch.mock.calls[0][0] as string;
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect(url).toContain('https://airquality.googleapis.com/v1/currentConditions:lookup');
      expect(url).toContain('key=test-api-key');
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        universalAqi: true,
        location: { latitude: 42.87, longitude: -112.58 },
        extraComputations: ['LOCAL_AQI'],
        customLocalAqis: [{ regionCode: 'US', aqi: 'usa_epa_nowcast' }],
        languageCode: 'en',
      });
    });
  });

  describe('getHourlyAirQualityForecast', () => {
    it('POSTs to /forecast:lookup with an hour-aligned period and matching pageSize', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ hourlyForecasts: [] }));

      // 2026-04-28T20:50:56Z → next top-of-hour is 21:00:00Z, +24h = 2026-04-29T21:00:00Z
      const now = new Date('2026-04-28T20:50:56.501Z');
      await client.getHourlyAirQualityForecast(42.87, -112.58, 24, now);

      const url = mockFetch.mock.calls[0][0] as string;
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect(url).toContain('/forecast:lookup');
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        universalAqi: true,
        location: { latitude: 42.87, longitude: -112.58 },
        extraComputations: ['LOCAL_AQI'],
        customLocalAqis: [{ regionCode: 'US', aqi: 'usa_epa_nowcast' }],
        languageCode: 'en',
        period: {
          startTime: '2026-04-28T21:00:00.000Z',
          endTime: '2026-04-29T21:00:00.000Z',
        },
        pageSize: 24,
      });
    });

    it('rounds a timestamp that already lies on the hour up to the next top-of-hour', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ hourlyForecasts: [] }));

      // 21:00:00 exactly → ceil-to-hour stays the same → start from 21:00:00.
      const now = new Date('2026-04-28T21:00:00.000Z');
      await client.getHourlyAirQualityForecast(0, 0, 6, now);

      const init = mockFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.period.startTime).toBe('2026-04-28T21:00:00.000Z');
      expect(body.period.endTime).toBe('2026-04-29T03:00:00.000Z');
      expect(body.pageSize).toBe(6);
    });
  });

  describe('error handling', () => {
    it('throws GoogleAirQualityApiError with category=authentication for 401', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 401 }));

      await expect(client.getCurrentAirQuality(0, 0)).rejects.toMatchObject({
        name: 'GoogleAirQualityApiError',
        category: 'authentication',
        statusCode: 401,
      });
    });

    it('throws GoogleAirQualityApiError with category=rate_limit for 429', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 429 }));

      await expect(client.getHourlyAirQualityForecast(0, 0)).rejects.toMatchObject({
        name: 'GoogleAirQualityApiError',
        category: 'rate_limit',
        isRetryable: true,
      });
    });

    it('wraps fetch errors as a network GoogleAirQualityApiError', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

      const err = await client.getCurrentAirQuality(0, 0).catch((e) => e);
      expect(err).toBeInstanceOf(GoogleAirQualityApiError);
      expect(err.category).toBe('network');
      expect(err.isRetryable).toBe(true);
    });
  });
});
