import type {
  StrainData,
  StrainActivity,
  WhoopConfig,
  WhoopZoneDurations,
  WhoopBodyMeasurements,
  WhoopSleepData,
  WhoopNapData,
  WhoopRecoveryData,
  WhoopSleepSummary,
  WhoopSleepNeeded,
  WhoopRecoveryTrendEntry,
} from '../types/index.js';
import { normalizeActivityType } from '../utils/activity-matcher.js';
import { formatDuration, formatDistance, isSwimmingActivity } from '../utils/format-units.js';
import { formatToISO8601WithTimezone } from '../utils/date-formatting.js';
import {
  getRecoveryLevel,
  getRecoveryLevelDescription,
  getSleepPerformanceLevel,
  getSleepPerformanceLevelDescription,
  getStrainLevel,
  getStrainLevelDescription,
} from '../utils/whoop-insights.js';
import {
  getWhoopAccessToken,
  getWhoopRefreshToken,
  storeWhoopTokens,
  acquireRefreshLock,
  releaseRefreshLock,
  invalidateWhoopAccessToken,
  getRefreshTokenVersion,
} from '../utils/redis.js';
import { ApiError, type ErrorCategory, type ErrorContext } from '../errors/index.js';

const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v2';
const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const LOCK_WAIT_INTERVAL_MS = 500;
const MAX_LOCK_WAIT_ATTEMPTS = 6; // 3 seconds total wait time
const MAX_RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BUFFER_MS = 500; // Extra buffer when waiting for rate limit reset
const RATE_LIMIT_WARNING_THRESHOLD = 10; // Warn when fewer than this many requests remain

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique lock ID for this process/request
 */
function generateLockId(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Rate limit information from Whoop API response headers
 */
interface RateLimitInfo {
  remaining: number;
  resetInSeconds: number;
}

/**
 * Parse rate limit headers from a Whoop API response.
 * Headers follow the IETF RateLimit header specification.
 * @see https://developer.whoop.com/docs/developing/rate-limiting
 */
function parseRateLimitHeaders(response: Response): RateLimitInfo | null {
  // Handle responses without headers (e.g., in tests)
  if (!response.headers || typeof response.headers.get !== 'function') {
    return null;
  }

  const remaining = response.headers.get('X-RateLimit-Remaining');
  const reset = response.headers.get('X-RateLimit-Reset');

  if (remaining !== null && reset !== null) {
    const remainingNum = parseInt(remaining, 10);
    const resetNum = parseInt(reset, 10);

    if (!isNaN(remainingNum) && !isNaN(resetNum)) {
      return {
        remaining: remainingNum,
        resetInSeconds: resetNum,
      };
    }
  }

  return null;
}

/**
 * Error thrown when Whoop API calls fail.
 * Extends ApiError to provide consistent error handling across all API clients.
 */
export class WhoopApiError extends ApiError {
  public override readonly name = 'WhoopApiError';

  constructor(
    message: string,
    category: ErrorCategory,
    isRetryable: boolean,
    context: ErrorContext,
    statusCode?: number
  ) {
    super(message, category, isRetryable, context, 'whoop', statusCode);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WhoopApiError);
    }
  }

  /**
   * Create an error from an HTTP response status code.
   */
  static fromHttpStatus(
    statusCode: number,
    context: ErrorContext
  ): WhoopApiError {
    const { category, isRetryable, message } = WhoopApiError.categorizeStatus(statusCode, context);
    return new WhoopApiError(message, category, isRetryable, context, statusCode);
  }

  /**
   * Categorize an HTTP status code into an error category with appropriate message.
   */
  private static categorizeStatus(
    statusCode: number,
    context: ErrorContext
  ): { category: ErrorCategory; isRetryable: boolean; message: string } {
    const resourceInfo = context.resource ? ` for ${context.resource}` : '';

    switch (statusCode) {
      case 400:
        return {
          category: 'validation',
          isRetryable: false,
          message: `The request to Whoop${resourceInfo} was invalid. Please check the parameters.`,
        };
      case 401:
        return {
          category: 'authentication',
          isRetryable: false,
          message: `Authentication failed with Whoop. The access token may be invalid or expired.`,
        };
      case 403:
        return {
          category: 'authorization',
          isRetryable: false,
          message: `Access denied for Whoop${resourceInfo}. The token may not have permission for this operation.`,
        };
      case 404:
        return {
          category: 'not_found',
          isRetryable: false,
          message: `I couldn't find the Whoop data${resourceInfo}. It may not exist or may not be available yet.`,
        };
      case 429:
        return {
          category: 'rate_limit',
          isRetryable: true,
          message: `Whoop is temporarily limiting requests. Please try again in a few seconds.`,
        };
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          category: 'service_unavailable',
          isRetryable: true,
          message: `Whoop is temporarily unavailable. This is usually a brief issue. Please try again shortly.`,
        };
      default:
        if (statusCode >= 500) {
          return {
            category: 'service_unavailable',
            isRetryable: true,
            message: `Whoop returned an error (${statusCode}). Please try again shortly.`,
          };
        }
        return {
          category: 'internal',
          isRetryable: false,
          message: `An unexpected error occurred with Whoop (${statusCode}).`,
        };
    }
  }

  /**
   * Create an error for network/connection issues.
   */
  static networkError(context: ErrorContext, originalError?: Error): WhoopApiError {
    const errorDetail = originalError?.message ? `: ${originalError.message}` : '';
    return new WhoopApiError(
      `I'm having trouble connecting to Whoop${errorDetail}. This is usually temporary. Please try again in a moment.`,
      'network',
      true,
      context
    );
  }

  /**
   * Create an error for token refresh failures.
   */
  static tokenRefreshError(attemptsMade: number, originalError?: Error): WhoopApiError {
    const errorDetail = originalError?.message ? ` Original error: ${originalError.message}` : '';
    return new WhoopApiError(
      `Whoop is temporarily unavailable. The token refresh failed after ${attemptsMade} attempt(s). ` +
        `This is typically a transient issue with the Whoop API. Please try this request again in a few moments.${errorDetail}`,
      'service_unavailable',
      true,
      { operation: 'refresh authentication token' }
    );
  }

  /**
   * Create an error for rate limit exceeded (429) with reset time info.
   */
  static rateLimitError(context: ErrorContext, resetInSeconds?: number): WhoopApiError {
    const resetInfo = resetInSeconds !== undefined
      ? ` Rate limit resets in ${resetInSeconds} seconds.`
      : '';
    return new WhoopApiError(
      `Whoop is temporarily limiting requests.${resetInfo} Please try again shortly.`,
      'rate_limit',
      true,
      context,
      429
    );
  }
}

