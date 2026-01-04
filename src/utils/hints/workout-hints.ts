/**
 * Hint generators for workout-related tools.
 */

import type { HintGenerator } from '../hints.js';
import type {
  PlannedWorkout,
  TodaysPlannedWorkoutsResponse,
  DailySummary,
  TodaysCompletedWorkoutsResponse,
  WorkoutWithWhoop,
} from '../../types/index.js';
import { DOMESTIQUE_TAG, areWorkoutsSimilar } from '../workout-utils.js';

/** Response type for upcoming workouts */
interface UpcomingWorkoutsResponse {
  workouts: PlannedWorkout[];
}

/**
 * Generate a hint for TR runs that can be synced to Intervals.icu.
 * Works on the merged workout list by analyzing source and tags.
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
 * Hint generator for syncing TR runs to ICU.
 * Used by get_todays_planned_workouts and get_upcoming_workouts.
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
 * Hint generator for the daily summary's planned workouts.
 * Same logic as trainerroadSyncHint but extracts workouts from DailySummary.
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
 * Hint for suggesting workout analysis on completed workouts.
 * Suggests using get_workout_details for workouts with significant TSS.
 */
export const workoutAnalysisHint: HintGenerator<TodaysCompletedWorkoutsResponse> = (data) => {
  // Find workouts that might benefit from detailed analysis (TSS >= 50)
  const significantWorkouts = data.workouts.filter(
    (w) => w.tss && w.tss >= 50
  );

  if (significantWorkouts.length === 0) return undefined;

  const workoutNames = significantWorkouts.map((w) => w.name).filter(Boolean).join(', ');
  if (!workoutNames) return undefined;

  return (
    `The following workout(s) may benefit from detailed analysis via get_workout_details: ${workoutNames}. ` +
    `This provides intervals, notes, weather, and zone data for deeper insight.`
  );
};

/**
 * Hint for suggesting outdoor workout weather analysis.
 * Identifies outdoor workouts that could benefit from weather context.
 * Note: We can only suggest this for cycling/running workouts since we can't
 * determine indoor vs outdoor from the type alone.
 */
export const outdoorWeatherHint: HintGenerator<TodaysCompletedWorkoutsResponse> = (data) => {
  // Look for cycling or running workouts that might be outdoor
  // (We can't definitively tell indoor vs outdoor from the response)
  const potentialOutdoorWorkouts = data.workouts.filter(
    (w) => w.activity_type === 'Cycling' || w.activity_type === 'Running'
  );

  if (potentialOutdoorWorkouts.length === 0) return undefined;

  return (
    `Cycling/running workout(s) detected. If outdoor, consider fetching weather data via get_workout_weather ` +
    `to understand environmental factors that may have affected performance.`
  );
};

/**
 * Hint for workouts with Whoop data that show high strain.
 */
export const highStrainWorkoutHint: HintGenerator<TodaysCompletedWorkoutsResponse> = (data) => {
  const highStrainWorkouts = data.workouts.filter(
    (w) => w.whoop?.strain_score && w.whoop.strain_score >= 15
  );

  if (highStrainWorkouts.length === 0) return undefined;

  return (
    `High strain workout(s) detected (strain >= 15). Consider checking recovery status ` +
    `via get_todays_recovery to assess readiness for additional training.`
  );
};

/**
 * Combined hint generators for completed workouts.
 */
export const completedWorkoutsHints: HintGenerator<TodaysCompletedWorkoutsResponse>[] = [
  workoutAnalysisHint,
  outdoorWeatherHint,
  highStrainWorkoutHint,
];

/**
 * Hint for workouts with heat zone data.
 */
export const heatZonesHint: HintGenerator<WorkoutWithWhoop[]> = (workouts) => {
  const workoutsWithHeat = workouts.filter(
    (w) => w.heat_zones && Object.keys(w.heat_zones).length > 0
  );

  if (workoutsWithHeat.length === 0) return undefined;

  return (
    `Heat zone data available for ${workoutsWithHeat.length} workout(s). ` +
    `Use get_workout_heat_zones for detailed heat strain analysis.`
  );
};
