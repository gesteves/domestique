import type { Request, Response } from 'express';
import { secureCompare } from '../auth/middleware.js';
import { isValidCoordinates } from '../utils/location-context.js';
import { applyLocation, type LocationSyncDeps } from '../services/location-sync.js';
import { logInfo, logError } from '../utils/logger.js';

export interface LocationWebhookDeps extends LocationSyncDeps {
  /** Shared secret the iOS Shortcut must present (Bearer header or ?token=). */
  secret: string;
}

/** Pull a number from a value that may arrive as a JSON number or string. */
function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/**
 * Webhook receiver for nightly location updates from an iOS Shortcut. Accepts
 * `POST { latitude, longitude }`, authenticated with a dedicated shared secret
 * (Authorization: Bearer <secret>, or ?token=<secret>). Unlike the Whoop
 * webhook this processes synchronously and returns the result, since the
 * Shortcut/user benefits from a real success/failure response and the work is
 * a few API calls.
 */
export function createLocationWebhookHandler(deps: LocationWebhookDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    // --- Auth (mirrors validateToken: Bearer header, then ?token= query) ---
    let providedToken: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      providedToken = authHeader.slice(7);
    }
    if (!providedToken && typeof req.query.token === 'string') {
      providedToken = req.query.token;
    }
    if (!providedToken) {
      res.status(401).json({ error: 'Authentication token required' });
      return;
    }
    if (!secureCompare(providedToken, deps.secret)) {
      res.status(403).json({ error: 'Invalid authentication token' });
      return;
    }

    // --- Body ---
    const body = (req.body ?? {}) as Record<string, unknown>;
    const latitude = toNumber(body.latitude);
    const longitude = toNumber(body.longitude);
    if (!isValidCoordinates(latitude, longitude)) {
      res.status(400).json({
        error: 'Body must include valid numeric latitude and longitude',
      });
      return;
    }

    logInfo('LocationWebhook', `Received location update (${latitude},${longitude})`);
    try {
      const result = await applyLocation(latitude, longitude as number, deps);
      logInfo('LocationWebhook', `Applied location update (${latitude},${longitude})`);
      res.status(200).json({ ok: true, ...result });
    } catch (error) {
      logError('LocationWebhook', 'Failed to apply location update', error);
      res.status(500).json({ error: 'Failed to apply location update' });
    }
  };
}
