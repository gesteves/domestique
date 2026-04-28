import { ApiError, type ErrorCategory, type ErrorContext } from '../errors/index.js';
import { httpRequestJson } from './http.js';

const GOOGLE_AIR_QUALITY_API_BASE = 'https://airquality.googleapis.com/v1';

export interface GoogleAirQualityConfig {
  /** Google Cloud API key with the Air Quality API enabled. */
  apiKey: string;
}

/**
 * One AQI index entry from the Air Quality API. The API can return the
 * Universal AQI (`uaqi`) and/or one or more local indexes (e.g. `usa_epa`,
 * `gbr_defra`); we always request the local index only and pick the first
 * entry. Color is intentionally not surfaced — irrelevant for training
 * decisions.
 */
export interface GoogleAirQualityIndex {
  code?: string;
  displayName?: string;
  aqi?: number;
  aqiDisplay?: string;
  category?: string;
  dominantPollutant?: string;
  [key: string]: unknown;
}

export interface GoogleCurrentAirQualityResponse {
  dateTime?: string;
  regionCode?: string;
  indexes?: GoogleAirQualityIndex[];
  [key: string]: unknown;
}

export interface GoogleAirQualityHourlyEntry {
  dateTime?: string;
  indexes?: GoogleAirQualityIndex[];
  [key: string]: unknown;
}

export interface GoogleAirQualityHourlyResponse {
  hourlyForecasts?: GoogleAirQualityHourlyEntry[];
  regionCode?: string;
  nextPageToken?: string;
}

export class GoogleAirQualityApiError extends ApiError {
  public override readonly name = 'GoogleAirQualityApiError';

  constructor(
    message: string,
    category: ErrorCategory,
    isRetryable: boolean,
    context: ErrorContext,
    statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message, category, isRetryable, context, 'google-air-quality', statusCode);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GoogleAirQualityApiError);
    }
  }

  static fromHttpStatus(
    statusCode: number,
    context: ErrorContext,
    responseBody?: string
  ): GoogleAirQualityApiError {
    const isRetryable = statusCode >= 500 || statusCode === 429;
    let category: ErrorCategory;
    let message: string;

    switch (statusCode) {
      case 400:
        category = 'validation';
        message = 'Google Air Quality rejected the request as invalid. Please check the parameters.';
        break;
      case 401:
      case 403:
        category = 'authentication';
        message = 'Google Air Quality authentication failed. The API key may be invalid or the Air Quality API may not be enabled for the project.';
        break;
      case 404:
        category = 'not_found';
        message = 'Google Air Quality had no data for the requested location.';
        break;
      case 429:
        category = 'rate_limit';
        message = 'Google Air Quality is rate-limiting requests. Please try again in a few seconds.';
        break;
      default:
        if (statusCode >= 500) {
          category = 'service_unavailable';
          message = 'Google Air Quality is temporarily unavailable. Please try again shortly.';
        } else {
          category = 'internal';
          message = `An unexpected error occurred with Google Air Quality (${statusCode}).`;
        }
    }

    return new GoogleAirQualityApiError(message, category, isRetryable, context, statusCode, responseBody);
  }

  static networkError(context: ErrorContext, originalError?: Error): GoogleAirQualityApiError {
    const errorDetail = originalError?.message ? `: ${originalError.message}` : '';
    return new GoogleAirQualityApiError(
      `I'm having trouble connecting to Google Air Quality${errorDetail}. This is usually temporary. Please try again in a moment.`,
      'network',
      true,
      context
    );
  }
}

const googleAirQualityHttpErrorBuilders = {
  toHttpError: (status: number, context: ErrorContext, body: string | undefined) =>
    GoogleAirQualityApiError.fromHttpStatus(status, context, body),
  toNetworkError: (context: ErrorContext, err?: Error) =>
    GoogleAirQualityApiError.networkError(context, err),
};

