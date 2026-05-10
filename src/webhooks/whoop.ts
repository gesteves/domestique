import type { Request, Response } from 'express';
import { createHmac } from 'crypto';
import { secureCompare } from '../auth/middleware.js';
import { findMatchingWhoopActivity } from '../utils/activity-matcher.js';
import { addDaysToYMD, formatYMDInTimezone } from '../utils/tz.js';
import type { IntervalsClient } from '../clients/intervals.js';
import type { WhoopClient } from '../clients/whoop.js';

/** Maximum clock skew tolerated between Whoop's signing timestamp and our clock. */
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

/** Whoop v2 webhook event types. */
export type WhoopWebhookEventType =
  | 'recovery.updated'
  | 'recovery.deleted'
  | 'workout.updated'
  | 'workout.deleted'
  | 'sleep.updated'
  | 'sleep.deleted';

/** Whoop v2 webhook payload (v2 uses UUID strings for resource IDs). */
export interface WhoopWebhookPayload {
  user_id: number;
  id: string;
  type: WhoopWebhookEventType;
  trace_id: string;
}

export interface WhoopWebhookDeps {
  intervals: IntervalsClient;
  whoop: WhoopClient;
  /** Whoop OAuth client_secret — used as the HMAC signing key. */
  clientSecret: string;
}

/**
 * Verify the X-WHOOP-Signature header per Whoop's spec:
 *   base64( HMAC-SHA256( timestampHeader + rawBody, clientSecret ) )
 * https://developer.whoop.com/docs/developing/webhooks/
 */
export function verifyWhoopSignature(
  rawBody: Buffer,
  timestampHeader: string,
  signatureHeader: string,
  clientSecret: string
): boolean {
  if (!timestampHeader || !signatureHeader) return false;
  const hmac = createHmac('sha256', clientSecret);
  hmac.update(timestampHeader);
  hmac.update(rawBody);
  const expected = hmac.digest('base64');
  return secureCompare(signatureHeader, expected);
}

/**
 * Express handler for POST /webhooks/whoop. Verifies the HMAC, validates the
 * payload's user_id, then responds 200 and dispatches processing asynchronously
 * — Whoop wants a 2XX within ~1s and will otherwise retry.
 *
 * Errors inside the async dispatch are logged but cannot surface back to Whoop
 * (we've already responded). This is the documented trade-off.
 */
export function createWhoopWebhookHandler(deps: WhoopWebhookDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody)) {
      console.error('[WhoopWebhook] Handler invoked without a raw Buffer body — check route middleware');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    const signatureHeader = req.header('X-WHOOP-Signature');
    const timestampHeader = req.header('X-WHOOP-Signature-Timestamp');
    if (!signatureHeader || !timestampHeader) {
      res.status(401).json({ error: 'Missing Whoop signature headers' });
      return;
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MAX_TIMESTAMP_SKEW_MS) {
      res.status(401).json({ error: 'Stale or invalid signature timestamp' });
      return;
    }

    if (!verifyWhoopSignature(rawBody, timestampHeader, signatureHeader, deps.clientSecret)) {
      res.status(401).json({ error: 'Invalid Whoop signature' });
      return;
    }

    let payload: WhoopWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as WhoopWebhookPayload;
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }

    let expectedUserId: number;
    try {
      expectedUserId = await deps.whoop.getUserId();
    } catch (error) {
      console.error('[WhoopWebhook] Failed to resolve authenticated Whoop user_id:', error);
      res.status(500).json({ error: 'Unable to verify user identity' });
      return;
    }

    if (payload.user_id !== expectedUserId) {
      console.warn(
        `[WhoopWebhook] Rejecting event for user_id=${payload.user_id} ` +
        `(expected ${expectedUserId}, type=${payload.type}, trace=${payload.trace_id})`
      );
      res.status(403).json({ error: 'user_id does not match configured athlete' });
      return;
    }

    res.status(200).json({ ok: true });

    // Fire-and-forget. Errors logged; cannot reach Whoop after we've responded.
    void dispatchWhoopWebhook(payload, deps).catch((error) => {
      console.error(
        `[WhoopWebhook] Dispatch failed for trace=${payload.trace_id} type=${payload.type}:`,
        error
      );
    });
  };
}

/**
 * Apply Whoop webhook side effects to Intervals.icu:
 *   - Every event refreshes today's wellness `WhoopStrain`.
 *   - `sleep.updated` additionally refreshes yesterday's `WhoopStrain`
 *     (sleep finalization is what marks the prior day complete on Whoop).
 *   - `workout.updated` updates `WhoopWorkoutStrain` on the matching
 *     Intervals.icu activity (or logs and skips if no match).
 */
export async function dispatchWhoopWebhook(
  payload: WhoopWebhookPayload,
  deps: WhoopWebhookDeps
): Promise<void> {
  const { intervals, whoop } = deps;
  const timezone = await intervals.getAthleteTimezone();
  const todayYMD = formatYMDInTimezone(new Date(), timezone);

  await refreshDailyWhoopStrain(todayYMD, deps);

  if (payload.type === 'sleep.updated') {
    const yesterdayYMD = addDaysToYMD(todayYMD, -1);
    await refreshDailyWhoopStrain(yesterdayYMD, deps);
  }

  if (payload.type === 'workout.updated') {
    const whoopActivity = await whoop.getWorkoutById(payload.id);
    if (!whoopActivity) {
      console.log(
        `[WhoopWebhook] workout.updated ${payload.id} not found or not SCORED yet — skipping`
      );
      return;
    }

    // Look for a matching Intervals.icu activity around the workout's date.
    // 1-day buffer absorbs timezone boundaries and overnight workouts.
    const workoutYMD = whoopActivity.start_time.slice(0, 10);
    const oldest = addDaysToYMD(workoutYMD, -1);
    const newest = addDaysToYMD(workoutYMD, 1);

    const candidates = await intervals.getActivities(oldest, newest, undefined, {
      skipExpensiveCalls: true,
    });

    const match = candidates.find(
      (candidate) => findMatchingWhoopActivity(candidate, [whoopActivity]) !== null
    );

    if (!match) {
      console.log(
        `[WhoopWebhook] workout.updated ${payload.id}: no matching Intervals.icu activity ` +
        `on ${workoutYMD} — skipping (will reconcile on read)`
      );
      return;
    }

    await intervals.updateActivity(match.id, {
      WhoopWorkoutStrain: whoopActivity.strain_score,
    });
    console.log(
      `[WhoopWebhook] workout.updated ${payload.id} → Intervals.icu activity ${match.id} ` +
      `WhoopWorkoutStrain=${whoopActivity.strain_score}`
    );
  }
}

async function refreshDailyWhoopStrain(
  dateYMD: string,
  deps: WhoopWebhookDeps
): Promise<void> {
  const { intervals, whoop } = deps;
  const days = await whoop.getStrainData(dateYMD, dateYMD);
  const day = days.find((d) => d.date === dateYMD);
  if (!day) {
    console.log(`[WhoopWebhook] No Whoop strain data for ${dateYMD} — leaving wellness untouched`);
    return;
  }
  await intervals.updateWellness(dateYMD, { WhoopStrain: day.strain_score });
  console.log(`[WhoopWebhook] Updated wellness ${dateYMD} WhoopStrain=${day.strain_score}`);
}
