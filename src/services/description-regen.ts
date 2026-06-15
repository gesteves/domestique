/**
 * Shared core for (re)generating Strava-ready activity descriptions.
 *
 * Two entry points:
 *   - `maybeGenerateActivityDescription` — single activity, given an optional
 *     matched Whoop workout. Used by the Whoop `workout.updated` webhook (with
 *     the matched workout) and by the day orchestrator below.
 *   - `regenerateDayDescriptions` — every eligible activity on a given day
 *     (or today), matching Whoop workouts where possible. Used by the
 *     `POST /api/activities/descriptions` endpoint and the
 *     `regenerate_descriptions` MCP tool.
 */

import {
  findMatchingWhoopActivity,
  areActivityTypesCompatible,
} from '../utils/activity-matcher.js';
import { getTodayInTimezone } from '../utils/tz.js';
import {
  generateActivityDescription,
  type PlannedSummaryInput,
} from '../utils/activity-description.js';
import { getDescriptionModel } from '../utils/classifier-model.js';
import { runWithUnitPreferences } from '../utils/unit-context.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';
import type { IntervalsClient } from '../clients/intervals.js';
import type { WhoopClient } from '../clients/whoop.js';
import type { TrainerRoadClient } from '../clients/trainerroad.js';
import type {
  ActivityType,
  NormalizedWorkout,
  StrainActivity,
  WhoopMatchedData,
} from '../types/index.js';

export interface DescriptionRegenDeps {
  intervals: IntervalsClient;
  /** Optional — when null, descriptions are composed without a Whoop strain block. */
  whoop: WhoopClient | null;
  /** Optional — required only for the planned-workout headline summary. */
  trainerroad: TrainerRoadClient | null;
}

/** Activity types eligible for an LLM-generated planned-summary line. */
const HEADLINE_SPORTS: ReadonlySet<ActivityType> = new Set<ActivityType>([
  'Cycling',
  'Running',
]);

/**
 * Activity types eligible for a programmatically-generated description —
 * swim/bike/run only. The description blocks (power, pace, weather, Whoop
 * strain, etc.) are only meaningful for these. Other activity types (strength,
 * hiking, rowing, …) are skipped by every caller: the `regenerate_descriptions`
 * tool, the `/api/activities/descriptions` endpoint, and the Whoop webhook.
 */
const DESCRIPTION_SPORTS: ReadonlySet<ActivityType> = new Set<ActivityType>([
  'Cycling',
  'Running',
  'Swimming',
]);

/**
 * Whether an activity type is eligible for a programmatically-generated
 * description. Returns false for an undefined type (e.g. unavailable
 * Strava-only imports).
 */
export function isDescriptionEligibleSport(
  activityType: ActivityType | undefined
): boolean {
  return activityType != null && DESCRIPTION_SPORTS.has(activityType);
}

/**
 * Activity IDs currently being processed for description generation, used
 * to dedupe rapid duplicate triggers for the same activity (e.g. two
 * `workout.updated` webhooks ~100ms apart, or a day-regen overlapping a
 * Whoop webhook). Two runs would otherwise both spawn full
 * description-generation passes — 2× LLM tokens, redundant PUTs, and the
 * second clobbering the first.
 *
 * Scope: single-process only. Multi-process or rolling-restart races
 * aren't addressed — those are bounded enough not to warrant Redis.
 */
const inFlightDescriptions = new Set<string>();

export interface RegenerateDayResult {
  /** Resolved YYYY-MM-DD the descriptions were regenerated for. */
  date: string;
  /** Activity IDs a description regeneration was attempted for. */
  regenerated: string[];
  /** Activity IDs skipped (not swim/bike/run, pool swim, or unavailable Strava import). */
  skipped: string[];
}

/** What to regenerate: a single activity, or a whole day. */
export interface RegenerateTarget {
  /**
   * Regenerate just this activity. Takes precedence over `date` when both
   * are given — `date` is then ignored entirely (not even validated by
   * callers). The result's `date` is the activity's own start date.
   */
  activityId?: string | null;
  /**
   * Regenerate every eligible activity on this day (YYYY-MM-DD). Used only
   * when `activityId` is absent; null/undefined → today in the athlete's
   * timezone.
   */
  date?: string | null;
}