/**
 * Client for Google's Air Quality API.
 *
 * Both endpoints are POST with a JSON body (unlike the Weather API, which is
 * GET with query params). The API key is the same Google Cloud key used by
 * the Weather API; the Air Quality API must also be enabled on the project.
 *
 * We always request `LOCAL_AQI` with `universalAqi=false` so the response
 * carries the regionally-relevant index (e.g., US EPA in the US, DEFRA in
 * the UK). We don't request `HEALTH_RECOMMENDATIONS` — the per-population
 * advice Google returns is generic enough that it doesn't add useful signal
 * over the AQI band itself.
 *
 * @see https://developers.google.com/maps/documentation/air-quality
 */
export class GoogleAirQualityClient {
  constructor(private config: GoogleAirQualityConfig) {}

  private url(path: string): string {
    const url = new URL(`${GOOGLE_AIR_QUALITY_API_BASE}${path}`);
    url.searchParams.set('key', this.config.apiKey);
    return url.toString();
  }

  private buildBody(
    latitude: number,
    longitude: number,
    extra?: Record<string, unknown>
  ): string {
    return JSON.stringify({
      universalAqi: false,
      location: { latitude, longitude },
      extraComputations: ['LOCAL_AQI'],
      languageCode: 'en',
      ...extra,
    });
  }

  /**
   * POST /v1/currentConditions:lookup
   * @see https://developers.google.com/maps/documentation/air-quality/current-conditions
   */
  async getCurrentAirQuality(
    latitude: number,
    longitude: number
  ): Promise<GoogleCurrentAirQualityResponse> {
    console.log(`[GoogleAirQuality] Making API call to /currentConditions:lookup for ${latitude},${longitude}`);

    return httpRequestJson<GoogleCurrentAirQualityResponse>({
      url: this.url('/currentConditions:lookup'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: this.buildBody(latitude, longitude),
      context: {
        operation: 'fetch current air quality',
        resource: `${latitude},${longitude}`,
      },
      ...googleAirQualityHttpErrorBuilders,
    });
  }

  /**
   * POST /v1/forecast:lookup
   *
   * Requests the next `hours` of forecast (max 96 per the API). The endpoint
   * only accepts `period.startTime`/`endTime` — neither `hours` nor
   * `dateTime` is a valid field on the request body. The endpoint also
   * rejects timestamps that aren't hour-aligned, and a startTime that's
   * even slightly in the past — so we round UP to the next top of the
   * hour. `pageSize` is matched to `hours` so a single page returns
   * everything we asked for.
   *
   * @see https://developers.google.com/maps/documentation/air-quality/hourly-forecast
   */
  async getHourlyAirQualityForecast(
    latitude: number,
    longitude: number,
    hours: number = 24,
    now: Date = new Date()
  ): Promise<GoogleAirQualityHourlyResponse> {
    const startTime = nextTopOfHour(now).toISOString();
    const endTime = new Date(
      nextTopOfHour(now).getTime() + hours * 60 * 60 * 1000
    ).toISOString();

    console.log(`[GoogleAirQuality] Making API call to /forecast:lookup for ${latitude},${longitude}`);

    return httpRequestJson<GoogleAirQualityHourlyResponse>({
      url: this.url('/forecast:lookup'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: this.buildBody(latitude, longitude, {
        period: { startTime, endTime },
        pageSize: hours,
      }),
      context: {
        operation: 'fetch hourly air quality forecast',
        resource: `${latitude},${longitude}`,
        parameters: { startTime, endTime, hours },
      },
      ...googleAirQualityHttpErrorBuilders,
    });
  }
}

/**
 * Round a Date UP to the next top-of-the-hour. Used to align Air Quality
 * forecast windows: the API requires `startTime` to be hour-aligned and
 * strictly in the future.
 */
function nextTopOfHour(date: Date): Date {
  const oneHour = 60 * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / oneHour) * oneHour);
}
