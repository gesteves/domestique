import type { Request, Response, NextFunction } from 'express';

/**
 * Validate MCP authentication token from Authorization header or query parameter.
 * Supports:
 * - Authorization: Bearer <token> (preferred for Streamable HTTP)
 * - ?token=<token> (legacy SSE support)
 */
export function validateToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const expectedToken = process.env.MCP_AUTH_TOKEN;

  if (!expectedToken) {
    console.error('MCP_AUTH_TOKEN environment variable not set');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  // Try Authorization header first (Bearer token)
  let providedToken: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    providedToken = authHeader.slice(7);
  }

  // Fall back to query parameter for legacy support
  if (!providedToken) {
    providedToken = req.query.token as string | undefined;
  }

  if (!providedToken) {
    res.status(401).json({ error: 'Authentication token required' });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  if (!secureCompare(providedToken, expectedToken)) {
    res.status(403).json({ error: 'Invalid authentication token' });
    return;
  }

  next();
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Load and validate all required environment variables.
 * Throws if any required variable is missing.
 */
export function validateEnvironment(): void {
  const required = [
    'MCP_AUTH_TOKEN',
    'INTERVALS_API_KEY',
    'INTERVALS_ATHLETE_ID',
  ];

  // Whoop requires client credentials (tokens are stored in Redis)
  const whoopClientId = process.env.WHOOP_CLIENT_ID;
  if (whoopClientId) {
    required.push('WHOOP_CLIENT_SECRET', 'REDIS_URL');
  }

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

/**
 * Get configuration from environment variables.
 * Note: Whoop tokens are loaded from Redis, not env vars.
 */
export function getConfig() {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    mcpAuthToken: process.env.MCP_AUTH_TOKEN!,
    intervals: {
      apiKey: process.env.INTERVALS_API_KEY!,
      athleteId: process.env.INTERVALS_ATHLETE_ID!,
    },
    whoop: process.env.WHOOP_CLIENT_ID
      ? {
          accessToken: '', // Loaded from Redis
          refreshToken: '', // Loaded from Redis
          clientId: process.env.WHOOP_CLIENT_ID,
          clientSecret: process.env.WHOOP_CLIENT_SECRET!,
        }
      : null,
    trainerRoad: process.env.TRAINERROAD_CALENDAR_URL
      ? {
          calendarUrl: process.env.TRAINERROAD_CALENDAR_URL,
        }
      : null,
  };
}
