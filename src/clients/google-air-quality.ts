import { ApiError, type ErrorCategory, type ErrorContext } from '../errors/index.js';
import {
  buildGoogleErrorFromHttpStatus,
  buildGoogleNetworkError,
  googleErrorBuilders,
} from './google-api-error-helpers.js';
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
    return buildGoogleErrorFromHttpStatus(GoogleAirQualityApiError, 'Air Quality', statusCode, context, responseBody);
  }

  static networkError(context: ErrorContext, originalError?: Error): GoogleAirQualityApiError {
    return buildGoogleNetworkError(GoogleAirQualityApiError, 'Air Quality', context, originalError);
  }
}

const googleAirQualityHttpErrorBuilders = googleErrorBuilders(GoogleAirQualityApiError);

/**
 * Client for Google's Air Quality API.
 *
 * Both endpoints are POST with a JSON body (unlike the Weather API, which is
 * GET with query params). The API key is the same Google Cloud key used by
 * the Weather API; the Air Quality API must also be enabled on the project.
 *
 * We always request `LOCAL_AQI` with `universalAqi=true`, plus a
 * `customLocalAqis` override that maps the US to the EPA NowCast variant
 * (more responsive to rapidly-changing air than the default 24h-averaged
 * EPA AQI — better matches what hyperlocal sensors like PurpleAir report).
 * Universal AQI is included as a fallback for regions where Google has no
 * local index. We don't request `HEALTH_RECOMMENDATIONS` — the per-population
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
      universalAqi: true,
      location: { latitude, longitude },
      extraComputations: ['LOCAL_AQI'],
      // Override the default US local AQI (`usa_epa`, 24h-averaged) with the
      // NowCast variant — its weighted-recent-hours formula tracks rapid
      // changes (wildfire smoke, rush-hour spikes) much better and is what
      // AirNow.gov surfaces as "current AQI."
      customLocalAqis: [{ regionCode: 'US', aqi: 'usa_epa_nowcast' }],
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
