import { parseISO, differenceInMinutes } from 'date-fns';
import type {
  NormalizedWorkout,
  StrainActivity,
  MatchedActivity,
  ActivityType,
} from '../types/index.js';

// Activity type mappings for normalization across platforms
const ACTIVITY_TYPE_MAP: Record<string, ActivityType> = {
  // Intervals.icu types
  'ride': 'Cycling',
  'cycling': 'Cycling',
  'virtualride': 'Cycling',
  'gravelride': 'Cycling',
  'mountainbikeride': 'Cycling',
  'ebikeride': 'Cycling',
  'emountainbikeride': 'Cycling',
  'run': 'Running',
  'running': 'Running',
  'virtualrun': 'Running',
  'trailrun': 'Running',
  'swim': 'Swimming',
  'swimming': 'Swimming',
  'openwaterswim': 'Swimming',
  'alpineski': 'Skiing',
  'alpine skiing': 'Skiing',
  'backcountryski': 'Skiing',
  'nordicski': 'Skiing',
  'skiing': 'Skiing',
  'hike': 'Hiking',
  'hiking': 'Hiking',
  'rowing': 'Rowing',
  'row': 'Rowing',
  'virtualrow': 'Rowing',
  'weighttraining': 'Strength',
  'strength': 'Strength',
  'workout': 'Strength',
  // Additional Whoop-specific names
  'spin': 'Cycling',
  'functional fitness': 'Strength',
  'hiit': 'Strength',
  'cross country skiing': 'Skiing',
  'downhill skiing': 'Skiing',
};

/**
 * Normalize activity type string to standard ActivityType
 */
export function normalizeActivityType(type: string): ActivityType {
  const normalized = type.toLowerCase().replace(/[_-]/g, ' ').trim();
  return ACTIVITY_TYPE_MAP[normalized] ?? 'Other';
}

/**
 * Check if two activity types are compatible for matching
 */
export function areActivityTypesCompatible(
  type1: ActivityType,
  type2: ActivityType
): boolean {
  // Exact match
  if (type1 === type2) return true;

  // "Other" matches anything
  if (type1 === 'Other' || type2 === 'Other') return true;

  return false;
}

/**
 * Get the timestamp to use for matching.
 * Returns the workout's start_time in ISO 8601 format with timezone offset.
 */
function getMatchingTimestamp(workout: NormalizedWorkout): string {
  return workout.start_time;
}

/**
 * Find the best matching Whoop activity for a workout.
 * Returns high confidence matches only (timestamp within 5 minutes + compatible
 * activity type), choosing the closest start time and preferring an exact type
 * match over an 'Other' wildcard. Optionally excludes already-used activity IDs.
 */
function findBestMatch(
  workout: NormalizedWorkout,
  whoopActivities: StrainActivity[],
  excludeIds?: Set<string>
): StrainActivity | null {
  // Skip matching for unavailable workouts (e.g., Strava-only)
  if (workout.unavailable || !workout.activity_type) {
    return null;
  }

  const workoutTimestamp = getMatchingTimestamp(workout);
  const workoutStart = parseISO(workoutTimestamp);

  // Pick the *closest* eligible candidate, preferring an exact type match over
  // an 'Other' wildcard, rather than the first one in list order.
  let best: StrainActivity | null = null;
  let bestRank: [number, number] | null = null; // [wildcard ? 1 : 0, |Δt| ms]
  for (const activity of whoopActivities) {
    if (excludeIds?.has(activity.id)) continue;

    const activityStart = parseISO(activity.start_time);
    const timeDiff = Math.abs(differenceInMinutes(workoutStart, activityStart));
    const sameType = areActivityTypesCompatible(
      workout.activity_type,
      activity.activity_type
    );

    // High confidence: timestamp match + type match
    if (timeDiff <= 5 && sameType) {
      const rank: [number, number] = [
        workout.activity_type === activity.activity_type ? 0 : 1,
        Math.abs(workoutStart.getTime() - activityStart.getTime()),
      ];
      if (!bestRank || rank[0] < bestRank[0] || (rank[0] === bestRank[0] && rank[1] < bestRank[1])) {
        best = activity;
        bestRank = rank;
      }
    }
  }

  return best;
}

/**
 * Match workouts across platforms using timestamp and activity type.
 * Algorithm:
 * - High confidence only: Start times within 5 minutes AND same activity type
 * - Workouts without high confidence matches are returned without Whoop data
 *
 * Start times carry UTC offsets, so comparisons are between absolute instants
 * regardless of each platform's local timezone.
 */
export function matchActivities(
  intervalsWorkouts: NormalizedWorkout[],
  whoopActivities: StrainActivity[]
): MatchedActivity[] {
  const matched: MatchedActivity[] = [];
  const usedWhoopIds = new Set<string>();

  for (const workout of intervalsWorkouts) {
    const match = findBestMatch(workout, whoopActivities, usedWhoopIds);

    if (match) {
      usedWhoopIds.add(match.id);
      matched.push({
        intervals_workout: workout,
        whoop_activity: match,
      });
    } else {
      // No match found (or unavailable workout), include without Whoop data
      matched.push({
        intervals_workout: workout,
      });
    }
  }

  // Add any unmatched Whoop activities
  for (const activity of whoopActivities) {
    if (!usedWhoopIds.has(activity.id)) {
      matched.push({
        whoop_activity: activity,
      });
    }
  }

  return matched;
}

/**
 * Find a single matching Whoop activity for an Intervals workout.
 * Only returns high confidence matches (timestamp within 5 minutes + same activity type).
 * Start times carry UTC offsets, so comparisons are between absolute instants
 * regardless of each platform's local timezone.
 */
export function findMatchingWhoopActivity(
  workout: NormalizedWorkout,
  whoopActivities: StrainActivity[]
): StrainActivity | null {
  return findBestMatch(workout, whoopActivities);
}
