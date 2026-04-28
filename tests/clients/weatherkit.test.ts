import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createVerify, generateKeyPairSync } from 'crypto';
import { WeatherKitClient, WeatherKitApiError } from '../../src/clients/weatherkit.js';

function createMockResponse<T>(
  data: T,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}
): Partial<Response> {
  return {
    ok,
    status,
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
    json: () => Promise.resolve(data),
  };
}

/**
 * Decode a base64url string to a Buffer.
 */
function base64urlToBuffer(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

describe('WeatherKitClient', () => {
  // Generate a fresh ES256 keypair per test run so the test is hermetic and
  // doesn't depend on a checked-in private key.
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const privateKeyBase64 = Buffer.from(privateKeyPem).toString('base64');

  const config = {
    keyId: 'TESTKEYID',
    teamId: 'TESTTEAMID',
    serviceId: 'com.example.weather',
    privateKey: privateKeyBase64,
  };

  let client: WeatherKitClient;
  const mockFetch = vi.fn();

  beforeEach(() => {
    client = new WeatherKitClient(config);
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  describe('generateToken', () => {
    it('produces a valid ES256 JWT with the expected header and claims', () => {
      const now = 1_700_000_000_000; // fixed point in time
      const token = client.generateToken(now);

      const parts = token.split('.');
      expect(parts).toHaveLength(3);

      const header = JSON.parse(base64urlToBuffer(parts[0]).toString('utf8'));
      const claims = JSON.parse(base64urlToBuffer(parts[1]).toString('utf8'));

      expect(header).toMatchObject({
        alg: 'ES256',
        kid: 'TESTKEYID',
        id: 'TESTTEAMID.com.example.weather',
      });
      expect(claims).toMatchObject({
        iss: 'TESTTEAMID',
        sub: 'com.example.weather',
        iat: Math.floor(now / 1000),
        exp: Math.floor(now / 1000) + 60,
      });

      // Verify the signature against the public key, using the same R||S
      // raw encoding the client emits.
      const signature = base64urlToBuffer(parts[2]);
      expect(signature.length).toBe(64); // P-256 R||S is 64 bytes
      const verifier = createVerify('SHA256');
      verifier.update(`${parts[0]}.${parts[1]}`);
      verifier.end();
      const ok = verifier.verify(
        { key: publicKeyPem, dsaEncoding: 'ieee-p1363' },
        signature
      );
      expect(ok).toBe(true);
    });

    it('caches the token and returns the same value on a subsequent call', () => {
      const now = 1_700_000_000_000;
      const a = client.generateToken(now);
      const b = client.generateToken(now + 5_000); // within cache window
      expect(a).toBe(b);
    });

    it('generates a fresh token after the cache expires', () => {
      const now = 1_700_000_000_000;
      const a = client.generateToken(now);
      const b = client.generateToken(now + 60_000); // beyond 50s cache
      expect(a).not.toBe(b);
    });
  });

  describe('getAvailability', () => {
    it('calls the availability endpoint with country query param and bearer token', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(['currentWeather', 'forecastDaily'])
      );

      const result = await client.getAvailability(43.6, -110.7, 'US');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('https://weatherkit.apple.com/api/v1/availability/43.6/-110.7');
      expect(url).toContain('country=US');
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: expect.stringMatching(/^Bearer /),
        Accept: 'application/json',
      });
      expect(result).toEqual(['currentWeather', 'forecastDaily']);
    });

    it('throws WeatherKitApiError on a non-2xx response', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse('forbidden', { ok: false, status: 403 })
      );

      await expect(client.getAvailability(43.6, -110.7, 'US')).rejects.toBeInstanceOf(
        WeatherKitApiError
      );
    });
  });

  describe('getWeather', () => {
    it('passes country, dataSets, and timezone as query params', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ currentWeather: {} }));

      await client.getWeather(43.6, -110.7, 'US', 'America/Boise');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/weather/en/43.6/-110.7');
      expect(url).toContain('country=US');
      expect(url).toContain('timezone=America%2FBoise');
      expect(url).toMatch(/dataSets=[A-Za-z%2C]+/);
      // Default datasets should include the major ones we consume
      expect(url).toContain('currentWeather');
      expect(url).toContain('forecastDaily');
      expect(url).toContain('forecastHourly');
      expect(url).toContain('weatherAlerts');
    });

    it('honors a custom dataSets list when provided', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}));

      await client.getWeather(0, 0, 'US', 'UTC', ['currentWeather']);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('dataSets=currentWeather');
      expect(url).not.toContain('forecastDaily');
    });

    it('honors a custom language', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({}));

      await client.getWeather(0, 0, 'ES', 'UTC', undefined, 'es');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/weather/es/0/0');
    });

    it('returns the parsed response body', async () => {
      const payload = {
        currentWeather: { temperature: 20.5, conditionCode: 'Clear' },
        forecastDaily: { days: [] },
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(payload));

      const result = await client.getWeather(0, 0, 'US', 'UTC');
      expect(result).toEqual(payload);
    });
  });
});
