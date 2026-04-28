import { createSign } from 'crypto';
import { ApiError, type ErrorCategory, type ErrorContext } from '../errors/index.js';
import { httpRequestJson } from './http.js';

const WEATHERKIT_API_BASE = 'https://weatherkit.apple.com/api/v1';

export interface WeatherKitConfig {
  /** Apple Developer Key ID for the WeatherKit key */
  keyId: string;
  /** Apple Developer Team ID */
  teamId: string;
  /** Service ID registered in the Apple Developer portal for WeatherKit */
  serviceId: string;
  /**
   * Base64-encoded PEM private key (.p8) issued by Apple.
   * Stored base64-encoded so the multiline PEM survives single-line env-var transports.
   */
  privateKey: string;
}

/**
 * Subset of WeatherKit's `/weather` response that we consume. WeatherKit returns
 * additional datasets we don't currently use; the `[key: string]: unknown` index
 * lets us pass them through to assembly without losing data.
 */
export interface WeatherKitWeatherResponse {
  currentWeather?: WeatherKitCurrentWeather;
  forecastDaily?: WeatherKitDailyForecast;
  forecastHourly?: WeatherKitHourlyForecast;
  weatherAlerts?: WeatherKitAlertCollection;
  [key: string]: unknown;
}

export interface WeatherKitCurrentWeather {
  metadata?: Record<string, unknown>;
  asOf?: string;
  cloudCover?: number;
  cloudCoverLowAltPct?: number;
  cloudCoverMidAltPct?: number;
  cloudCoverHighAltPct?: number;
  conditionCode?: string;
  daylight?: boolean;
  humidity?: number;
  precipitationIntensity?: number;
  pressure?: number;
  pressureTrend?: string;
  temperature?: number;
  temperatureApparent?: number;
  temperatureDewPoint?: number;
  uvIndex?: number;
  visibility?: number;
  windDirection?: number;
  windGust?: number;
  windSpeed?: number;
  [key: string]: unknown;
}

export interface WeatherKitDailyForecast {
  metadata?: Record<string, unknown>;
  days?: WeatherKitDay[];
}

export interface WeatherKitDayPart {
  forecastStart?: string;
  forecastEnd?: string;
  cloudCover?: number;
  conditionCode?: string;
  humidity?: number;
  precipitationAmount?: number;
  precipitationChance?: number;
  precipitationType?: string;
  snowfallAmount?: number;
  temperatureMax?: number;
  temperatureMin?: number;
  windDirection?: number;
  windGustSpeedMax?: number;
  windSpeed?: number;
  windSpeedMax?: number;
  [key: string]: unknown;
}

export interface WeatherKitDay {
  forecastStart?: string;
  forecastEnd?: string;
  conditionCode?: string;
  daytimeForecast?: WeatherKitDayPart;
  overnightForecast?: WeatherKitDayPart;
  restOfDayForecast?: WeatherKitDayPart;
  [key: string]: unknown;
}

export interface WeatherKitHourlyForecast {
  metadata?: Record<string, unknown>;
  hours?: WeatherKitHour[];
}

export interface WeatherKitHour {
  forecastStart?: string;
  cloudCover?: number;
  conditionCode?: string;
  daylight?: boolean;
  humidity?: number;
  precipitationAmount?: number;
  precipitationIntensity?: number;
  precipitationChance?: number;
  precipitationType?: string;
  pressure?: number;
  pressureTrend?: string;
  snowfallIntensity?: number;
  snowfallAmount?: number;
  temperature?: number;
  temperatureApparent?: number;
  temperatureDewPoint?: number;
  uvIndex?: number;
  visibility?: number;
  windDirection?: number;
  windGust?: number;
  windSpeed?: number;
  [key: string]: unknown;
}

export interface WeatherKitAlertCollection {
  detailsUrl?: string;
  alerts?: WeatherKitAlert[];
}

export interface WeatherKitAlert {
  id?: string;
  areaId?: string;
  attributionURL?: string;
  countryCode?: string;
  description?: string;
  token?: string;
  effectiveTime?: string;
  expireTime?: string;
  issuedTime?: string;
  eventOnsetTime?: string;
  eventEndTime?: string;
  detailsUrl?: string;
  phenomenon?: string;
  precedence?: number;
  severity?: string;
  significance?: string;
  source?: string;
  eventSource?: string;
  urgency?: string;
  certainty?: string;
  importance?: string;
  responses?: string[];
  [key: string]: unknown;
}

/**
 * Error thrown when WeatherKit API calls fail.
 *
 * Defined here (rather than in src/errors/index.ts) because WeatherKit is the
 * only client that uses this source — keeping it co-located avoids editing the
 * shared errors module for a single new integration.
 */
export class WeatherKitApiError extends ApiError {
  public override readonly name = 'WeatherKitApiError';

  constructor(
    message: string,
    category: ErrorCategory,
    isRetryable: boolean,
    context: ErrorContext,
    statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message, category, isRetryable, context, 'weatherkit', statusCode);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WeatherKitApiError);
    }
  }

  static fromHttpStatus(
    statusCode: number,
    context: ErrorContext,
    responseBody?: string
  ): WeatherKitApiError {
    const isRetryable = statusCode >= 500 || statusCode === 429;
    let category: ErrorCategory;
    let message: string;

    switch (statusCode) {
      case 400:
        category = 'validation';
        message = 'WeatherKit rejected the request as invalid. Please check the parameters.';
        break;
      case 401:
      case 403:
        category = 'authentication';
        message = 'WeatherKit authentication failed. The key, team ID, or service ID may be incorrect.';
        break;
      case 404:
        category = 'not_found';
        message = 'WeatherKit had no data for the requested location.';
        break;
      case 429:
        category = 'rate_limit';
        message = 'WeatherKit is rate-limiting requests. Please try again in a few seconds.';
        break;
      default:
        if (statusCode >= 500) {
          category = 'service_unavailable';
          message = 'WeatherKit is temporarily unavailable. Please try again shortly.';
        } else {
          category = 'internal';
          message = `An unexpected error occurred with WeatherKit (${statusCode}).`;
        }
    }

    return new WeatherKitApiError(message, category, isRetryable, context, statusCode, responseBody);
  }

  static networkError(context: ErrorContext, originalError?: Error): WeatherKitApiError {
    const errorDetail = originalError?.message ? `: ${originalError.message}` : '';
    return new WeatherKitApiError(
      `I'm having trouble connecting to WeatherKit${errorDetail}. This is usually temporary. Please try again in a moment.`,
      'network',
      true,
      context
    );
  }
}

