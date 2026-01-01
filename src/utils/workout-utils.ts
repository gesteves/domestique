import { findMatchingWhoopActivity } from './activity-matcher.js';
import type {
  PlannedWorkout,
  NormalizedWorkout,
  StrainActivity,
  WhoopMatchedData,
} from '../types/index.js';

/** Tag used to identify Domestique-created workouts */
export const DOMESTIQUE_TAG = 'domestique';

/**
 * Check if two workouts are likely the same (for deduplication).
 * Compares by date, external_id, name similarity, and TSS.
 */
export function areWorkoutsSimilar(a: PlannedWorkout, b: PlannedWorkout): boolean {
  // Same day check
  const dateA = a.scheduled_for.split('T')[0];
  const dateB = b.scheduled_for.split('T')[0];
  if (dateA !== dateB) return false;

  // External ID match (highest confidence) - check if TR id matches ICU external_id
  if (a.external_id && b.external_id && a.external_id === b.external_id) return true;
  if (a.id && b.external_id === a.id) return true;
  if (b.id && a.external_id === b.id) return true;

  // Similar name check (fuzzy)
  const nameA = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nameB = b.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (nameA.includes(nameB) || nameB.includes(nameA)) return true;

  // Similar TSS check
  if (a.expected_tss && b.expected_tss) {
    const tssDiff = Math.abs(a.expected_tss - b.expected_tss);
    if (tssDiff < 5) return true;
  }

  return false;
}

/**
 * Generate a hint for TR runs that can be synced to Intervals.icu.
 * Returns undefined if there are no unsynced runs.
 */
export function generateSyncHint(
  trWorkouts: PlannedWorkout[],
  icuWorkouts: PlannedWorkout[]
): string | undefined {
  // Find TR runs without matching ICU workouts
  const trRuns = trWorkouts.filter((w) => w.sport === 'Running');
  if (trRuns.length === 0) return undefined;

  // Check which TR runs don't have a matching ICU workout with the domestique tag
  const unsyncedRuns = trRuns.filter((trRun) => {
    // Check if there's a matching ICU workout with the same external_id
    const hasMatchingIcu = icuWorkouts.some(
      (icu) =>
        icu.tags?.includes(DOMESTIQUE_TAG) &&
        (icu.external_id === trRun.id || areWorkoutsSimilar(trRun, icu))
    );
    return !hasMatchingIcu;
  });

  if (unsyncedRuns.length === 0) return undefined;

  return (
    `Found ${unsyncedRuns.length} TrainerRoad running workout(s) that could be synced to Intervals.icu ` +
    `for structured execution on Zwift/Garmin. You can offer to sync these using the create_run_workout tool. ` +
    `First fetch the user's running pace zones via get_sports_settings, then read the intervals-run-workout-syntax resource for syntax documentation.`
  );
}

/**
 * Find and match a Whoop activity to an Intervals.icu workout.
 * Returns the matched Whoop data or null if no match found.
 */
export function matchWhoopActivity(
  workout: NormalizedWorkout,
  whoopActivities: StrainActivity[]
): WhoopMatchedData | null {
  const match = findMatchingWhoopActivity(workout, whoopActivities);
  if (!match) return null;

  return {
    strain_score: match.strain_score,
    average_heart_rate: match.average_heart_rate,
    max_heart_rate: match.max_heart_rate,
    calories: match.calories,
    distance: match.distance,
    elevation_gain: match.elevation_gain,
    zone_durations: match.zone_durations,
  };
}
