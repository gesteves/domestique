/**
 * Hint generators for workout-related tools.
 * These hints guide the LLM on what other tools to call for deeper analysis.
 */

import type { HintGenerator } from '../hints.js';
import type {
  PlannedWorkout,
  TodaysPlannedWorkoutsResponse,
  DailySummary,
  TodaysCompletedWorkoutsResponse,
} from '../../types/index.js';
import { DOMESTIQUE_TAG, areWorkoutsSimilar } from '../workout-utils.js';

/** Response type for upcoming workouts */
interface UpcomingWorkoutsResponse {
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
 * Hint for syncing TR runs to ICU.
 * Guides LLM to offer syncing unsynced TrainerRoad runs.
 */
export const trainerroadSyncHint: HintGenerator<TodaysPlannedWorkoutsResponse | UpcomingWorkoutsResponse> = (
  data
) => {
  const unsyncedRuns = findUnsyncedTRRuns(data.workouts);
  if (unsyncedRuns.length === 0) return undefined;

  return (
    `Found ${unsyncedRuns.length} TrainerRoad running workout(s) that could be synced to Intervals.icu ` +
    `for structured execution on Zwift/Garmin. You can offer to sync these using the sync_trainerroad_runs ` +
    `or create_run_workout tools. First fetch the user's running pace zones via get_sports_settings.`
  );
};

/**
 * Hint for the daily summary's planned workouts.
 */
export const dailySummarySyncHint: HintGenerator<DailySummary> = (data) => {
  const unsyncedRuns = findUnsyncedTRRuns(data.planned_workouts);
  if (unsyncedRuns.length === 0) return undefined;

  return (
    `Found ${unsyncedRuns.length} TrainerRoad running workout(s) that could be synced to Intervals.icu ` +
    `for structured execution on Zwift/Garmin. You can offer to sync these using the sync_trainerroad_runs ` +
    `or create_run_workout tools. First fetch the user's running pace zones via get_sports_settings.`
  );
};

/**
 * Hint for drilling into completed workout details.
 * Guides LLM on which tools to call for deeper workout analysis.
 */
export const completedWorkoutsAnalysisHint: HintGenerator<TodaysCompletedWorkoutsResponse> = (data) => {
  if (data.workouts.length === 0) return undefined;

  const workoutIds = data.workouts.map((w) => w.id).join(', ');

  return (
    `To analyze these workouts in more detail, use get_workout_details with activity_id to see intervals, ` +
    `notes, weather, and zone distributions. For interval-by-interval breakdown, use get_workout_intervals. ` +
    `Available workout IDs: ${workoutIds}`
  );
};

/**
 * Combined hint generators for completed workouts.
 */
export const completedWorkoutsHints: HintGenerator<TodaysCompletedWorkoutsResponse>[] = [
  completedWorkoutsAnalysisHint,
];