/**
 * Check if a UTC timestamp falls within a local date range given the timezone.
 */
function isTimestampInLocalDateRange(
  utcTimestamp: string,
  startDate: string,
  endDate: string,
  timezone: string
): boolean {
  // Format the UTC timestamp as a local date in the given timezone
  const date = new Date(utcTimestamp);
  const localDateStr = date.toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD format

  return localDateStr >= startDate && localDateStr <= endDate;
}

interface WhoopRecovery {
  cycle_id: number;
  sleep_id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  score_state: string;
  score: {
    user_calibrating: boolean;
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  };
}

interface WhoopSleep {
  id: number;
  cycle_id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  nap: boolean;
  score_state: string;
  score: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_no_data_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      sleep_cycle_count: number;
      disturbance_count: number;
    };
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
      need_from_recent_nap_milli: number;
    };
    respiratory_rate?: number;
    sleep_performance_percentage?: number;
    sleep_consistency_percentage?: number;
    sleep_efficiency_percentage?: number;
  };
}

interface WhoopCycle {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end?: string;
  timezone_offset: string;
  score_state: string;
  score: {
    strain: number;
    kilojoule: number;
    average_heart_rate: number;
    max_heart_rate: number;
  };
}

interface WhoopWorkout {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  sport_name: string; // Use this instead of sport_id (deprecated after 09/01/2025)
  score_state: string;
  score: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
    percent_recorded: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
    altitude_change_meter?: number;
    zone_durations?: {
      zone_zero_milli: number;
      zone_one_milli: number;
      zone_two_milli: number;
      zone_three_milli: number;
      zone_four_milli: number;
      zone_five_milli: number;
    };
  };
}

interface WhoopBodyMeasurementResponse {
  height_meter: number;
  weight_kilogram: number;
  max_heart_rate: number;
}

// Whoop sport_name to normalized activity type mapping
const WHOOP_SPORT_NAME_MAP: Record<string, string> = {
  running: 'Running',
  cycling: 'Cycling',
  swimming: 'Swimming',
  'functional fitness': 'Functional Fitness',
  hiit: 'HIIT',
  skiing: 'Skiing',
  rowing: 'Rowing',
  'weightlifting': 'Strength',
  'strength trainer': 'Strength',
};

export class WhoopClient {
  private config: WhoopConfig;
  private accessToken: string;
  private tokenExpiresAt: number = 0;
  private refreshToken: string;
  private timezoneGetter: (() => Promise<string>) | null = null;
  private refreshPromise: Promise<void> | null = null;
  private bodyMeasurementsCache: WhoopBodyMeasurements | null = null;

  constructor(config: WhoopConfig) {
    this.config = config;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
  }

  /**
   * Set a function that returns the user's timezone.
   * Used to filter results to match local date ranges.
   */
  setTimezoneGetter(getter: () => Promise<string>): void {
    this.timezoneGetter = getter;
  }

  /**
   * Get the user's timezone, defaulting to UTC if not configured.
   */
  private async getTimezone(): Promise<string> {
    if (this.timezoneGetter) {
      return this.timezoneGetter();
    }
    return 'UTC';
  }

  /**
   * Mask a token for logging (show first 4 and last 4 characters)
   */
  private maskToken(token: string): string {
    if (token.length <= 12) return '***';
    return `${token.slice(0, 4)}...${token.slice(-4)}`;
  }

