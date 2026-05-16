import type { Request, Response } from 'express';
import { secureCompare } from '../auth/middleware.js';
import {
  regenerateDayDescriptions,
  type DescriptionRegenDeps,
} from '../services/description-regen.js';
import { logInfo, logError } from '../utils/logger.js';

export interface RegenerateDescriptionsWebhookDeps extends DescriptionRegenDeps {
  /** Shared secret the caller must present (Bearer header or ?token=). */
  secret: string;
}

/**
 * Strict YYYY-MM-DD check that also rejects impossible calendar dates
 * (e.g. 2026-02-30). Returns the date unchanged when valid, else null.
 */
function parseYMD(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() + 1 !== Number(mo) ||
    date.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return trimmed;
}

/**
 * Webhook receiver that regenerates the descriptions of a day's activities,
 * just as the Whoop `workout.updated` webhook does per-activity. Accepts an
 * optional `POST { date: "YYYY-MM-DD" }`; with no date it uses the current
 * day in the athlete's timezone. Authenticated with the shared
 * `WEBHOOK_SECRET` (Authorization: Bearer <secret>, or ?token=<secret>) — the
 * same secret as the location webhook.
 *
 * Fire-and-forget like the Whoop webhook: a day can be several activities ×
 * multiple LLM calls, so we respond 200 immediately and regenerate in the
 * background. Errors are logged but cannot surface back to the caller.
 */
export function createRegenerateDescriptionsWebhookHandler(
  deps: RegenerateDescriptionsWebhookDeps
) {
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

    // --- Body: optional date (defaults to today in the athlete's tz) ---
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawDate = body.date;
    let date: string | null = null;
    if (rawDate !== undefined && rawDate !== null && rawDate !== '') {
      date = parseYMD(rawDate);
      if (!date) {
        res.status(400).json({ error: 'date must be a valid YYYY-MM-DD string' });
        return;
      }
    }

    logInfo(
      'DescriptionWebhook',
      `Received regenerate-descriptions request (date=${date ?? 'today'})`
    );
    res.status(200).json({ ok: true });

    // Fire-and-forget. Errors logged; cannot reach the caller after we respond.
    void regenerateDayDescriptions(date, deps)
      .then((result) =>
        logInfo(
          'DescriptionWebhook',
          `Regenerated descriptions for ${result.date} ` +
            `(regenerated=${result.regenerated.length}, skipped=${result.skipped.length})`
        )
      )
      .catch((error) => {
        logError(
          'DescriptionWebhook',
          `Failed to regenerate descriptions (date=${date ?? 'today'})`,
          error
        );
      });
  };
}
