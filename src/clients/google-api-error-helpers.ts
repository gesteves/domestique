import { ApiError, type ErrorCategory, type ErrorContext } from '../errors/index.js';

/**
 * Constructor signature shared by every `GoogleXxxApiError` subclass. The
 * helpers below `new` whichever class is passed in, preserving the per-client
 * `name`, `source`, and `responseBody` fields.
 */
export type GoogleErrorCtor<E extends ApiError> = new (
  message: string,
  category: ErrorCategory,
  isRetryable: boolean,
  context: ErrorContext,
  statusCode?: number,
  responseBody?: string
) => E;

/**
 * All Google API clients (Weather, Air Quality, Pollen, Elevation, Geocoding,
 * Time Zone) emit identical HTTP status → error category mappings — the only
 * per-client variation is the API name in the message. This shared mapper keeps
 * the table in one place; each client's `fromHttpStatus` is now a one-liner that
 * delegates here with its own error class and human-readable API name.
 */
export function buildGoogleErrorFromHttpStatus<E extends ApiError>(
  ErrorClass: GoogleErrorCtor<E>,
  apiName: string,
  statusCode: number,
  context: ErrorContext,
  responseBody?: string
): E {
  const isRetryable = statusCode >= 500 || statusCode === 429;
  let category: ErrorCategory;
  let message: string;

  switch (statusCode) {
    case 400:
      category = 'validation';
      message = `Google ${apiName} rejected the request as invalid. Please check the parameters.`;
      break;
    case 401:
    case 403:
      category = 'authentication';
      message = `Google ${apiName} authentication failed. The API key may be invalid or the ${apiName} API may not be enabled for the project.`;
      break;
    case 404:
      category = 'not_found';
      message = `Google ${apiName} had no data for the requested location.`;
      break;
    case 429:
      category = 'rate_limit';
      message = `Google ${apiName} is rate-limiting requests. Please try again in a few seconds.`;
      break;
    default:
      if (statusCode >= 500) {
        category = 'service_unavailable';
        message = `Google ${apiName} is temporarily unavailable. Please try again shortly.`;
      } else {
        category = 'internal';
        message = `An unexpected error occurred with Google ${apiName} (${statusCode}).`;
      }
  }

  return new ErrorClass(message, category, isRetryable, context, statusCode, responseBody);
}

/**
 * Shared "fetch threw" message template — same wording across all Google clients,
 * with the API name interpolated.
 */
export function buildGoogleNetworkError<E extends ApiError>(
  ErrorClass: GoogleErrorCtor<E>,
  apiName: string,
  context: ErrorContext,
  originalError?: Error
): E {
  const errorDetail = originalError?.message ? `: ${originalError.message}` : '';
  return new ErrorClass(
    `I'm having trouble connecting to Google ${apiName}${errorDetail}. This is usually temporary. Please try again in a moment.`,
    'network',
    true,
    context
  );
}

/**
 * Build the `{ toHttpError, toNetworkError }` adapter that every Google client
 * passes to {@link httpRequestJson}. Avoids the same 4-line literal in each
 * client.
 */
export function googleErrorBuilders<E extends ApiError>(ErrorClass: {
  fromHttpStatus(statusCode: number, context: ErrorContext, responseBody?: string): E;
  networkError(context: ErrorContext, originalError?: Error): E;
}) {
  return {
    toHttpError: (status: number, context: ErrorContext, body: string | undefined) =>
      ErrorClass.fromHttpStatus(status, context, body),
    toNetworkError: (context: ErrorContext, err?: Error) =>
      ErrorClass.networkError(context, err),
  };
}
