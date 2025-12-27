/**
 * Unified error handling system for the Domestique MCP server.
 * Provides human-readable error messages designed for LLM consumption.
 */

/**
 * Error categories for classifying different types of failures.
 */
export type ErrorCategory =
  | 'date_parse'          // Natural language date couldn't be understood
  | 'not_found'           // Resource (activity, workout) doesn't exist
  | 'authentication'      // API credentials invalid or expired
  | 'authorization'       // Valid credentials but lacks permission
  | 'rate_limit'          // Too many requests
  | 'network'             // Connection or timeout issues
  | 'service_unavailable' // External API temporarily down
  | 'validation'          // Invalid parameters (non-date)
  | 'internal';           // Unexpected errors

/**
 * Context information about what operation was being performed when the error occurred.
 */
export interface ErrorContext {
  /** What operation was being attempted (e.g., "fetch workout intervals") */
  operation: string;
  /** The specific resource involved (e.g., "activity i123456") */
  resource?: string;
  /** The input parameters that were provided */
  parameters?: Record<string, unknown>;
}

/**
 * Source of the error - which API or component caused it.
 */
export type ErrorSource = 'intervals' | 'whoop' | 'trainerroad' | 'date_parser';

/**
 * Base error class for all API and tool errors.
 * Designed to produce human-readable messages for LLM consumption.
 */
export class ApiError extends Error {
  public override readonly name: string = 'ApiError';

  constructor(
    message: string,
    public readonly category: ErrorCategory,
    public readonly isRetryable: boolean,
    public readonly context: ErrorContext,
    public readonly source: ErrorSource,
    public readonly statusCode?: number
  ) {
    super(message);
    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  /**
   * Get a human-friendly explanation of what happened.
   */
  getWhatHappened(): string {
    const resourceInfo = this.context.resource ? ` for ${this.context.resource}` : '';
    return `The ${this.context.operation} operation${resourceInfo} failed.`;
  }

  /**
   * Get guidance on how to fix the error.
   */
  getHowToFix(): string {
    switch (this.category) {
      case 'not_found':
        return 'Double-check that the ID or date range is correct. Use the appropriate listing tool to find valid IDs.';
      case 'authentication':
        return 'The API credentials may be invalid or expired. Please check the configuration.';
      case 'authorization':
        return 'The configured API key may not have permission for this operation.';
      case 'rate_limit':
        return 'Wait a moment before trying again. The API is temporarily limiting requests.';
      case 'network':
        return 'This is usually a temporary connectivity issue. Please try again in a moment.';
      case 'service_unavailable':
        return 'The external service is temporarily unavailable. Please try again shortly.';
      case 'validation':
        return 'Please check that all input parameters are valid and in the expected format.';
      case 'date_parse':
        return "Try using a format like '2024-12-25', 'yesterday', '7 days ago', 'last week', or 'next Monday'.";
      default:
        return 'An unexpected error occurred. Please try again or contact support if the issue persists.';
    }
  }
}

/**
 * Error thrown when natural language date parsing fails.
 * Provides helpful suggestions for valid date formats.
 */
export class DateParseError extends ApiError {
  public override readonly name = 'DateParseError';

  constructor(
    /** The input string that couldn't be parsed */
    public readonly input: string,
    /** The parameter name (e.g., "start_date", "end_date") */
    public readonly parameterName: string,
    /** Optional custom message override */
    customMessage?: string
  ) {
    const message = customMessage ?? DateParseError.buildMessage(input, parameterName);
    super(
      message,
      'date_parse',
      false, // Date parsing errors are not retryable without changing input
      {
        operation: 'parse date',
        resource: `${parameterName} parameter`,
        parameters: { [parameterName]: input },
      },
      'date_parser'
    );

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DateParseError);
    }
  }

  /**
   * Build a helpful error message for date parsing failures.
   */
  private static buildMessage(input: string, parameterName: string): string {
    const trimmed = input.trim();
    return `I couldn't understand '${trimmed}' as a date for ${parameterName}. ` +
      `Try formats like '2024-12-25', 'yesterday', '7 days ago', 'last week', or 'next Monday'.`;
  }

  override getWhatHappened(): string {
    return `The ${this.parameterName} parameter couldn't be parsed as a valid date.`;
  }

  override getHowToFix(): string {
    return "Try using a format like '2024-12-25', 'yesterday', '7 days ago', 'last week', or 'next Monday'.";
  }
}

/**
 * Error thrown when Intervals.icu API calls fail.
 */
export class IntervalsApiError extends ApiError {
  public override readonly name = 'IntervalsApiError';

