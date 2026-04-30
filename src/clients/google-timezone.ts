import { ApiError, type ErrorCategory, type ErrorContext } from '../errors/index.js';
import { httpRequestJson } from './http.js';

const GOOGLE_TIMEZONE_API_BASE = 'https://maps.googleapis.com/maps/api/timezone';

export interface GoogleTimezoneConfig {
  /** Google Cloud API key with the Time Zone API enabled. */
  apiKey: string;
}

/**
 * Raw Time Zone API response. Logical failures (REQUEST_DENIED, INVALID_REQUEST,
 * OVER_QUERY_LIMIT, ZERO_RESULTS, UNKNOWN_ERROR) come back as HTTP 200 with a
 * non-OK `status`; the client interprets those.
 */
export interface GoogleTimezoneResponse {
  status?: string;
  /** IANA time zone identifier (e.g., "America/Los_Angeles"). */
  timeZoneId?: string;
  /** Localized human name (e.g., "Pacific Daylight Time"). Not surfaced — the IANA id is what we need. */
  timeZoneName?: string;
  rawOffset?: number;
  dstOffset?: number;
  errorMessage?: string;
  [key: string]: unknown;
}

export class GoogleTimezoneApiError extends ApiError {
  public override readonly name = 'GoogleTimezoneApiError';

  constructor(
    message: string,
    category: ErrorCategory,
    isRetryable: boolean,
    context: ErrorContext,
    statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message, category, isRetryable, context, 'google-timezone', statusCode);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GoogleTimezoneApiError);
    }
  }

  static fromHttpStatus(
    statusCode: number,
    context: ErrorContext,
    responseBody?: string
  ): GoogleTimezoneApiError {
    const isRetryable = statusCode >= 500 || statusCode === 429;
    let category: ErrorCategory;
    let message: string;

    switch (statusCode) {
      case 400:
        category = 'validation';
        message = 'Google Time Zone rejected the request as invalid. Please check the parameters.';
        break;
      case 401:
      case 403:
        category = 'authentication';
        message = 'Google Time Zone authentication failed. The API key may be invalid or the Time Zone API may not be enabled for the project.';
        break;
      case 404:
        category = 'not_found';
        message = 'Google Time Zone had no data for the requested location.';
        break;
      case 429:
        category = 'rate_limit';
        message = 'Google Time Zone is rate-limiting requests. Please try again in a few seconds.';
        break;
      default:
        if (statusCode >= 500) {
          category = 'service_unavailable';
          message = 'Google Time Zone is temporarily unavailable. Please try again shortly.';
        } else {
          category = 'internal';
          message = `An unexpected error occurred with Google Time Zone (${statusCode}).`;
        }
    }

    return new GoogleTimezoneApiError(message, category, isRetryable, context, statusCode, responseBody);
  }

  static networkError(context: ErrorContext, originalError?: Error): GoogleTimezoneApiError {
    const errorDetail = originalError?.message ? `: ${originalError.message}` : '';
    return new GoogleTimezoneApiError(
      `I'm having trouble connecting to Google Time Zone${errorDetail}. This is usually temporary. Please try again in a moment.`,
      'network',
      true,
      context
    );
  }

  static missingTimeZoneId(context: ErrorContext): GoogleTimezoneApiError {
    return new GoogleTimezoneApiError(
      'Google Time Zone returned a response without a timeZoneId.',
      'not_found',
      false,
      context
    );
  }
}

const googleTimezoneHttpErrorBuilders = {
  toHttpError: (status: number, context: ErrorContext, body: string | undefined) =>
    GoogleTimezoneApiError.fromHttpStatus(status, context, body),
  toNetworkError: (context: ErrorContext, err?: Error) =>
    GoogleTimezoneApiError.networkError(context, err),
};

/**
 * Client for Google's Time Zone API.
 *
 * GET-based with query params. Auth is the same Google Cloud API key used by
 * the Weather, Air Quality, Pollen, Elevation, and Geocoding APIs; the Time
 * Zone API must also be enabled on the project.
 *
 * @see https://developers.google.com/maps/documentation/timezone
 */
export class GoogleTimezoneClient {
  constructor(private config: GoogleTimezoneConfig) {}

  /**
   * GET /timezone/json?location=<lat>,<lng>&timestamp=<unix>&key=<key>
   *
   * Returns the IANA time zone identifier for the given coordinates. The
   * `timestamp` parameter is required by the API to determine DST status; we
   * default to "now" since forecast use cases care about the current/near-future
   * tz, and DST transitions within a 10-day forecast window are rare and
   * negligible for forecast display.
   *
   * Throws on logical failures (HTTP 200 with non-OK `status`) or missing
   * `timeZoneId`.
   *
   * @see https://developers.google.com/maps/documentation/timezone/requests-timezone
   */
  async getTimezone(latitude: number, longitude: number, timestamp?: number): Promise<string> {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    const url = new URL(`${GOOGLE_TIMEZONE_API_BASE}/json`);
    url.searchParams.set('location', `${latitude},${longitude}`);
    url.searchParams.set('timestamp', String(ts));
    url.searchParams.set('key', this.config.apiKey);

    console.log(`[GoogleTimezone] Making API call to /timezone/json for ${latitude},${longitude}`);

    const context: ErrorContext = {
      operation: 'fetch time zone',
      resource: `${latitude},${longitude}`,
    };

    const response = await httpRequestJson<GoogleTimezoneResponse>({
      url: url.toString(),
      headers: { Accept: 'application/json' },
      context,
      ...googleTimezoneHttpErrorBuilders,
    });

    if (!response.timeZoneId) {
      throw GoogleTimezoneApiError.missingTimeZoneId(context);
    }
    return response.timeZoneId;
  }
}