  /**
   * Get a valid access token, refreshing if necessary.
   * Uses Redis-based distributed locking to prevent concurrent refresh attempts.
   * Flow:
   * 1. Check Redis for cached access token
   * 2. Check in-memory token validity
   * 3. Try to acquire distributed lock
   * 4. If lock acquired, refresh token
   * 5. If lock not acquired, wait and check for fresh token
   */
  private async ensureValidToken(): Promise<void> {
    // If a local refresh is already in progress, wait for it
    if (this.refreshPromise) {
      console.log('[Whoop] Local token refresh already in progress, waiting...');
      await this.refreshPromise;
      return;
    }

    // First, try to get a cached access token from Redis
    const cachedToken = await getWhoopAccessToken();
    if (cachedToken) {
      console.log('[Whoop] Using cached access token from Redis');
      this.accessToken = cachedToken.token;
      this.tokenExpiresAt = cachedToken.expiresAt;
      return;
    }

    // Check if current in-memory token is still valid (5 min buffer)
    if (Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
      console.log('[Whoop] Using valid in-memory access token');
      return;
    }

    // Need to refresh - try to acquire distributed lock
    const lockId = generateLockId();
    console.log(`[Whoop] Token expired, attempting refresh with lock ID: ${lockId}`);

    // Record the current token version before attempting refresh
    const versionBeforeRefresh = await getRefreshTokenVersion();

    // Try to acquire the lock
    const lockAcquired = await acquireRefreshLock(lockId);

    if (lockAcquired) {
      // We got the lock - perform the refresh
      console.log('[Whoop] Acquired refresh lock, starting token refresh');
      this.refreshPromise = this.performTokenRefresh(lockId);

      try {
        await this.refreshPromise;
      } finally {
        this.refreshPromise = null;
        await releaseRefreshLock(lockId);
      }
    } else {
      // Another process is refreshing - wait and check for fresh token
      console.log('[Whoop] Lock held by another process, waiting for refresh to complete...');
      await this.waitForFreshToken(versionBeforeRefresh);
    }
  }

  /**
   * Wait for another process to complete token refresh.
   * Polls Redis for a fresh token with the new version.
   */
  private async waitForFreshToken(versionBeforeRefresh: number): Promise<void> {
    for (let attempt = 1; attempt <= MAX_LOCK_WAIT_ATTEMPTS; attempt++) {
      await sleep(LOCK_WAIT_INTERVAL_MS);

      // Check if a fresh access token is now available
      const freshToken = await getWhoopAccessToken();
      if (freshToken) {
        console.log(`[Whoop] Fresh token found in Redis after ${attempt} wait(s)`);
        this.accessToken = freshToken.token;
        this.tokenExpiresAt = freshToken.expiresAt;
        return;
      }

      // Check if the token version has changed (indicating successful refresh)
      const currentVersion = await getRefreshTokenVersion();
      if (currentVersion > versionBeforeRefresh) {
        // Version changed - try to get the fresh access token one more time
        const newToken = await getWhoopAccessToken();
        if (newToken) {
          console.log(`[Whoop] Token version updated (${versionBeforeRefresh} -> ${currentVersion}), using fresh token`);
          this.accessToken = newToken.token;
          this.tokenExpiresAt = newToken.expiresAt;
          return;
        }
      }

      console.log(`[Whoop] Wait attempt ${attempt}/${MAX_LOCK_WAIT_ATTEMPTS}, no fresh token yet...`);
    }

    // Exhausted wait attempts - try to refresh ourselves
    console.log('[Whoop] Wait timeout, attempting our own refresh...');
    const lockId = generateLockId();
    const lockAcquired = await acquireRefreshLock(lockId);

    if (lockAcquired) {
      try {
        await this.performTokenRefresh(lockId);
      } finally {
        await releaseRefreshLock(lockId);
      }
    } else {
      // Still can't get lock - one more check for fresh token
      const finalToken = await getWhoopAccessToken();
      if (finalToken) {
        console.log('[Whoop] Found fresh token on final check');
        this.accessToken = finalToken.token;
        this.tokenExpiresAt = finalToken.expiresAt;
        return;
      }
      throw WhoopApiError.tokenRefreshError(0, new Error('Timeout waiting for token refresh'));
    }
  }