  constructor(
    message: string,
    category: ErrorCategory,
    isRetryable: boolean,
    context: ErrorContext,
    statusCode?: number
  ) {
    super(message, category, isRetryable, context, 'intervals', statusCode);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, IntervalsApiError);
    }
  }

  /**
   * Create an error from an HTTP response status code.
   */
  static fromHttpStatus(
    statusCode: number,
    context: ErrorContext
  ): IntervalsApiError {
    const { category, isRetryable, message } = IntervalsApiError.categorizeStatus(statusCode, context);
    return new IntervalsApiError(message, category, isRetryable, context, statusCode);
  }

  /**
   * Categorize an HTTP status code into an error category with appropriate message.
   */
  private static categorizeStatus(
    statusCode: number,
    context: ErrorContext
  ): { category: ErrorCategory; isRetryable: boolean; message: string } {
    const resourceInfo = context.resource ? ` '${context.resource}'` : '';

    switch (statusCode) {
      case 400:
        return {
          category: 'validation',
          isRetryable: false,
          message: `The request to ${context.operation} was invalid. Please check the parameters.`,
        };
      case 401:
        return {
          category: 'authentication',
          isRetryable: false,
          message: `Authentication failed with Intervals.icu. The API key may be invalid or expired.`,
        };
      case 403:
        return {
          category: 'authorization',
          isRetryable: false,
          message: `Access denied for ${context.operation}. The API key may not have permission for this operation.`,
        };
      case 404:
        return {
          category: 'not_found',
          isRetryable: false,
          message: `I couldn't find${resourceInfo}. It may have been deleted or the ID might be incorrect.`,
        };
      case 429:
        return {
          category: 'rate_limit',
          isRetryable: true,
          message: `Intervals.icu is temporarily limiting requests. Please try again in a few seconds.`,
        };
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          category: 'service_unavailable',
          isRetryable: true,
          message: `Intervals.icu is temporarily unavailable. This is usually a brief issue. Please try again shortly.`,
        };
      default:
        if (statusCode >= 500) {
          return {
            category: 'service_unavailable',
            isRetryable: true,
            message: `Intervals.icu returned an error (${statusCode}). Please try again shortly.`,
          };
        }
        return {
          category: 'internal',
          isRetryable: false,
          message: `An unexpected error occurred with Intervals.icu (${statusCode}).`,
        };
    }
  }

  /**
   * Create an error for network/connection issues.
   */
  static networkError(context: ErrorContext, originalError?: Error): IntervalsApiError {
    const errorDetail = originalError?.message ? `: ${originalError.message}` : '';
    return new IntervalsApiError(
      `I'm having trouble connecting to Intervals.icu${errorDetail}. This is usually temporary. Please try again in a moment.`,
      'network',
      true,
      context
    );
  }
}

/**
 * Error thrown when TrainerRoad API/iCal calls fail.
 */
export class TrainerRoadApiError extends ApiError {
  public override readonly name = 'TrainerRoadApiError';

  constructor(
    message: string,
    category: ErrorCategory,
    isRetryable: boolean,
    context: ErrorContext,
    statusCode?: number
  ) {
    super(message, category, isRetryable, context, 'trainerroad', statusCode);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TrainerRoadApiError);
    }
  }

  /**
   * Create an error from an HTTP response status code.
   */
  static fromHttpStatus(
    statusCode: number,
    context: ErrorContext
  ): TrainerRoadApiError {
    const isRetryable = statusCode >= 500 || statusCode === 429;
    let category: ErrorCategory;
    let message: string;

    switch (statusCode) {
      case 401:
      case 403:
        category = 'authentication';
        message = 'The TrainerRoad calendar URL may be invalid or expired. Please check the configuration.';
        break;
      case 404:
        category = 'not_found';
        message = "I couldn't find the TrainerRoad calendar. The URL may be incorrect.";
        break;
      case 429:
        category = 'rate_limit';
        message = 'TrainerRoad is temporarily limiting requests. Please try again in a few seconds.';
        break;
      default:
        if (statusCode >= 500) {
          category = 'service_unavailable';
          message = 'TrainerRoad is temporarily unavailable. Please try again shortly.';
        } else {
          category = 'internal';
          message = `An unexpected error occurred with TrainerRoad (${statusCode}).`;
        }
    }

    return new TrainerRoadApiError(message, category, isRetryable, context, statusCode);
  }

  /**
   * Create an error for network/connection issues.
   */
  static networkError(context: ErrorContext, originalError?: Error): TrainerRoadApiError {
    const errorDetail = originalError?.message ? `: ${originalError.message}` : '';
    return new TrainerRoadApiError(
      `I'm having trouble connecting to TrainerRoad${errorDetail}. This is usually temporary. Please try again in a moment.`,
      'network',
      true,
      context
    );
  }

  /**
   * Create an error for iCal parsing failures.
   */
  static parseError(context: ErrorContext, originalError?: Error): TrainerRoadApiError {
    const errorDetail = originalError?.message ? `: ${originalError.message}` : '';
    return new TrainerRoadApiError(
      `I couldn't read the TrainerRoad calendar${errorDetail}. The calendar feed may be in an unexpected format.`,
      'validation',
      false,
      context
    );
  }
}