/**
 * Regenerate Strava-ready activity descriptions for a single activity
 * (`target.activityId`) or for every eligible activity on a day
 * (`target.date`, or today when null). `activityId` takes precedence over
 * `date`. Whoop workouts for the relevant day are matched per-activity where
 * possible; activities without a match still get a description (just no 🔥
 * Whoop strain line). Only swim/bike/run are eligible — other sports, pool
 * swims, and unavailable Strava imports are skipped. Per-activity failures are
 * isolated so one bad activity can't abort the rest.
 */
export async function regenerateDayDescriptions(
  target: RegenerateTarget,
  deps: DescriptionRegenDeps
): Promise<RegenerateDayResult> {
  if (target.activityId) {
    return regenerateSingleActivityDescription(target.activityId, deps);
  }

  const { intervals, whoop } = deps;

  const date = target.date ?? getTodayInTimezone(await intervals.getAthleteTimezone());

  const activities = await intervals.getActivities(date, date, undefined, {
    skipExpensiveCalls: true,
  });

  let whoopWorkouts: StrainActivity[] = [];
  if (whoop) {
    try {
      whoopWorkouts = await whoop.getWorkouts(date, date);
    } catch (error) {
      logWarn(
        'DescriptionRegen',
        `failed to fetch Whoop workouts for ${date} — proceeding without Whoop strain`,
        error
      );
    }
  }

  const regenerated: string[] = [];
  const skipped: string[] = [];

  for (const activity of activities) {
    if (
      activity.unavailable ||
      activity.pool_length ||
      !isDescriptionEligibleSport(activity.activity_type)
    ) {
      skipped.push(activity.id);
      continue;
    }
    const match = findMatchingWhoopActivity(activity, whoopWorkouts);
    try {
      await maybeGenerateActivityDescription(activity.id, match, deps);
      regenerated.push(activity.id);
    } catch (error) {
      logError(
        'DescriptionRegen',
        `description-generation failed for activity ${activity.id} on ${date}`,
        error
      );
    }
  }

  logInfo(
    'DescriptionRegen',
    `${date}: regenerated ${regenerated.length}, skipped ${skipped.length}`
  );

  return { date, regenerated, skipped };
}

/**
 * Regenerate the description for a single activity. The activity is fetched
 * to derive its date (used for the result and for Whoop matching) and to
 * apply the same pool-swim / unavailable-Strava-import skip rules as the
 * day path. A per-activity failure is logged and yields an empty result
 * (neither regenerated nor skipped), mirroring the day loop's isolation.
 */
async function regenerateSingleActivityDescription(
  activityId: string,
  deps: DescriptionRegenDeps
): Promise<RegenerateDayResult> {
  const { intervals, whoop } = deps;

  const activity = await intervals.getActivity(activityId);
  const date = activity.start_time.slice(0, 10);

  if (
    activity.unavailable ||
    activity.pool_length ||
    !isDescriptionEligibleSport(activity.activity_type)
  ) {
    logInfo(
      'DescriptionRegen',
      `${date}: activity ${activityId} skipped ` +
        `(not swim/bike/run, pool swim, or unavailable Strava import)`
    );
    return { date, regenerated: [], skipped: [activityId] };
  }

  let whoopWorkouts: StrainActivity[] = [];
  if (whoop) {
    try {
      whoopWorkouts = await whoop.getWorkouts(date, date);
    } catch (error) {
      logWarn(
        'DescriptionRegen',
        `failed to fetch Whoop workouts for ${date} — proceeding without Whoop strain`,
        error
      );
    }
  }

  const match = findMatchingWhoopActivity(activity, whoopWorkouts);
  try {
    await maybeGenerateActivityDescription(activityId, match, deps);
    logInfo('DescriptionRegen', `${date}: regenerated activity ${activityId}`);
    return { date, regenerated: [activityId], skipped: [] };
  } catch (error) {
    logError(
      'DescriptionRegen',
      `description-generation failed for activity ${activityId} on ${date}`,
      error
    );
    return { date, regenerated: [], skipped: [] };
  }
}

