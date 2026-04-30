import { ApiError, type ErrorCategory, type ErrorContext } from '../errors/index.js';
import { httpRequestJson } from './http.js';

const GOOGLE_ELEVATION_API_BASE = 'https://maps.googleapis.com/maps/api/elevation';

export interface GoogleElevationConfig {
  /** Google Cloud API key with the Elevation API enabled. */
  apiKey: string;
}

export interface GoogleElevationResult {
  /** Elevation in meters above the WGS84 reference ellipsoid. */
  elevation?: number;
  location?: { lat?: number; lng?: number };
  /** Maximum distance between data points (meters) used to interpolate the elevation. */
  resolution?: number;
  [key: string]: unknown;
}

/**
 * The Elevation API returns HTTP 200 even on logical failures (REQUEST_DENIED,
 * OVER_QUERY_LIMIT, INVALID_REQUEST, DATA_NOT_AVAILABLE, UNKNOWN_ERROR), with
 * the failure reason in `status`. The client surfaces the raw response and lets
 * the caller decide how to handle non-OK statuses — for the forecast use case
 * we treat those the same as a missing entry and just omit elevation.
 */
export interface GoogleElevationResponse {
  status?: string;
  results?: GoogleElevationResult[];
  error_message?: string;
  [key: string]: unknown;
}

export class GoogleElevationApiError extends ApiError {
  public override readonly name = 'GoogleElevationApiError';

  constructor(
    message: string,
    category: ErrorCategory,
    isRetryable: boolean,
    context: ErrorContext,
    statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message, category, isRetryable, context, 'google-elevation', statusCode);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GoogleElevationApiError);
    }
  }

  static fromHttpStatus(
    statusCode: number,
    context: ErrorContext,
    responseBody?: string
  ): GoogleElevationApiError {
    const isRetryable = statusCode >= 500 || statusCode === 429;
    let category: ErrorCategory;
    let message: string;

    switch (statusCode) {
      case 400:
        category = 'validation';
        message = 'Google Elevation rejected the request as invalid. Please check the parameters.';
        break;
      case 401:
      case 403:
        category = 'authentication';
        message = 'Google Elevation authentication failed. The API key may be invalid or the Elevation API may not be enabled for the project.';
        break;
      case 404:
        category = 'not_found';
        message = 'Google Elevation had no data for the requested location.';
        break;
      case 429:
        category = 'rate_limit';
        message = 'Google Elevation is rate-limiting requests. Please try again in a few seconds.';
        break;
      default:
        if (statusCode >= 500) {
          category = 'service_unavailable';
          message = 'Google Elevation is temporarily unavailable. Please try again shortly.';
        } else {
          category = 'internal';
          message = `An unexpected error occurred with Google Elevation (${statusCode}).`;
        }
    }

    return new GoogleElevationApiError(message, category, isRetryable, context, statusCode, responseBody);
  }

  static networkError(context: ErrorContext, originalError?: Error): GoogleElevationApiError {
    const errorDetail = originalError?.message ? `: ${originalError.message}` : '';
    return new GoogleElevationApiError(
      `I'm having trouble connecting to Google Elevation${errorDetail}. This is usually temporary. Please try again in a moment.`,
      'network',
      true,
      context
    );
  }
}

const googleElevationHttpErrorBuilders = {
  toHttpError: (status: number, context: ErrorContext, body: string | undefined) =>
    GoogleElevationApiError.fromHttpStatus(status, context, body),
  toNetworkError: (context: ErrorContext, err?: Error) =>
    GoogleElevationApiError.networkError(context, err),
};

/**
 * Client for Google's Elevation API.
 *
 * GET-based with query params. Auth is the same Google Cloud API key used by
 * the Weather, Air Quality, and Pollen APIs; the Elevation API must also be
 * enabled on the project.
 *
 * @see https://developers.google.com/maps/documentation/elevation
 */
export class GoogleElevationClient {
  constructor(private config: GoogleElevationConfig) {}

  /**
   * GET /elevation/json?locations=<lat>,<lng>&key=<key>
   *
   * Returns elevation in meters above the WGS84 reference ellipsoid for a single
   * point. Logical failures (REQUEST_DENIED, OVER_QUERY_LIMIT, etc.) come back
   * as HTTP 200 with a non-OK `status`; this client returns the response as-is
   * for the caller to interpret.
   * @see https://developers.google.com/maps/documentation/elevation/requests-elevation
   */
  async getElevation(latitude: number, longitude: number): Promise<GoogleElevationResponse> {
    const url = new URL(`${GOOGLE_ELEVATION_API_BASE}/json`);
    url.searchParams.set('locations', `${latitude},${longitude}`);
    url.searchParams.set('key', this.config.apiKey);

    console.log(`[GoogleElevation] Making API call to /elevation/json for ${latitude},${longitude}`);

    return httpRequestJson<GoogleElevationResponse>({
      url: url.toString(),
      headers: { Accept: 'application/json' },
      context: {
        operation: 'fetch elevation',
        resource: `${latitude},${longitude}`,
      },
      ...googleElevationHttpErrorBuilders,
    });
  }
}