  /**
   * Perform the actual token refresh with retry logic.
   * Must be called while holding the distributed lock.
   */
  private async performTokenRefresh(lockId: string): Promise<void> {
    // Double-check: maybe someone else refreshed while we were waiting for the lock
    const freshToken = await getWhoopAccessToken();
    if (freshToken) {
      console.log('[Whoop] Fresh token found after acquiring lock, skipping refresh');
      this.accessToken = freshToken.token;
      this.tokenExpiresAt = freshToken.expiresAt;
      return;
    }

    // Get refresh token from Redis, fall back to config
    const storedRefreshToken = await getWhoopRefreshToken();
    const refreshToken = storedRefreshToken?.token ?? this.refreshToken;
    const tokenSource = storedRefreshToken ? 'Redis' : 'config';
    console.log(`[Whoop] Starting token refresh using ${tokenSource} refresh token: ${this.maskToken(refreshToken)}`);

    // Refresh the token with retry logic
    let lastError: Error | null = null;
    let attemptsMade = 0;
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      attemptsMade = attempt;
      try {
        console.log(`[Whoop] Token refresh attempt ${attempt}/${MAX_RETRY_ATTEMPTS} (lock: ${lockId.slice(-8)})`);
        const response = await fetch(WHOOP_AUTH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
          };

          console.log(`[Whoop] Token refresh successful on attempt ${attempt}, new refresh token: ${this.maskToken(data.refresh_token)}, expires in ${data.expires_in}s`);

          this.accessToken = data.access_token;
          this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
          this.refreshToken = data.refresh_token;

          // Store tokens in Redis for other processes to use
          const storeResult = await storeWhoopTokens({
            accessToken: this.accessToken,
            refreshToken: this.refreshToken,
            expiresAt: this.tokenExpiresAt,
          });
          console.log(`[Whoop] Tokens stored in Redis, version: ${storeResult.version}`);
          return;
        }

        // Log the error response
        const responseText = await response.text();
        console.error(`[Whoop] Token refresh failed with ${response.status} ${response.statusText}: ${responseText}`);

        // Determine if this is a retryable error
        const isServerError = response.status >= 500 && response.status < 600;
        lastError = new Error(
          `Whoop token refresh failed: ${response.status} ${response.statusText}`
        );

        // For 400 errors, the refresh token might have been used by another process
        // that completed between our lock check and actual refresh
        if (response.status === 400) {
          console.log('[Whoop] Got 400 error, checking if token was refreshed by another process...');
          const freshTokenCheck = await getWhoopAccessToken();
          if (freshTokenCheck) {
            console.log('[Whoop] Found fresh access token (refreshed by another process), using it');
            this.accessToken = freshTokenCheck.token;
            this.tokenExpiresAt = freshTokenCheck.expiresAt;
            return;
          }
          // No fresh token - the refresh token might be genuinely invalid
          console.log('[Whoop] No fresh token found, refresh token may be invalid');
        }

        // Retry on server errors (5xx) with backoff
        if (isServerError && attempt < MAX_RETRY_ATTEMPTS) {
          const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`[Whoop] Server error, retrying in ${delayMs}ms...`);
          await sleep(delayMs);
          continue;
        }

        // For 400 errors, don't retry - the refresh token is likely invalid
        if (response.status === 400) {
          break;
        }