/**
 * Compose a description for the Intervals.icu activity and PUT it back.
 * Skips pool swims. Deduped against concurrent runs for the same activity
 * via `inFlightDescriptions`. Runs under the athlete's unit preferences so
 * pre-formatted strings (power, temperature, etc.) on the activity respect
 * their settings. `whoopActivity` is the matched Whoop workout, or null when
 * there's no match (the description is then composed without a Whoop block).
 */
export async function maybeGenerateActivityDescription(
  activityId: string,
  whoopActivity: StrainActivity | null,
  deps: DescriptionRegenDeps
): Promise<void> {
  if (inFlightDescriptions.has(activityId)) {
    logInfo(
      'DescriptionRegen',
      `activity ${activityId}: description already being generated — skipping duplicate`
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
  whoopActivity: StrainActivity | null,
  deps: DescriptionRegenDeps
): Promise<void> {
  const { intervals } = deps;

  const prefs = await intervals.getUnitPreferences();

  await runWithUnitPreferences(prefs, async () => {
    const full = await intervals.getActivity(activityId);

    if (!isDescriptionEligibleSport(full.activity_type)) {
      logInfo(
        'DescriptionRegen',
        `activity ${activityId} is not swim/bike/run ` +
          `(activity_type=${full.activity_type ?? 'unknown'}) — skipping description generation`
      );
      return;
    }

    if (full.pool_length) {
      logInfo(
        'DescriptionRegen',
        `activity ${activityId} is a pool swim — skipping description generation`
      );
      return;
    }

    const plannedSummary = await resolvePlannedSummary(full, deps);
    const activityDate = full.start_time.slice(0, 10);
    const heatAdaptationScore = await intervals.getCoreHeatAdaptationScore(activityDate);

    const whoopMatched: WhoopMatchedData | null = whoopActivity
      ? {
          id: whoopActivity.id,
          strain_score: whoopActivity.strain_score,
          average_heart_rate: whoopActivity.average_heart_rate,
          max_heart_rate: whoopActivity.max_heart_rate,
          calories: whoopActivity.calories,
          distance: whoopActivity.distance,
          elevation_gain: whoopActivity.elevation_gain,
          zone_durations: whoopActivity.zone_durations,
        }
      : null;

    const description = await generateActivityDescription({
      activity: full,
      whoop: whoopMatched,
      plannedSummary,
      heatAdaptationScore,
      model: getDescriptionModel(),
    });

    if (!description) {
      logInfo(
        'DescriptionRegen',
        `activity ${activityId}: composed description was empty — skipping write`
      );
      return;
    }

    await intervals.updateActivity(activityId, { description });
    logInfo(
      'DescriptionRegen',
      `activity ${activityId}: description updated (${description.length} chars)`
    );
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
  deps: DescriptionRegenDeps
): Promise<PlannedSummaryInput | null> {
  if (!activity.activity_type || !HEADLINE_SPORTS.has(activity.activity_type)) return null;
  if (!deps.trainerroad) return null;
  if (!activity.name) return null;

  const date = activity.start_time.slice(0, 10);
  const timezone = await deps.intervals.getAthleteTimezone();

  const planned = await deps.trainerroad.getPlannedWorkouts(date, date, timezone).catch((error) => {
    logWarn(
      'DescriptionRegen',
      `failed to fetch TrainerRoad planned workouts for ${date}: ${error instanceof Error ? error.message : String(error)}`
    );
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
    logInfo(
      'DescriptionRegen',
      `no TR planned workout name appears in activity name "${activityName}" on ${date} — no headline`
    );
    return null;
  }

  if (matches.length > 1) {
    logWarn(
      'DescriptionRegen',
      `ambiguous TR name match for activity "${activityName}" on ${date}: ` +
        `${matches.map((m) => m.name).join(', ')} — refusing to pick, skipping headline`
    );
    return null;
  }

  const match = matches[0];
  if (!match.description || !match.description.trim()) {
    logInfo(
      'DescriptionRegen',
      `TR planned workout "${match.name}" has no description on ${date} — no headline`
    );
    return null;
  }

  return { description: match.description };
}
