import type { Request, Response } from 'express';
import { createHmac } from 'crypto';
import { secureCompare } from '../auth/middleware.js';
import { findMatchingWhoopActivity, areActivityTypesCompatible } from '../utils/activity-matcher.js';
import { addDaysToYMD, formatYMDInTimezone } from '../utils/tz.js';
import {
  generateActivityDescription,
  type PlannedSummaryInput,
} from '../utils/activity-description.js';
import { getDescriptionModel } from '../utils/classifier-model.js';
import { runWithUnitPreferences } from '../utils/unit-context.js';
import type { IntervalsClient } from '../clients/intervals.js';
import type { WhoopClient } from '../clients/whoop.js';
import type { TrainerRoadClient } from '../clients/trainerroad.js';
import type { ActivityType, NormalizedWorkout, StrainActivity, WhoopMatchedData } from '../types/index.js';

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
  /** Optional — required only for headline generation on workout.updated. */
  trainerroad: TrainerRoadClient | null;
  /** Whoop OAuth client_secret — used as the HMAC signing key. */
  clientSecret: string;
}

/** Activity types eligible for an LLM-generated headline. */
const HEADLINE_SPORTS: ReadonlySet<ActivityType> = new Set<ActivityType>(['Cycling', 'Running']);

/**
 * Activity IDs currently being processed for description generation, used
 * to dedupe rapid duplicate `workout.updated` webhooks for the same
 * activity. Two events ~100ms apart would otherwise both spawn full
 * description-generation passes — 2× LLM tokens, redundant PUTs, and the
 * second clobbering the first.
 *
 * Scope: single-process only. Multi-process or rolling-restart races
 * aren't addressed — those are bounded enough not to warrant Redis.
 */
const inFlightDescriptions = new Set<string>();

/**
 * Runtime shape check for a Whoop webhook payload. The HMAC has already
 * verified the body came from Whoop, but we still defend against
 * malformed JSON (wrong types on the four required fields) before the
 * downstream `user_id` comparison.
 */