        // For other client errors, retry with backoff
        if (attempt < MAX_RETRY_ATTEMPTS) {
          const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`[Whoop] Client error, retrying in ${delayMs}ms...`);
          await sleep(delayMs);
          continue;
        }

        break;
      } catch (error) {
        // Network errors are retryable
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[Whoop] Network error on attempt ${attempt}: ${lastError.message}`);
        if (attempt < MAX_RETRY_ATTEMPTS) {
          const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`[Whoop] Retrying in ${delayMs}ms...`);
          await sleep(delayMs);
          continue;
        }
        break;
      }
    }

    // All retries exhausted - throw a helpful error
    throw WhoopApiError.tokenRefreshError(attemptsMade, lastError ?? undefined);
  }

  /**
   * Perform the actual HTTP fetch to the Whoop API.
   * Separated from fetch() to allow retry logic.
   */
  private async doFetch(
    url: string,
    errorContext: { operation: string; resource?: string; parameters?: Record<string, string> }
  ): Promise<Response> {
    try {
      return await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
        },
      });
    } catch (error) {
      throw WhoopApiError.networkError(errorContext, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Fetch data from the Whoop API with automatic token refresh, 401 retry, and rate limit handling.
   * - If a 401 is received, invalidates the cached token and retries once.
   * - If a 429 is received, waits for the rate limit reset and retries.
   * - Logs warnings when approaching rate limits.
   */
  private async fetch<T>(
    endpoint: string,
    params?: Record<string, string>,
    context?: { operation: string; resource?: string }
  ): Promise<T> {
    await this.ensureValidToken();

    console.log(`[Whoop] Making API call to ${endpoint}`);

    const url = new URL(`${WHOOP_API_BASE}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const errorContext = context ?? {
      operation: `fetch ${endpoint}`,
      resource: undefined,
    };

    const fullErrorContext = {
      ...errorContext,
      parameters: params,
    };

    let response = await this.doFetch(url.toString(), fullErrorContext);
    let rateLimitRetries = 0;

    // Handle 401 with token refresh
    if (response.status === 401) {
      console.log(`[Whoop] Got 401 on ${endpoint}, invalidating token and retrying...`);
      
      // Invalidate the cached access token to force refresh
      await invalidateWhoopAccessToken();
      
      // Reset in-memory token expiry to force refresh
      this.tokenExpiresAt = 0;
      
      // Get a fresh token
      await this.ensureValidToken();
      
      // Retry the request once
      response = await this.doFetch(url.toString(), fullErrorContext);
      
      if (response.status === 401) {
        // Still 401 after refresh - something is wrong
        console.error(`[Whoop] Still got 401 after token refresh on ${endpoint}`);
        throw WhoopApiError.fromHttpStatus(response.status, fullErrorContext);
      }
    }

    // Handle 429 rate limit with retry
    while (response.status === 429 && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
      rateLimitRetries++;
      const rateLimitInfo = parseRateLimitHeaders(response);
      const waitMs = rateLimitInfo
        ? (rateLimitInfo.resetInSeconds * 1000) + RATE_LIMIT_BUFFER_MS
        : INITIAL_RETRY_DELAY_MS * Math.pow(2, rateLimitRetries);

      console.warn(
        `[Whoop] Rate limited (429) on ${endpoint}. ` +
        `Retry ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES}, waiting ${Math.round(waitMs / 1000)}s...`
      );

      await sleep(waitMs);
      response = await this.doFetch(url.toString(), fullErrorContext);
    }

    // Check rate limit headers on successful responses
    if (response.ok) {
      const rateLimitInfo = parseRateLimitHeaders(response);
      if (rateLimitInfo && rateLimitInfo.remaining < RATE_LIMIT_WARNING_THRESHOLD) {
        console.warn(
          `[Whoop] Rate limit warning: ${rateLimitInfo.remaining} requests remaining, ` +
          `resets in ${rateLimitInfo.resetInSeconds}s`
        );
      }
    }

    if (!response.ok) {
      // If still rate limited after retries, include reset info in error
      if (response.status === 429) {
        const rateLimitInfo = parseRateLimitHeaders(response);
        throw WhoopApiError.rateLimitError(fullErrorContext, rateLimitInfo?.resetInSeconds);
      }
      throw WhoopApiError.fromHttpStatus(response.status, fullErrorContext);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get recovery data for a date range.
   * Follows cycle → sleep → recovery relationship.
   * Filters results to match the user's local timezone.
   * Returns entries with nested sleep and recovery objects.
   */
  async getRecoveries(startDate: string, endDate: string): Promise<WhoopRecoveryTrendEntry[]> {
    const timezone = await this.getTimezone();

    // Fetch with a 1-day buffer to account for timezone differences
    const startBuffer = this.subtractDays(startDate, 1);
    const endBuffer = this.addDays(endDate, 1);

    // Fetch all three data sources
    const [cycles, sleeps, recoveries] = await Promise.all([
      this.fetch<{ records: WhoopCycle[] }>('/cycle', {
        start: `${startBuffer}T00:00:00.000Z`,
        end: `${endBuffer}T23:59:59.999Z`,
      }),
      this.fetch<{ records: WhoopSleep[] }>('/activity/sleep', {
        start: `${startBuffer}T00:00:00.000Z`,
        end: `${endBuffer}T23:59:59.999Z`,
      }),
      this.fetch<{ records: WhoopRecovery[] }>('/recovery', {
        start: `${startBuffer}T00:00:00.000Z`,
        end: `${endBuffer}T23:59:59.999Z`,
      }),
    ]);

    // Build lookup maps
    // Sleep by cycle_id (non-nap, scored)
    const sleepByCycleId = new Map<number, WhoopSleep>();
    // Naps by cycle_id (scored naps only)
    const napsByCycleId = new Map<number, WhoopSleep[]>();
    for (const sleep of sleeps.records) {
      if (sleep.score_state === 'SCORED') {
        if (sleep.nap) {
          const cycleNaps = napsByCycleId.get(sleep.cycle_id) ?? [];
          cycleNaps.push(sleep);
          napsByCycleId.set(sleep.cycle_id, cycleNaps);
        } else {
          sleepByCycleId.set(sleep.cycle_id, sleep);
        }
      }
    }

    // Recovery by sleep_id (scored)
    const recoveryBySleepId = new Map<number, WhoopRecovery>();
    for (const recovery of recoveries.records) {
      if (recovery.score_state === 'SCORED') {
        recoveryBySleepId.set(recovery.sleep_id, recovery);
      }
    }

    // Follow the correct chain: cycle → sleep → recovery
    const results: WhoopRecoveryTrendEntry[] = [];
    for (const cycle of cycles.records) {
      if (cycle.score_state !== 'SCORED') continue;

      const sleep = sleepByCycleId.get(cycle.id);
      if (!sleep) continue;

      const recovery = recoveryBySleepId.get(sleep.id);
      if (!recovery) continue;

      // Get naps for this cycle
      const cycleNaps = napsByCycleId.get(cycle.id) ?? [];

      const normalized = await this.normalizeRecoveryTrendEntry(recovery, sleep, cycleNaps);
      // Filter by local date in user's timezone
      if (isTimestampInLocalDateRange(recovery.created_at, startDate, endDate, timezone)) {
        results.push(normalized);
      }
    }

    return results;
  }

  /**
   * Add days to a date string
   */
  private addDays(dateStr: string, days: number): string {
    const date = new Date(dateStr + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Subtract days from a date string
   */
  private subtractDays(dateStr: string, days: number): string {
    const date = new Date(dateStr + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Get today's recovery by finding the most recent scored cycle.
   * This follows Whoop's physiological day model rather than calendar dates.
   * Returns separate sleep and recovery objects.
   */
  async getTodayRecovery(): Promise<{ sleep: WhoopSleepData | null; recovery: WhoopRecoveryData | null }> {
    // Get recent data (last few days to ensure we catch the current cycle)
    const [cycles, sleeps, recoveries] = await Promise.all([
      this.fetch<{ records: WhoopCycle[] }>('/cycle'),
      this.fetch<{ records: WhoopSleep[] }>('/activity/sleep'),
      this.fetch<{ records: WhoopRecovery[] }>('/recovery'),
    ]);

    // Find the most recent scored cycle
    const scoredCycle = cycles.records.find((c) => c.score_state === 'SCORED');
    if (!scoredCycle) return { sleep: null, recovery: null };

    // Find the sleep for this cycle (non-nap, scored)
    const sleep = sleeps.records.find(
      (s) =>
        s.cycle_id === scoredCycle.id &&
        s.score_state === 'SCORED' &&
        !s.nap
    );
    if (!sleep) return { sleep: null, recovery: null };

    // Find the recovery for this sleep (scored)
    const recovery = recoveries.records.find(
      (r) => r.sleep_id === sleep.id && r.score_state === 'SCORED'
    );
    if (!recovery) return { sleep: null, recovery: null };

    // Get scored naps for this cycle
    const cycleNaps = sleeps.records.filter(
      (s) => s.cycle_id === scoredCycle.id && s.score_state === 'SCORED' && s.nap
    );

    // Normalize sleep and add naps if any
    const normalizedSleep = await this.normalizeSleep(sleep);
    if (cycleNaps.length > 0) {
      normalizedSleep.naps = await Promise.all(cycleNaps.map((nap) => this.normalizeNap(nap)));
    }

    return {
      sleep: normalizedSleep,
      recovery: this.normalizeRecoveryOnly(recovery),
    };
  }

  /**
   * Get today's strain by finding the current in-progress cycle.
   * The current cycle is identified by having no 'end' field.
   */
  async getTodayStrain(): Promise<StrainData | null> {
    const timezone = await this.getTimezone();
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

    // Get recent data without date parameters to get current cycle
    const [cycles, workouts] = await Promise.all([
      this.fetch<{ records: WhoopCycle[] }>('/cycle'),
      this.fetch<{ records: WhoopWorkout[] }>('/activity/workout'),
    ]);

    // Find the current cycle (no end date means in progress)
    const currentCycle = cycles.records.find((c) => !c.end);
    if (!currentCycle) return null;

    // Current cycle may not be scored yet (PENDING_SCORE)
    if (currentCycle.score_state !== 'SCORED') return null;

    // Find workouts that started after this cycle began
    const cycleWorkouts = workouts.records.filter((w) => {
      return new Date(w.start) >= new Date(currentCycle.start);
    });

    // Current cycle = today's date
    return await this.normalizeStrain(currentCycle, cycleWorkouts, todayStr);
  }

  /**
   * Get strain/cycle data for a date range.
   * Filters results to match the user's local timezone.
   *
   * A cycle's date is determined by its END time (when you went to sleep),
   * not its start time. For the current in-progress cycle (no end), we use today's date.
   */
  async getStrainData(startDate: string, endDate: string): Promise<StrainData[]> {
    const timezone = await this.getTimezone();
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

    // Fetch with a 1-day buffer to account for timezone differences
    const startBuffer = this.subtractDays(startDate, 1);
    const endBuffer = this.addDays(endDate, 1);

    const [cycles, workouts] = await Promise.all([
      this.fetch<{ records: WhoopCycle[] }>('/cycle', {
        start: `${startBuffer}T00:00:00.000Z`,
        end: `${endBuffer}T23:59:59.999Z`,
      }),
      this.fetch<{ records: WhoopWorkout[] }>('/activity/workout', {
        start: `${startBuffer}T00:00:00.000Z`,
        end: `${endBuffer}T23:59:59.999Z`,
      }),
    ]);

    // Determine each cycle's date based on END time (or today if in-progress)
    const cyclesWithDates = cycles.records.map((cycle) => {
      const cycleDate = !cycle.end
        ? todayStr
        : new Date(cycle.end).toLocaleDateString('en-CA', { timeZone: timezone });
      return { cycle, cycleDate };
    });

    // Group workouts by the cycle they belong to (started after cycle start, before cycle end)
    const getWorkoutsForCycle = (cycle: WhoopCycle): WhoopWorkout[] => {
      const cycleStart = new Date(cycle.start);
      const cycleEnd = cycle.end ? new Date(cycle.end) : new Date();
      return workouts.records.filter((w) => {
        const workoutStart = new Date(w.start);
        return workoutStart >= cycleStart && workoutStart <= cycleEnd;
      });
    };

    const normalized = await Promise.all(
      cyclesWithDates
        .filter(({ cycle }) => cycle.score_state === 'SCORED')
        .map(async ({ cycle, cycleDate }) => {
          const cycleWorkouts = getWorkoutsForCycle(cycle);
          return await this.normalizeStrain(cycle, cycleWorkouts, cycleDate);
        })
    );
    return normalized.filter((s) => s.date >= startDate && s.date <= endDate);
  }

  /**
   * Get workouts/activities for a date range.
   * Filters results to match the user's local timezone.
   */
  async getWorkouts(startDate: string, endDate: string): Promise<StrainActivity[]> {
    const timezone = await this.getTimezone();

    // Fetch with a 1-day buffer to account for timezone differences
    const startBuffer = this.subtractDays(startDate, 1);
    const endBuffer = this.addDays(endDate, 1);

    const workouts = await this.fetch<{ records: WhoopWorkout[] }>('/activity/workout', {
      start: `${startBuffer}T00:00:00.000Z`,
      end: `${endBuffer}T23:59:59.999Z`,
    });

    const normalized = await Promise.all(workouts.records.map((w) => this.normalizeWorkout(w)));
    return normalized.filter((w) => isTimestampInLocalDateRange(w.start_time, startDate, endDate, timezone));
  }

  /**
   * Get body measurements from Whoop.
   * Caches the result for the session duration since these rarely change.
   */
  async getBodyMeasurements(): Promise<WhoopBodyMeasurements | null> {
    // Return cached value if available
    if (this.bodyMeasurementsCache) {
      return this.bodyMeasurementsCache;
    }

    try {
      const response = await this.fetch<WhoopBodyMeasurementResponse>(
        '/user/measurement/body',
        undefined,
        { operation: 'get body measurements' }
      );

      const round2 = (value: number) => Math.round(value * 100) / 100;

      this.bodyMeasurementsCache = {
        height_meter: round2(response.height_meter),
        weight_kilogram: round2(response.weight_kilogram),
        max_heart_rate: response.max_heart_rate,
      };

      return this.bodyMeasurementsCache;
    } catch (error) {
      console.error('Error fetching body measurements:', error);
      return null;
    }
  }

  // ============================================
  // Normalization Helpers
  // ============================================

  /** Helper to round to 2 decimal places */
  private round2(value: number | undefined): number | undefined {
    return value !== undefined ? Math.round(value * 100) / 100 : undefined;
  }

  /**
   * Convert a UTC timestamp to ISO 8601 format in a specific timezone.
   * Returns format: YYYY-MM-DDTHH:mm:ss±HH:mm
   */
  private toISOStringInTimezone(utcTimestamp: string, timezone: string): string {
    return formatToISO8601WithTimezone(utcTimestamp, timezone);
  }

  /** Helper to convert milliseconds to human-readable duration */
  private milliToHuman(milli: number): string {
    return formatDuration(milli / 1000);
  }

  /**
   * Normalize sleep stage summary (renamed from stage_summary).
   */
  private normalizeSleepSummary(stageSummary: WhoopSleep['score']['stage_summary']): WhoopSleepSummary {
    // Restorative sleep = slow wave (deep) + REM sleep
    const restorativeSleepMilli =
      stageSummary.total_slow_wave_sleep_time_milli + stageSummary.total_rem_sleep_time_milli;

    return {
      total_in_bed_time: this.milliToHuman(stageSummary.total_in_bed_time_milli),
      total_awake_time: this.milliToHuman(stageSummary.total_awake_time_milli),
      total_no_data_time: this.milliToHuman(stageSummary.total_no_data_time_milli),
      total_light_sleep_time: this.milliToHuman(stageSummary.total_light_sleep_time_milli),
      total_slow_wave_sleep_time: this.milliToHuman(stageSummary.total_slow_wave_sleep_time_milli),
      total_rem_sleep_time: this.milliToHuman(stageSummary.total_rem_sleep_time_milli),
      total_restorative_sleep: this.milliToHuman(restorativeSleepMilli),
      sleep_cycle_count: stageSummary.sleep_cycle_count,
      disturbance_count: stageSummary.disturbance_count,
    };
  }

  /**
   * Normalize sleep need breakdown with total calculation.
   */
  private normalizeSleepNeeded(sleepNeeded: WhoopSleep['score']['sleep_needed']): WhoopSleepNeeded {
    const totalMilli =
      sleepNeeded.baseline_milli +
      sleepNeeded.need_from_sleep_debt_milli +
      sleepNeeded.need_from_recent_strain_milli -
      sleepNeeded.need_from_recent_nap_milli;

    return {
      total_sleep_needed: this.milliToHuman(totalMilli),
      baseline: this.milliToHuman(sleepNeeded.baseline_milli),
      need_from_sleep_debt: this.milliToHuman(sleepNeeded.need_from_sleep_debt_milli),
      need_from_recent_strain: this.milliToHuman(sleepNeeded.need_from_recent_strain_milli),
      need_from_recent_nap: this.milliToHuman(sleepNeeded.need_from_recent_nap_milli),
    };
  }

  /**
   * Normalize sleep data (separated from recovery).
   */
  private async normalizeSleep(sleep: WhoopSleep): Promise<WhoopSleepData> {
    const sleepScore = sleep.score;
    const sleepPerfPct = this.round2(sleepScore.sleep_performance_percentage) ?? 0;
    const sleepPerformanceLevel = getSleepPerformanceLevel(sleepPerfPct);

    // Convert start/end times to ISO 8601 format in user's timezone
    const timezone = await this.getTimezone();
    const sleep_start = this.toISOStringInTimezone(sleep.start, timezone);
    const sleep_end = this.toISOStringInTimezone(sleep.end, timezone);

    return {
      sleep_summary: this.normalizeSleepSummary(sleepScore.stage_summary),
      sleep_needed: this.normalizeSleepNeeded(sleepScore.sleep_needed),
      respiratory_rate: this.round2(sleepScore.respiratory_rate),
      sleep_performance_percentage: sleepPerfPct,
      sleep_consistency_percentage: this.round2(sleepScore.sleep_consistency_percentage),
      sleep_efficiency_percentage: this.round2(sleepScore.sleep_efficiency_percentage),
      sleep_performance_level: sleepPerformanceLevel,
      sleep_performance_level_description: getSleepPerformanceLevelDescription(sleepPerformanceLevel),
      sleep_start,
      sleep_end,
    };
  }

  /**
   * Normalize nap data.
   * Similar to sleep but without sleep need/performance metrics.
   */
  private async normalizeNap(nap: WhoopSleep): Promise<WhoopNapData> {
    const napScore = nap.score;

    // Convert start/end times to ISO 8601 format in user's timezone
    const timezone = await this.getTimezone();
    const nap_start = this.toISOStringInTimezone(nap.start, timezone);
    const nap_end = this.toISOStringInTimezone(nap.end, timezone);

    return {
      nap_summary: this.normalizeSleepSummary(napScore.stage_summary),
      respiratory_rate: this.round2(napScore.respiratory_rate),
      nap_start,
      nap_end,
    };
  }

  /**
   * Normalize recovery data only (separated from sleep).
   */
  private normalizeRecoveryOnly(recovery: WhoopRecovery): WhoopRecoveryData {
    const recoveryLevel = getRecoveryLevel(recovery.score.recovery_score);

    return {
      recovery_score: recovery.score.recovery_score,
      recovery_level: recoveryLevel,
      recovery_level_description: getRecoveryLevelDescription(recoveryLevel),
      hrv_rmssd: this.round2(recovery.score.hrv_rmssd_milli)!,
      resting_heart_rate: recovery.score.resting_heart_rate,
      spo2_percentage: this.round2(recovery.score.spo2_percentage),
      skin_temp_celsius: this.round2(recovery.score.skin_temp_celsius),
    };
  }

  /**
   * Normalize a complete recovery trend entry with both sleep and recovery.
   */
  private async normalizeRecoveryTrendEntry(
    recovery: WhoopRecovery,
    sleep: WhoopSleep,
    naps: WhoopSleep[] = []
  ): Promise<WhoopRecoveryTrendEntry> {
    const normalizedSleep = await this.normalizeSleep(sleep);

    // Add naps if any exist
    if (naps.length > 0) {
      normalizedSleep.naps = await Promise.all(naps.map((nap) => this.normalizeNap(nap)));
    }

    return {
      date: recovery.created_at.split('T')[0],
      sleep: normalizedSleep,
      recovery: this.normalizeRecoveryOnly(recovery),
    };
  }

  private async normalizeStrain(cycle: WhoopCycle, workouts: WhoopWorkout[], localDate: string): Promise<StrainData> {
    const strainLevel = getStrainLevel(cycle.score.strain);
    return {
      date: localDate,
      strain_score: cycle.score.strain,
      strain_level: strainLevel,
      strain_level_description: getStrainLevelDescription(strainLevel),
      average_heart_rate: cycle.score.average_heart_rate,
      max_heart_rate: cycle.score.max_heart_rate,
      calories: Math.round(cycle.score.kilojoule / 4.184),
      activities: await Promise.all(workouts.map((w) => this.normalizeWorkout(w))),
    };
  }

  private async normalizeWorkout(workout: WhoopWorkout): Promise<StrainActivity> {
    // Use sport_name (sport_id is deprecated after 09/01/2025)
    const sportName =
      WHOOP_SPORT_NAME_MAP[workout.sport_name.toLowerCase()] ??
      workout.sport_name;

    // Get timezone for formatting start/end times
    const timezone = await this.getTimezone();

    const activityType = normalizeActivityType(sportName);
    const isSwim = isSwimmingActivity(activityType);

    // Calculate duration from start/end times
    const startMs = new Date(workout.start).getTime();
    const endMs = new Date(workout.end).getTime();
    const durationSeconds = Math.round((endMs - startMs) / 1000);

    // Distance in km for human-readable format
    const distanceKm = workout.score.distance_meter
      ? workout.score.distance_meter / 1000
      : undefined;

    // Human-readable zone durations
    const zoneDurations: WhoopZoneDurations | undefined =
      workout.score.zone_durations
        ? {
            zone_0: formatDuration(workout.score.zone_durations.zone_zero_milli / 1000),
            zone_1: formatDuration(workout.score.zone_durations.zone_one_milli / 1000),
            zone_2: formatDuration(workout.score.zone_durations.zone_two_milli / 1000),
            zone_3: formatDuration(workout.score.zone_durations.zone_three_milli / 1000),
            zone_4: formatDuration(workout.score.zone_durations.zone_four_milli / 1000),
            zone_5: formatDuration(workout.score.zone_durations.zone_five_milli / 1000),
          }
        : undefined;

    return {
      id: String(workout.id),
      activity_type: activityType,
      start_time: formatToISO8601WithTimezone(workout.start, timezone),
      end_time: formatToISO8601WithTimezone(workout.end, timezone),
      duration: formatDuration(durationSeconds),
      strain_score: workout.score.strain,
      average_heart_rate: workout.score.average_heart_rate,
      max_heart_rate: workout.score.max_heart_rate,
      calories: Math.round(workout.score.kilojoule / 4.184),
      distance: distanceKm !== undefined ? formatDistance(distanceKm, isSwim) : undefined,
      elevation_gain: workout.score.altitude_gain_meter !== undefined
        ? `${Math.round(workout.score.altitude_gain_meter)} m`
        : undefined,
      zone_durations: zoneDurations,
    };
  }
}
