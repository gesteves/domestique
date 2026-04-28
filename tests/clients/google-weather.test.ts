import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GoogleWeatherClient, GoogleWeatherApiError } from '../../src/clients/google-weather.js';

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

describe('GoogleWeatherClient', () => {
  let client: GoogleWeatherClient;
  const mockFetch = vi.fn();

  beforeEach(() => {
    client = new GoogleWeatherClient({ apiKey: 'test-api-key' });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  describe('getCurrentConditions', () => {
    it('hits the correct endpoint with location, key, and METRIC units', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ currentTime: '2026-04-28T14:00:00Z' }));

      await client.getCurrentConditions(42.87, -112.58);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('https://weather.googleapis.com/v1/currentConditions:lookup');
      expect(url).toContain('key=test-api-key');
      expect(url).toContain('location.latitude=42.87');
      expect(url).toContain('location.longitude=-112.58');
      expect(url).toContain('unitsSystem=METRIC');
    });

    it('returns the parsed body on success', async () => {
      const body = {
        currentTime: '2026-04-28T14:00:00Z',
        temperature: { degrees: 13.7, unit: 'CELSIUS' },
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(body));

      const result = await client.getCurrentConditions(0, 0);
      expect(result.currentTime).toBe('2026-04-28T14:00:00Z');
      expect(result.temperature?.degrees).toBe(13.7);
    });
  });

  describe('getHourlyForecast', () => {
    it('hits the hours forecast endpoint', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ forecastHours: [] }));

      await client.getHourlyForecast(42.87, -112.58);

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('/forecast/hours:lookup');
      expect(url).toContain('location.latitude=42.87');
      expect(url).toContain('location.longitude=-112.58');
      expect(url).toContain('unitsSystem=METRIC');
    });
  });

  describe('getWeatherAlerts', () => {
    it('hits the public alerts endpoint without the unitsSystem param', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ weatherAlerts: [] }));

      await client.getWeatherAlerts(42.87, -112.58);

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('/publicAlerts:lookup');
      expect(url).toContain('location.latitude=42.87');
      expect(url).toContain('location.longitude=-112.58');
      // The alerts endpoint rejects unitsSystem as an unknown field.
      expect(url).not.toContain('unitsSystem');
    });
  });

  describe('error handling', () => {
    it('throws a GoogleWeatherApiError with category=authentication for 401', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ error: { message: 'Invalid key' } }, { ok: false, status: 401 })
      );

      await expect(client.getCurrentConditions(0, 0)).rejects.toMatchObject({
        name: 'GoogleWeatherApiError',
        category: 'authentication',
        statusCode: 401,
      });
    });

    it('throws a GoogleWeatherApiError with category=rate_limit for 429', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({}, { ok: false, status: 429 })
      );

      await expect(client.getHourlyForecast(0, 0)).rejects.toMatchObject({
        name: 'GoogleWeatherApiError',
        category: 'rate_limit',
        statusCode: 429,
        isRetryable: true,
      });
    });

    it('throws a GoogleWeatherApiError with category=service_unavailable for 5xx', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({}, { ok: false, status: 503 })
      );

      await expect(client.getWeatherAlerts(0, 0)).rejects.toMatchObject({
        name: 'GoogleWeatherApiError',
        category: 'service_unavailable',
        statusCode: 503,
        isRetryable: true,
      });
    });

    it('wraps fetch errors as a network GoogleWeatherApiError', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

      const err = await client.getCurrentConditions(0, 0).catch((e) => e);
      expect(err).toBeInstanceOf(GoogleWeatherApiError);
      expect(err.category).toBe('network');
      expect(err.isRetryable).toBe(true);
    });
  });
});
