import { ApiError, type ErrorCategory, type ErrorContext } from '../errors/index.js';
import {
  buildGoogleErrorFromHttpStatus,
  buildGoogleNetworkError,
  googleErrorBuilders,
} from './google-api-error-helpers.js';
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
    return buildGoogleErrorFromHttpStatus(GooglePollenApiError, 'Pollen', statusCode, context, responseBody);
  }

  static networkError(context: ErrorContext, originalError?: Error): GooglePollenApiError {
    return buildGoogleNetworkError(GooglePollenApiError, 'Pollen', context, originalError);
  }
}

const googlePollenHttpErrorBuilders = googleErrorBuilders(GooglePollenApiError);

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
   * The endpoint covers up to 5 days. Callers pass the number of days they
   * need (1 for today, `dayOffset + 1` for a future date) and pick the matching
   * entry by date from the returned `dailyInfo[]` in the location's timezone.
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
