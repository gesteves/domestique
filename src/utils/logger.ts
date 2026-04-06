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
