import type { Request, Response } from 'express';
import { secureCompare } from '../auth/middleware.js';
import {
  regenerateDayDescriptions,
  type DescriptionRegenDeps,
} from '../services/description-regen.js';
import { parseYMD } from '../utils/tz.js';
import { logInfo, logError } from '../utils/logger.js';

export interface RegenerateDescriptionsApiDeps extends DescriptionRegenDeps {
  /** Shared secret the caller must present as `Authorization: Bearer <secret>`. */
  secret: string;
}

/**
 * `POST /api/activities/descriptions` — regenerates the descriptions of a
 * day's activities, just as the Whoop `workout.updated` webhook does
 * per-activity. Accepts an optional JSON body `{ date: "YYYY-MM-DD",
 * activity_id: "..." }`; `activity_id` regenerates just that one activity and
 * takes precedence over `date`, with no date it uses the current day in the
 * athlete's timezone. Authenticated with a dedicated shared secret presented
 * as `Authorization: Bearer <secret>` — no query-string auth or inputs.
 *
 * Non-idempotent batch processing action: a day can be several activities ×
 * multiple LLM calls, so it's fire-and-forget — we respond `202 Accepted`
 * immediately and regenerate in the background. Errors are logged but cannot
 * surface back to the caller. (The `regenerate_descriptions` MCP tool wraps
 * the same core but awaits and returns the structured result.)
 */
export function createRegenerateDescriptionsApiHandler(
  deps: RegenerateDescriptionsApiDeps
) {
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

    // --- Body: optional activity_id (precedence) or date (defaults to today) ---
    const body = (req.body ?? {}) as Record<string, unknown>;

    const rawActivityId = body.activity_id;
    const activityId =
      rawActivityId != null && String(rawActivityId).trim() !== ''
        ? String(rawActivityId).trim()
        : null;

    let date: string | null = null;
    if (!activityId) {
      const rawDate = body.date;
      if (rawDate !== undefined && rawDate !== null && rawDate !== '') {
        date = parseYMD(rawDate);
        if (!date) {
          res.status(400).json({ error: 'date must be a valid YYYY-MM-DD string' });
          return;
        }
      }
    }

    const targetLabel = activityId ? `activity ${activityId}` : `date ${date ?? 'today'}`;
    logInfo(
      'DescriptionApi',
      `Received regenerate-descriptions request (${targetLabel})`
    );
    res.status(202).json({ ok: true });

    // Fire-and-forget. Errors logged; cannot reach the caller after we respond.
    void regenerateDayDescriptions({ activityId, date }, deps)
      .then((result) =>
        logInfo(
          'DescriptionApi',
          `Regenerated descriptions for ${result.date} ` +
            `(regenerated=${result.regenerated.length}, skipped=${result.skipped.length})`
        )
      )
      .catch((error) => {
        logError(
          'DescriptionApi',
          `Failed to regenerate descriptions (${targetLabel})`,
          error
        );
      });
  };
}