function isWhoopWebhookPayload(x: unknown): x is WhoopWebhookPayload {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.user_id === 'number' &&
    typeof o.id === 'string' &&
    typeof o.type === 'string' &&
    typeof o.trace_id === 'string'
  );
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
    if (!isWhoopWebhookPayload(parsed)) {
      res.status(400).json({ error: 'Malformed Whoop webhook payload' });
      return;
    }
    const payload: WhoopWebhookPayload = parsed;

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
 * Apply Whoop webhook side effects to Intervals.icu. The wellness-refresh
 * date depends on the event type:
 *
 *   - `workout.updated`: refresh the **workout's date** (Whoop sometimes
 *     scores workouts late or fires updates for retroactive edits, so the
 *     event's date isn't necessarily today). Also updates
 *     `WhoopWorkoutStrain` on the matching Intervals.icu activity and
 *     regenerates the activity description.
 *   - `sleep.updated`: refresh today and yesterday (sleep finalization is
 *     what marks the prior day's strain complete on Whoop).
 *   - All other event types: refresh today's wellness.
 */
export async function dispatchWhoopWebhook(
  payload: WhoopWebhookPayload,
  deps: WhoopWebhookDeps
): Promise<void> {
  const { intervals, whoop } = deps;
  const timezone = await intervals.getAthleteTimezone();
  const todayYMD = formatYMDInTimezone(new Date(), timezone);

  // TODO: `workout.deleted` currently falls through to "refresh today's
  // wellness." It does not clear `WhoopWorkoutStrain` on the matched
  // Intervals.icu activity, so a deleted Whoop workout leaves an orphan
  // strain value on the ICU side. Decide on intended semantics before
  // wiring up the cleanup path.
  if (payload.type === 'workout.updated') {
    const whoopActivity = await whoop.getWorkoutById(payload.id);
    if (!whoopActivity) {
      console.log(
        `[WhoopWebhook] workout.updated ${payload.id} not found or not SCORED yet — skipping`
      );
      return;
    }

    // Refresh wellness for the workout's day (not today): a workout scored
    // late, or a retroactive edit to a past workout, changes that day's
    // strain — not the current day's.
    const workoutYMD = whoopActivity.start_time.slice(0, 10);
    await refreshDailyWhoopStrain(workoutYMD, deps);

    // Look for a matching Intervals.icu activity around the workout's date.
    // 1-day buffer absorbs timezone boundaries and overnight workouts.
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

    // Best-effort: regenerate the Strava-bound description. Isolated try/catch
    // so a flaky Anthropic call or Intervals.icu hiccup never reverses the
    // WhoopWorkoutStrain write above.
    try {
      await maybeGenerateActivityDescription(match.id, whoopActivity, deps);
    } catch (error) {
      console.error(
        `[WhoopWebhook] description-generation failed for activity ${match.id} ` +
        `(trace=${payload.trace_id}):`,
        error
      );
    }
    return;
  }

  // All other event types refresh today's wellness; sleep.updated also
  // refreshes yesterday (sleep finalization is what marks the prior day's
  // strain complete on Whoop).
  await refreshDailyWhoopStrain(todayYMD, deps);
  if (payload.type === 'sleep.updated') {
    await refreshDailyWhoopStrain(addDaysToYMD(todayYMD, -1), deps);
  }
}

/**
 * Compose a description for the matched Intervals.icu activity and PUT it
 * back. Skips pool swims. Deduped against concurrent webhooks for the same
 * activity via `inFlightDescriptions`. Runs under the athlete's unit
 * preferences so pre-formatted strings (power, temperature, etc.) on the
 * activity respect their settings.
 */
async function maybeGenerateActivityDescription(
  activityId: string,
  whoopActivity: StrainActivity,
  deps: WhoopWebhookDeps
): Promise<void> {
  if (inFlightDescriptions.has(activityId)) {
    console.log(
      `[WhoopWebhook] activity ${activityId}: description already being generated — skipping duplicate`
    );
    return;
  }
  inFlightDescriptions.add(activityId);
  try {
    await runDescriptionGeneration(activityId, whoopActivity, deps);
  } finally {
    inFlightDescriptions.delete(activityId);
  }
}

async function runDescriptionGeneration(
  activityId: string,
  whoopActivity: StrainActivity,
  deps: WhoopWebhookDeps
): Promise<void> {
  const { intervals } = deps;

  const prefs = await intervals.getUnitPreferences();

  await runWithUnitPreferences(prefs, async () => {
    const full = await intervals.getActivity(activityId);

    if (full.pool_length) {
      console.log(
        `[WhoopWebhook] activity ${activityId} is a pool swim — skipping description generation`
      );
      return;
    }

    const plannedSummary = await resolvePlannedSummary(full, deps);
    const activityDate = full.start_time.slice(0, 10);
    const heatAdaptationScore = await intervals.getCoreHeatAdaptationScore(activityDate);

    const whoopMatched: WhoopMatchedData = {
      id: whoopActivity.id,
      strain_score: whoopActivity.strain_score,
      average_heart_rate: whoopActivity.average_heart_rate,
      max_heart_rate: whoopActivity.max_heart_rate,
      calories: whoopActivity.calories,
      distance: whoopActivity.distance,
      elevation_gain: whoopActivity.elevation_gain,
      zone_durations: whoopActivity.zone_durations,
    };

    const description = await generateActivityDescription({
      activity: full,
      whoop: whoopMatched,
      plannedSummary,
      heatAdaptationScore,
      model: getDescriptionModel(),
    });

    if (!description) {
      console.log(`[WhoopWebhook] activity ${activityId}: composed description was empty — skipping write`);
      return;
    }

    await intervals.updateActivity(activityId, { description });
    console.log(`[WhoopWebhook] activity ${activityId}: description updated (${description.length} chars)`);
  });
}

/**
 * Resolve the single TrainerRoad planned workout whose name appears verbatim
 * in the completed activity's name, scoped to cycling and running only.
 *
 * Rules:
 *   - Cycling and Running only — other sports never get a headline.
 *   - Requires `activity.name` and a configured TrainerRoad client.
 *   - Same-day, sport-compatible planned workouts only.
 *   - **Case-sensitive** `activity.name.includes(planned.name)` match.
 *   - Exactly one match → return it. Zero or ≥2 (ambiguous) → null.
 */
async function resolvePlannedSummary(
  activity: NormalizedWorkout,
  deps: WhoopWebhookDeps
): Promise<PlannedSummaryInput | null> {
  if (!activity.activity_type || !HEADLINE_SPORTS.has(activity.activity_type)) return null;
  if (!deps.trainerroad) return null;
  if (!activity.name) return null;

  const date = activity.start_time.slice(0, 10);
  const timezone = await deps.intervals.getAthleteTimezone();

  const planned = await deps.trainerroad.getPlannedWorkouts(date, date, timezone).catch((error) => {
    console.warn(`[WhoopWebhook] failed to fetch TrainerRoad planned workouts for ${date}:`, error);
    return [];
  });

  const activityName = activity.name;
  const matches = planned.filter(
    (p) =>
      p.sport &&
      areActivityTypesCompatible(activity.activity_type!, p.sport) &&
      p.name &&
      activityName.includes(p.name)
  );

  if (matches.length === 0) {
    console.log(
      `[WhoopWebhook] no TR planned workout name appears in activity name "${activityName}" on ${date} — no headline`
    );
    return null;
  }

  if (matches.length > 1) {
    console.warn(
      `[WhoopWebhook] ambiguous TR name match for activity "${activityName}" on ${date}: ` +
      `${matches.map((m) => m.name).join(', ')} — refusing to pick, skipping headline`
    );
    return null;
  }

  const match = matches[0];
  if (!match.description || !match.description.trim()) {
    console.log(
      `[WhoopWebhook] TR planned workout "${match.name}" has no description on ${date} — no headline`
    );
    return null;
  }

  return { description: match.description };
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
