/**
 * Hint generators for workout-related tools.
 * These hints guide the LLM on what other tools to call for deeper analysis.
 */

import type { HintGenerator } from '../hints.js';
import type {
  PlannedWorkout,
  TodaysPlannedWorkoutsResponse,
  TodaysActivitiesResponse,
  TodaysWorkouts,
  DailySummary,
  WorkoutWithWhoop,
} from '../../types/index.js';
import { DOMESTIQUE_TAG, areWorkoutsSimilar } from '../workout-utils.js';

/** Response type for upcoming activities (subset used by hints) */
interface UpcomingActivitiesResponse {
  workouts: PlannedWorkout[];
}

/**
 * Find TR runs that don't have matching ICU workouts with the domestique tag.
 */
function findUnsyncedTRRuns(workouts: PlannedWorkout[]): PlannedWorkout[] {
  // Find TR runs
  const trRuns = workouts.filter(
    (w) => w.source === 'trainerroad' && w.sport === 'Running'
  );
  if (trRuns.length === 0) return [];

  // Find ICU workouts with domestique tag
  const icuDomestiqueWorkouts = workouts.filter(
    (w) => w.source === 'intervals.icu' && w.tags?.includes(DOMESTIQUE_TAG)
  );

  // Check which TR runs don't have a matching ICU workout
  return trRuns.filter((trRun) => {
    const hasMatchingIcu = icuDomestiqueWorkouts.some(
      (icu) =>
        icu.external_id === trRun.id || areWorkoutsSimilar(trRun, icu)
    );
    return !hasMatchingIcu;
  });
}

/**
 * Shared message for TrainerRoad runs that have no Intervals.icu copy yet.
 * Returns undefined when every TR run is already synced.
 */
function unsyncedRunsHint(workouts: PlannedWorkout[]): string | undefined {
  const unsyncedRuns = findUnsyncedTRRuns(workouts);
  if (unsyncedRuns.length === 0) return undefined;

  return (
    `Found ${unsyncedRuns.length} TrainerRoad running workout(s) that could be synced to Intervals.icu ` +
    `for structured execution on Zwift/Garmin. You can offer to sync these using the sync_trainerroad_runs ` +
    `or create_workout (sport: "running") tools. First fetch the user's running pace zones via get_sports_settings.`
  );
}

/**
 * Hint for syncing TR runs to ICU.
 * Guides LLM to offer syncing unsynced TrainerRoad runs.
 */
export const trainerroadSyncHint: HintGenerator<TodaysPlannedWorkoutsResponse | UpcomingActivitiesResponse> = (
  data
) => {
  return unsyncedRunsHint(data.workouts);
};

/** The workout lists both today tools share. */
interface TodaysWorkoutsResponse {
  workouts: TodaysWorkouts;
}

/**
 * Hint for syncing TR runs to ICU from either today tool (both carry
 * `workouts.planned`).
 */
export const todaysSyncHint: HintGenerator<TodaysWorkoutsResponse> = (data) => {
  return unsyncedRunsHint(data.workouts.planned);
};

/**
 * The daily summary returns completed workouts in the list shape; point at
 * the detail tool only when there's something completed to drill into.
 */
export const dailySummaryWorkoutDetailHint: HintGenerator<DailySummary> = (data) => {
  if (data.workouts.completed.length === 0) return undefined;
  return `For intervals, notes, and weather on today's completed workouts, call get_workout_details with its id.`;
};

/** Hint generators for the daily summary. */
export const dailySummaryHints: HintGenerator<DailySummary>[] = [
  todaysSyncHint,
  dailySummaryWorkoutDetailHint,
];

/** Response type for activity history */
interface ActivityHistoryResponse {
  workouts: WorkoutWithWhoop[];
}

/**
 * Hint for drilling into activity history details.
 * Guides LLM on which tools to call for deeper workout analysis.
 */
export const activityHistoryHint: HintGenerator<ActivityHistoryResponse | WorkoutWithWhoop[]> = (data) => {
  const workouts = Array.isArray(data) ? data : data.workouts;
  if (workouts.length === 0) return undefined;

  return `For intervals, notes, and weather on any of these workouts, call get_workout_details with its id.`;
};

/**
 * Combined hint generators for activity history.
 */
export const activityHistoryHints: HintGenerator<ActivityHistoryResponse | WorkoutWithWhoop[]>[] = [
  activityHistoryHint,
];

/**
 * Combined hint generators for today's activities.
 */
export const todaysActivitiesHints: HintGenerator<TodaysActivitiesResponse>[] = [
  todaysSyncHint,
];
