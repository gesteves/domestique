import { ApiError, type ErrorCategory, type ErrorContext } from '../errors/index.js';
import {
  buildGoogleErrorFromHttpStatus,
  buildGoogleNetworkError,
  googleErrorBuilders,
} from './google-api-error-helpers.js';
import { httpRequestJson } from './http.js';

const GOOGLE_GEOCODING_API_BASE = 'https://maps.googleapis.com/maps/api/geocode';

export interface GoogleGeocodingConfig {
  /** Google Cloud API key with the Geocoding API enabled. */
  apiKey: string;
}

export interface GoogleGeocodingResult {
  formatted_address?: string;
  geometry?: {
    location?: { lat?: number; lng?: number };
    location_type?: string;
  };
  place_id?: string;
  types?: string[];
  [key: string]: unknown;
}

/**
 * The Geocoding API returns HTTP 200 with a `status` field indicating success
 * or logical failure (`OK`, `ZERO_RESULTS`, `OVER_QUERY_LIMIT`, `REQUEST_DENIED`,
 * `INVALID_REQUEST`, `UNKNOWN_ERROR`). We surface the raw response and let the
 * caller decide how to interpret non-OK statuses.
 */
export interface GoogleGeocodingResponse {
  status?: string;
  results?: GoogleGeocodingResult[];
  error_message?: string;
  [key: string]: unknown;
}

export interface GeocodedLocation {
  /** Google's canonical formatted address for the resolved place. */
  formattedAddress: string;
  latitude: number;
  longitude: number;
}

export class GoogleGeocodingApiError extends ApiError {
  public override readonly name = 'GoogleGeocodingApiError';

  constructor(
    message: string,
    category: ErrorCategory,
    isRetryable: boolean,
    context: ErrorContext,
    statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message, category, isRetryable, context, 'google-geocoding', statusCode);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GoogleGeocodingApiError);
    }
  }

  static fromHttpStatus(
    statusCode: number,
    context: ErrorContext,
    responseBody?: string
  ): GoogleGeocodingApiError {
    return buildGoogleErrorFromHttpStatus(GoogleGeocodingApiError, 'Geocoding', statusCode, context, responseBody);
  }

  static networkError(context: ErrorContext, originalError?: Error): GoogleGeocodingApiError {
    return buildGoogleNetworkError(GoogleGeocodingApiError, 'Geocoding', context, originalError);
  }

  static noResults(query: string, context: ErrorContext): GoogleGeocodingApiError {
    return new GoogleGeocodingApiError(
      `Google Geocoding could not resolve "${query}" to a location. Please try a more specific query (e.g., add city/state/country).`,
      'not_found',
      false,
      context
    );
  }
}

const googleGeocodingHttpErrorBuilders = googleErrorBuilders(GoogleGeocodingApiError);

/**
 * Client for Google's Geocoding API.
 *
 * GET-based with query params. Auth is the same Google Cloud API key used by
 * the Weather, Air Quality, Pollen, and Elevation APIs; the Geocoding API
 * must also be enabled on the project.
 *
 * Logical failures (`ZERO_RESULTS`, `REQUEST_DENIED`, etc.) come back as
 * HTTP 200 with a non-OK `status`. The `geocode()` method interprets those:
 * an empty `results` array throws `not_found`, anything else returns the
 * top result.
 *
 * @see https://developers.google.com/maps/documentation/geocoding
 */
export class GoogleGeocodingClient {
  constructor(private config: GoogleGeocodingConfig) {}

  /**
   * GET /geocode/json?address=<query>&key=<key>
   *
   * Resolves a free-text address/place query to a single canonical location.
   * Silently returns the top result (`results[0]`); throws if the API returns
   * no results. Surface the `formattedAddress` so the caller can show what was
   * resolved.
   * @see https://developers.google.com/maps/documentation/geocoding/requests-geocoding
   */
  async geocode(query: string): Promise<GeocodedLocation> {
    const url = new URL(`${GOOGLE_GEOCODING_API_BASE}/json`);
    url.searchParams.set('address', query);
    url.searchParams.set('key', this.config.apiKey);

    console.log(`[GoogleGeocoding] Making API call to /geocode/json for "${query}"`);

    const context: ErrorContext = {
      operation: 'geocode address',
      resource: query,
    };

    const response = await httpRequestJson<GoogleGeocodingResponse>({
      url: url.toString(),
      headers: { Accept: 'application/json' },
      context,
      ...googleGeocodingHttpErrorBuilders,
    });

    const top = response.results?.[0];
    const lat = top?.geometry?.location?.lat;
    const lng = top?.geometry?.location?.lng;
    if (!top || typeof lat !== 'number' || typeof lng !== 'number') {
      throw GoogleGeocodingApiError.noResults(query, context);
    }

    return {
      formattedAddress: top.formatted_address ?? query,
      latitude: lat,
      longitude: lng,
    };
  }
}
