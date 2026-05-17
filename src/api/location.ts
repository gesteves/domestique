import type { Request, Response } from 'express';
import { secureCompare } from '../auth/middleware.js';
import { parseCoordinates } from '../utils/location-context.js';
import { applyLocation, type LocationSyncDeps } from '../services/location-sync.js';
import { logInfo, logError } from '../utils/logger.js';

export interface LocationApiDeps extends LocationSyncDeps {
  /** Shared secret the caller must present as `Authorization: Bearer <secret>`. */
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
 * `PUT /api/location` — sets the athlete's current location from a JSON body
 * `{ latitude, longitude }` (typically an iOS Shortcut posting the device's
 * GPS). Idempotent: `applyLocation` skips Intervals.icu writes that would be
 * no-ops, so it's safe to call repeatedly. Authenticated with a dedicated
 * shared secret presented as `Authorization: Bearer <secret>` — no
 * query-string auth or inputs. Processes synchronously and returns the result,
 * since the caller benefits from a real success/failure response and the work
 * is only a few API calls.
 */
export function createLocationApiHandler(deps: LocationApiDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    // --- Auth: Authorization: Bearer <secret> only ---
    const authHeader = req.headers.authorization;
    const providedToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;
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
    const coords = parseCoordinates(toNumber(body.latitude), toNumber(body.longitude));
    if (!coords) {
      res.status(400).json({
        error: 'Body must include valid numeric latitude and longitude',
      });
      return;
    }
    const { latitude, longitude } = coords;

    logInfo('LocationApi', `Received location update (${latitude},${longitude})`);
    try {
      const result = await applyLocation(latitude, longitude, deps);
      logInfo('LocationApi', `Applied location update (${latitude},${longitude})`);
      res.status(200).json({ ok: true, ...result });
    } catch (error) {
      logError('LocationApi', 'Failed to apply location update', error);
      res.status(500).json({ error: 'Failed to apply location update' });
    }
  };
}
