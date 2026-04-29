import { ApiError, type ErrorCategory, type ErrorContext } from '../errors/index.js';
import { httpRequestJson } from './http.js';

const GOOGLE_POLLEN_API_BASE = 'https://pollen.googleapis.com/v1';

export interface GooglePollenConfig {
  /** Google Cloud API key with the Pollen API enabled. */
  apiKey: string;
}

/**
 * Localized index entry attached to each pollen type and plant. Google emits
 * an enum `code` (e.g., "UPI") and a `displayName` ("Universal Pollen Index"),
 * along with a numeric `value`, a `category` band, and an `indexDescription`.
 * Color is intentionally not surfaced — it's a presentation concern, not a
 * training one.
 */
export interface GooglePollenIndexInfo {
  code?: string;
  displayName?: string;
  value?: number;
  category?: string;
  indexDescription?: string;
  color?: { red?: number; green?: number; blue?: number };
  [key: string]: unknown;
}

export interface GooglePollenTypeInfo {
  /** Pollen type code: "GRASS", "TREE", or "WEED". */
  code?: string;
  displayName?: string;
  inSeason?: boolean;
  indexInfo?: GooglePollenIndexInfo;
  healthRecommendations?: string[];
  [key: string]: unknown;
}

export interface GooglePollenPlantInfo {
  /** Plant code (e.g., "BIRCH", "GRAMINALES"). */
  code?: string;
  displayName?: string;
  inSeason?: boolean;
  indexInfo?: GooglePollenIndexInfo;
  plantDescription?: unknown;
  [key: string]: unknown;
}

export interface GooglePollenDailyInfo {
  date?: { year?: number; month?: number; day?: number };
  pollenTypeInfo?: GooglePollenTypeInfo[];
  plantInfo?: GooglePollenPlantInfo[];
  [key: string]: unknown;
}

export interface GooglePollenForecastResponse {
  regionCode?: string;
  dailyInfo?: GooglePollenDailyInfo[];
  nextPageToken?: string;
}

export class GooglePollenApiError extends ApiError {
  public override readonly name = 'GooglePollenApiError';

  constructor(
    message: string,
    category: ErrorCategory,
    isRetryable: boolean,
    context: ErrorContext,
    statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message, category, isRetryable, context, 'google-pollen', statusCode);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GooglePollenApiError);
    }
  }

  static fromHttpStatus(
    statusCode: number,
    context: ErrorContext,
    responseBody?: string
  ): GooglePollenApiError {
    const isRetryable = statusCode >= 500 || statusCode === 429;
    let category: ErrorCategory;
    let message: string;

    switch (statusCode) {
      case 400:
        category = 'validation';
        message = 'Google Pollen rejected the request as invalid. Please check the parameters.';
        break;
      case 401:
      case 403:
        category = 'authentication';
        message = 'Google Pollen authentication failed. The API key may be invalid or the Pollen API may not be enabled for the project.';
        break;
      case 404:
        category = 'not_found';
        message = 'Google Pollen had no data for the requested location.';
        break;
      case 429:
        category = 'rate_limit';
        message = 'Google Pollen is rate-limiting requests. Please try again in a few seconds.';
        break;
      default:
        if (statusCode >= 500) {
          category = 'service_unavailable';
          message = 'Google Pollen is temporarily unavailable. Please try again shortly.';
        } else {
          category = 'internal';
          message = `An unexpected error occurred with Google Pollen (${statusCode}).`;
        }
    }

    return new GooglePollenApiError(message, category, isRetryable, context, statusCode, responseBody);
  }

  static networkError(context: ErrorContext, originalError?: Error): GooglePollenApiError {
    const errorDetail = originalError?.message ? `: ${originalError.message}` : '';
    return new GooglePollenApiError(
      `I'm having trouble connecting to Google Pollen${errorDetail}. This is usually temporary. Please try again in a moment.`,
      'network',
      true,
      context
    );
  }
}

const googlePollenHttpErrorBuilders = {
  toHttpError: (status: number, context: ErrorContext, body: string | undefined) =>
    GooglePollenApiError.fromHttpStatus(status, context, body),
  toNetworkError: (context: ErrorContext, err?: Error) =>
    GooglePollenApiError.networkError(context, err),
};

/**
 * Client for Google's Pollen API.
 *
 * GET-based with query params (like the Weather API; unlike Air Quality, which
 * is POST). Auth is the same Google Cloud API key used by the Weather and Air
 * Quality APIs; the Pollen API must also be enabled on the project.
 *
 * We intentionally omit `languageCode` so display names and categories come
 * back in English, and pass `plantsDescription=false` to skip the verbose
 * plant blurbs — the index value/category is what matters for training
 * decisions.
 *
 * @see https://developers.google.com/maps/documentation/pollen
 */
export class GooglePollenClient {
  constructor(private config: GooglePollenConfig) {}

  /**
   * GET /v1/forecast:lookup
   *
   * The endpoint covers up to 5 days; we always request a single day (today
   * in the athlete's timezone), and the calling code matches the returned
   * `dailyInfo[].date` against today before surfacing the data.
   * @see https://developers.google.com/maps/documentation/pollen/forecast
   */
  async getPollenForecast(
    latitude: number,
    longitude: number,
    days: number = 1
  ): Promise<GooglePollenForecastResponse> {
    const url = new URL(`${GOOGLE_POLLEN_API_BASE}/forecast:lookup`);
    url.searchParams.set('key', this.config.apiKey);
    url.searchParams.set('location.latitude', String(latitude));
    url.searchParams.set('location.longitude', String(longitude));
    url.searchParams.set('days', String(days));
    url.searchParams.set('plantsDescription', 'false');

    console.log(`[GooglePollen] Making API call to /forecast:lookup for ${latitude},${longitude}`);

    return httpRequestJson<GooglePollenForecastResponse>({
      url: url.toString(),
      headers: { Accept: 'application/json' },
      context: {
        operation: 'fetch pollen forecast',
        resource: `${latitude},${longitude}`,
        parameters: { days },
      },
      ...googlePollenHttpErrorBuilders,
    });
  }
}