const weatherKitHttpErrorBuilders = {
  toHttpError: (status: number, context: ErrorContext, body: string | undefined) =>
    WeatherKitApiError.fromHttpStatus(status, context, body),
  toNetworkError: (context: ErrorContext, err?: Error) =>
    WeatherKitApiError.networkError(context, err),
};

/**
 * Encode a Buffer or string as base64url (RFC 7515 §2 — used by JWT).
 */
function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64url');
}

/**
 * Client for Apple's WeatherKit REST API.
 *
 * Auth uses a JWT signed with ES256 (P-256/ECDSA + SHA-256). The JWT must
 * include a `kid` (key ID) and a custom `id` claim of `<teamId>.<serviceId>`,
 * per Apple's spec. Tokens are short-lived (≤1 minute); we cache locally for
 * 50s to amortize the signing cost across availability + weather calls.
 *
 * @see https://developer.apple.com/documentation/weatherkitrestapi
 */
export class WeatherKitClient {
  private cachedToken?: { token: string; expiresAt: number };

  constructor(private config: WeatherKitConfig) {}

  /**
   * Generate (or return a cached) JWT bearer token for WeatherKit.
   * The token is valid for 60 seconds; cached for 50 to leave a safety margin.
   */
  generateToken(now: number = Date.now()): string {
    const cached = this.cachedToken;
    if (cached && cached.expiresAt > now + 5_000) {
      return cached.token;
    }

    const iat = Math.floor(now / 1000);
    const exp = iat + 60;

    const header = {
      alg: 'ES256',
      kid: this.config.keyId,
      typ: 'JWT',
      id: `${this.config.teamId}.${this.config.serviceId}`,
    };

    const claims = {
      iss: this.config.teamId,
      iat,
      exp,
      sub: this.config.serviceId,
    };

    const headerB64 = base64url(JSON.stringify(header));
    const claimsB64 = base64url(JSON.stringify(claims));
    const signingInput = `${headerB64}.${claimsB64}`;

    const privateKeyPem = Buffer.from(this.config.privateKey, 'base64').toString('utf8');

    const signer = createSign('SHA256');
    signer.update(signingInput);
    signer.end();
    // dsaEncoding: 'ieee-p1363' returns the raw R||S concatenation that JWT
    // requires; the default DER encoding would need a manual conversion.
    const signature = signer.sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
    const token = `${signingInput}.${base64url(signature)}`;

    this.cachedToken = { token, expiresAt: now + 50_000 };
    return token;
  }

  /**
   * GET /api/v1/availability/{lat}/{lon}?country={country}
   * Returns the list of dataset names available for the location.
   * @see https://developer.apple.com/documentation/weatherkitrestapi/get_api_v1_availability_latitude_longitude
   */
  async getAvailability(
    latitude: number,
    longitude: number,
    country: string
  ): Promise<string[]> {
    const url = new URL(`${WEATHERKIT_API_BASE}/availability/${latitude}/${longitude}`);
    url.searchParams.set('country', country);

    console.log(`[WeatherKit] Making API call to /availability/${latitude}/${longitude}`);

    return httpRequestJson<string[]>({
      url: url.toString(),
      headers: {
        Authorization: `Bearer ${this.generateToken()}`,
        Accept: 'application/json',
      },
      context: {
        operation: 'fetch availability',
        resource: `${latitude},${longitude}`,
        parameters: { country },
      },
      ...weatherKitHttpErrorBuilders,
    });
  }

  /**
   * GET /api/v1/weather/{language}/{lat}/{lon}?dataSets=...&country=...&timezone=...
   * @see https://developer.apple.com/documentation/weatherkitrestapi/get_api_v1_weather_language_latitude_longitude
   */
  async getWeather(
    latitude: number,
    longitude: number,
    country: string,
    timezone: string,
    dataSets?: string[],
    language: string = 'en'
  ): Promise<WeatherKitWeatherResponse> {
    const sets =
      dataSets && dataSets.length > 0
        ? dataSets
        : ['currentWeather', 'forecastDaily', 'forecastHourly', 'forecastNextHour', 'weatherAlerts'];

    const url = new URL(
      `${WEATHERKIT_API_BASE}/weather/${language}/${latitude}/${longitude}`
    );
    url.searchParams.set('country', country);
    url.searchParams.set('dataSets', sets.join(','));
    url.searchParams.set('timezone', timezone);

    console.log(`[WeatherKit] Making API call to /weather/${language}/${latitude}/${longitude}`);

    return httpRequestJson<WeatherKitWeatherResponse>({
      url: url.toString(),
      headers: {
        Authorization: `Bearer ${this.generateToken()}`,
        Accept: 'application/json',
      },
      context: {
        operation: 'fetch weather',
        resource: `${latitude},${longitude}`,
        parameters: { country, timezone, dataSets: sets.join(',') },
      },
      ...weatherKitHttpErrorBuilders,
    });
  }
}
