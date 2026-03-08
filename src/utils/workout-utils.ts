import { findMatchingWhoopActivity } from './activity-matcher.js';
import type { IntervalsClient } from '../clients/intervals.js';
import type { WhoopClient } from '../clients/whoop.js';
import type { TrainerRoadClient } from '../clients/trainerroad.js';
import type {
  PlannedWorkout,
  NormalizedWorkout,
  StrainActivity,
  WhoopMatchedData,
  WorkoutWithWhoop,
  ActivityType,
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
 * Merge workouts from TrainerRoad and Intervals.icu, avoiding duplicates.
 * Prefers TrainerRoad workouts when duplicates are detected (has more detail).
 */
export function mergeWorkouts(
  trainerroad: PlannedWorkout[],
  intervals: PlannedWorkout[]
): PlannedWorkout[] {
  const merged = [...trainerroad];

  for (const intervalsWorkout of intervals) {
    const isDuplicate = trainerroad.some((tr) =>
      areWorkoutsSimilar(tr, intervalsWorkout)
    );
    if (!isDuplicate) {
      merged.push(intervalsWorkout);
    }
  }

  return merged;
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

/**
 * Enrich workouts with matched Whoop activity data.
 * Fetches Whoop activities for the date range and matches them to workouts.
 * Gracefully handles Whoop fetch failures by continuing without Whoop data.
 */
export async function enrichWorkoutsWithWhoop(
  workouts: NormalizedWorkout[],
  whoop: WhoopClient | null,
  startDate: string,
  endDate: string
): Promise<WorkoutWithWhoop[]> {
  if (!whoop) {
    return workouts.map((w) => ({ ...w, whoop: null }));
  }
  let whoopActivities: StrainActivity[] = [];
  try {
    whoopActivities = await whoop.getWorkouts(startDate, endDate);
  } catch (error) {
    console.error('Error fetching Whoop activities for matching:', error);
  }
  return workouts.map((w) => ({ ...w, whoop: matchWhoopActivity(w, whoopActivities) }));
}

// ============================================
// Sport Type Normalization
// ============================================

const SPORT_MAP: Record<string, string> = {
  Cycling: 'cycling',
  Running: 'running',
  Swimming: 'swimming',
  Skiing: 'skiing',
  Hiking: 'hiking',
  Rowing: 'rowing',
  Strength: 'strength',
};

/**
 * Normalize an ActivityType to a lowercase sport string.
 */
export function normalizeActivityTypeToSport(activityType: string): string {
  return SPORT_MAP[activityType] ?? 'other';
}

/**
 * Convert a lowercase sport string to its ActivityType.
 * Returns undefined if no match found.
 */
export function sportToActivityType(sport: string): ActivityType | undefined {
  const entry = Object.entries(SPORT_MAP).find(([, v]) => v === sport);
  return entry?.[0] as ActivityType | undefined;
}

// ============================================
// Planned Workout Fetching
// ============================================

/**
 * Fetch planned workouts from both TrainerRoad and Intervals.icu in parallel,
 * then merge and deduplicate them.
 * Gracefully handles fetch failures from either source.
 */
export async function fetchAndMergePlannedWorkouts(
  intervals: IntervalsClient,
  trainerroad: TrainerRoadClient | null,
  startDate: string,
  endDate: string,
  timezone: string
): Promise<PlannedWorkout[]> {
  const [trWorkouts, icuWorkouts] = await Promise.all([
    trainerroad?.getPlannedWorkouts(startDate, endDate, timezone).catch((e) => {
      console.error('Error fetching TrainerRoad workouts:', e);
      return [];
    }) ?? Promise.resolve([]),
    intervals.getPlannedEvents(startDate, endDate).catch((e) => {
      console.error('Error fetching Intervals.icu events:', e);
      return [];
    }),
  ]);
  return mergeWorkouts(trWorkouts, icuWorkouts);
}
