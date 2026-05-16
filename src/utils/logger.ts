import { createRequire } from 'module';
import { ApiError } from '../errors/index.js';

const require = createRequire(import.meta.url);

interface BugsnagEvent {
  context: string;
  addMetadata(section: string, data: Record<string, unknown>): void;
}

interface BugsnagClient {
  notify(error: Error, onError?: (event: BugsnagEvent) => void): void;
}

interface BugsnagStatic {
  start(opts: {
    apiKey: string;
    appVersion?: string;
    releaseStage?: string;
    enabledReleaseStages?: string[];
  }): BugsnagClient;
}

let bugsnagClient: BugsnagClient | null = null;

/**
 * Initialize Bugsnag error reporting if BUGSNAG_API_KEY is set.
 * Call this once at server startup.
 */
export function initBugsnag(): void {
  const apiKey = process.env.BUGSNAG_API_KEY;
  if (!apiKey) {
    console.log('[Bugsnag] No BUGSNAG_API_KEY set, error reporting disabled');
    return;
  }

  const Bugsnag = require('@bugsnag/js') as BugsnagStatic;
  bugsnagClient = Bugsnag.start({
    apiKey,
    appVersion: process.env.npm_package_version ?? '0.0.0',
    releaseStage: process.env.NODE_ENV ?? 'development',
    enabledReleaseStages: ['production', 'staging', 'development'],
  });

  console.log('[Bugsnag] Error reporting initialized');
}

/**
 * Get the Bugsnag client instance, or null if not initialized.
 */
export function getBugsnagClient(): BugsnagClient | null {
  return bugsnagClient;
}

/**
 * Override the Bugsnag client for testing purposes.
 * @internal
 */
export function _setBugsnagClientForTesting(client: BugsnagClient | null): void {
  bugsnagClient = client;
}

/**
 * Severity levels, lowest to highest. `debug` is suppressed unless
 * `LOG_LEVEL=debug` so verbose, normally-uninteresting churn (Whoop token
 * rotation, Redis lock dance) stays out of production logs but can be flipped
 * back on without a code change when a token bug recurs.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Resolve the configured floor from LOG_LEVEL; anything below it is dropped. Defaults to `info`. */
function configuredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' ? raw : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configuredLevel()];
}

/** Every log line is `[scope] message`; Fly prepends its own timestamp and level. */
function format(scope: string, message: string): string {
  return `[${scope}] ${message}`;
}

/**
 * Report a non-API error to Bugsnag. Synthesizes an Error from the message
 * when the caller didn't have an Error in hand (e.g. a logged failure string),
 * so failures are still grouped and visible in Bugsnag.
 */
function reportToBugsnag(scope: string, message: string, error?: unknown): void {
  if (!bugsnagClient) return;
  const err = error instanceof Error ? error : new Error(`${scope}: ${message}`);
  bugsnagClient.notify(err, (event) => {
    event.context = scope;
    event.addMetadata('log', { scope, message });
  });
}

/** Verbose diagnostic line, suppressed unless `LOG_LEVEL=debug`. */
export function logDebug(scope: string, message: string): void {
  if (shouldLog('debug')) console.log(format(scope, message));
}

/** Normal operational line (API calls, tool invocations, webhook lifecycle). */
export function logInfo(scope: string, message: string): void {
  if (shouldLog('info')) console.log(format(scope, message));
}

/** Render an optional thrown value into a trailing `: <reason>` suffix. */
function withCause(message: string, error?: unknown): string {
  if (error === undefined) return message;
  const reason = error instanceof Error ? error.message : String(error);
  return `${message}: ${reason}`;
}

/**
 * Recoverable / expected-but-notable condition. Not reported to Bugsnag —
 * use this for best-effort degradations whose underlying API error was
 * already logged and reported at the client layer (`logApiError`), so we
 * don't double-report.
 */
export function logWarn(scope: string, message: string, error?: unknown): void {
  if (shouldLog('warn')) console.warn(format(scope, withCause(message, error)));
}

