import { ApiError, type ErrorContext } from '../errors/index.js';
import { logApiError } from '../utils/logger.js';

/**
 * Default per-request timeout for outbound API calls. Covers the whole
 * exchange (connect, headers, and reading the body), so a stalled upstream
 * fails the tool call with a retryable network error instead of hanging it.
 */
export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

/**
 * Build the abort signal for an outbound request. Exposed so clients that call
 * `fetch` directly (e.g. Whoop) apply the same timeout.
 */
export function requestTimeoutSignal(timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

/**
 * Turn fetch's timeout abort into an Error whose message says what happened
 * ("The operation was aborted due to timeout" is unhelpful in tool output).
 */
export function describeFetchError(error: unknown, timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS): Error | undefined {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new Error(`request timed out after ${Math.round(timeoutMs / 1000)}s`);
  }
  return error instanceof Error ? error : undefined;
}

export interface HttpRequestOptions {
  url: string;
  /** Per-request timeout in ms. Defaults to {@link DEFAULT_HTTP_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * What to log in place of `url` on failure. Set this when the URL itself is
   * a secret (e.g. TrainerRoad's private calendar feed URL). Credential query
   * parameters such as Google's `key=` are redacted automatically either way.
   */
  logUrl?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  context: ErrorContext;
  /**
   * Build a client-specific ApiError subclass from a non-2xx response.
   * Receives the HTTP status, error context, and response body text (may be undefined on read failure).
   */
  toHttpError: (status: number, context: ErrorContext, body: string | undefined) => ApiError;
  /**
   * Build a client-specific ApiError subclass for network failures (fetch threw).
   */
  toNetworkError: (context: ErrorContext, original?: Error) => ApiError;
}

/**
 * Perform the underlying fetch and translate connection failures into the caller's ApiError type.
 */
async function performFetch(opts: HttpRequestOptions): Promise<Response> {
  const method = opts.method ?? 'GET';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  try {
    return await fetch(opts.url, {
      method,
      headers: opts.headers,
      body: opts.body,
      signal: requestTimeoutSignal(timeoutMs),
    });
  } catch (error) {
    const networkError = opts.toNetworkError(opts.context, describeFetchError(error, timeoutMs));
    logApiError(networkError, { method, url: opts.logUrl ?? opts.url });
    throw networkError;
  }
}

/**
 * If the response is non-2xx, read the body for diagnostic context and throw the
 * caller's ApiError type. Otherwise no-op so the caller can read the body itself.
 */
async function throwIfNotOk(response: Response, opts: HttpRequestOptions): Promise<void> {
  if (response.ok) return;

  let body: string | undefined;
  try {
    body = await response.text();
  } catch {
    body = undefined;
  }

  const httpError = opts.toHttpError(response.status, opts.context, body);
  logApiError(httpError, {
    method: opts.method ?? 'GET',
    url: opts.logUrl ?? opts.url,
    statusCode: response.status,
    responseBody: body,
  });
  throw httpError;
}

/**
 * Perform an HTTP request and parse the response as JSON.
 * Used by clients whose APIs return JSON on success (Intervals.icu, Whoop, Google).
 */
export async function httpRequestJson<T>(opts: HttpRequestOptions): Promise<T> {
  const response = await performFetch(opts);
  await throwIfNotOk(response, opts);
  return response.json() as Promise<T>;
}

/**
 * Perform an HTTP request and return the response body as text.
 * Used by callers that handle parsing themselves (TrainerRoad returns iCal text).
 */
export async function httpRequestText(opts: HttpRequestOptions): Promise<string> {
  const response = await performFetch(opts);
  await throwIfNotOk(response, opts);
  return response.text();
}

/**
 * Perform an HTTP request and discard the response body.
 * Used for DELETE and any method whose response payload is irrelevant.
 */
export async function httpRequestVoid(opts: HttpRequestOptions): Promise<void> {
  const response = await performFetch(opts);
  await throwIfNotOk(response, opts);
}
