import { ApiError, type ErrorContext } from '../errors/index.js';
import { logApiError } from '../utils/logger.js';

export interface HttpRequestOptions {
  url: string;
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
  try {
    return await fetch(opts.url, {
      method,
      headers: opts.headers,
      body: opts.body,
    });
  } catch (error) {
    const networkError = opts.toNetworkError(
      opts.context,
      error instanceof Error ? error : undefined
    );
    logApiError(networkError, { method, url: opts.url });
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
    url: opts.url,
    statusCode: response.status,
    responseBody: body,
  });
  throw httpError;
}

/**
 * Perform an HTTP request and parse the response as JSON.
 * Used by clients whose APIs return JSON on success (Intervals.icu, Whoop bodies, Last.fm bodies).
 */
export async function httpRequestJson<T>(opts: HttpRequestOptions): Promise<T> {
  const response = await performFetch(opts);
  await throwIfNotOk(response, opts);
  return response.json() as Promise<T>;
}

/**
 * Perform an HTTP request and return the response body as text.
 * Used by callers that handle parsing themselves (Last.fm needs to inspect API-level
 * error bodies before treating the payload as data; TrainerRoad returns iCal text).
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