/**
 * Failure. Always emitted (regardless of LOG_LEVEL) and always reported to
 * Bugsnag when configured. Pass the originating error for a stack trace and
 * accurate Bugsnag grouping.
 */
export function logError(scope: string, message: string, error?: unknown): void {
  console.error(format(scope, message));
  if (error instanceof Error && error.stack) {
    console.error(format(scope, `Stack: ${error.stack}`));
  } else if (error !== undefined && !(error instanceof Error)) {
    console.error(format(scope, `Cause: ${String(error)}`));
  }
  reportToBugsnag(scope, message, error);
}

/**
 * Standardized outbound-API-call line: `[Source] METHOD path`. Use the
 * service name as the scope (e.g. `Intervals`, `Whoop`, `GoogleGeocoding`).
 */
export function logApiCall(source: string, path: string, method: string = 'GET'): void {
  logInfo(source, `${method} ${path}`);
}

/** Standardized MCP-tool-invocation line: `[Tool] <name> called`. */
export function logToolCall(toolName: string): void {
  logInfo('Tool', `${toolName} called`);
}

interface ApiErrorLogContext {
  /** The source service (intervals, whoop, trainerroad) */
  source: string;
  /** The operation being performed */
  operation: string;
  /** HTTP method used */
  method?: string;
  /** The URL that was called */
  url?: string;
  /** HTTP status code received */
  statusCode?: number;
  /** Response body text from the failed request */
  responseBody?: string;
  /** The resource being operated on */
  resource?: string;
  /** Request parameters */
  parameters?: Record<string, unknown>;
}

/**
 * Log an API error with full context for debugging.
 * Also reports to Bugsnag if configured.
 */
export function logApiError(error: ApiError, context?: Partial<ApiErrorLogContext>): void {
  const logContext: ApiErrorLogContext = {
    source: error.source,
    operation: error.context.operation,
    ...context,
    resource: context?.resource ?? error.context.resource,
    parameters: context?.parameters ?? error.context.parameters,
  };

  const parts = [
    `[${logContext.source.charAt(0).toUpperCase() + logContext.source.slice(1)}]`,
    `API error during "${logContext.operation}"`,
  ];

  if (logContext.resource) {
    parts.push(`on ${logContext.resource}`);
  }

  if (logContext.method && logContext.url) {
    parts.push(`- ${logContext.method} ${logContext.url}`);
  }

  if (logContext.statusCode) {
    parts.push(`- status ${logContext.statusCode}`);
  }

  parts.push(`- ${error.category}: ${error.message}`);

  console.error(parts.join(' '));

  if (logContext.responseBody) {
    console.error(`[${logContext.source.charAt(0).toUpperCase() + logContext.source.slice(1)}] Response body: ${logContext.responseBody}`);
  }

  // Report to Bugsnag
  if (bugsnagClient) {
    bugsnagClient.notify(error, (event) => {
      event.context = logContext.operation;
      event.addMetadata('api', {
        source: logContext.source,
        operation: logContext.operation,
        method: logContext.method,
        url: logContext.url,
        statusCode: logContext.statusCode,
        resource: logContext.resource,
        parameters: logContext.parameters,
        responseBody: logContext.responseBody,
        category: error.category,
        isRetryable: error.isRetryable,
      });
    });
  }
}

/**
 * Log and report a non-API error (unknown errors caught in tool handlers).
 */
export function logUnexpectedError(error: unknown, toolName?: string): void {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = toolName ? `[Tool:${toolName}]` : '[Error]';
  console.error(`${prefix} Unexpected error: ${message}`);

  if (error instanceof Error && error.stack) {
    console.error(`${prefix} Stack: ${error.stack}`);
  }

  if (bugsnagClient) {
    if (error instanceof Error) {
      bugsnagClient.notify(error, (event) => {
        if (toolName) {
          event.context = toolName;
          event.addMetadata('tool', { name: toolName });
        }
      });
    } else {
      bugsnagClient.notify(new Error(message), (event) => {
        if (toolName) {
          event.context = toolName;
          event.addMetadata('tool', { name: toolName });
        }
      });
    }
  }
}
