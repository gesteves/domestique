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
  'run': 'Running',
  'running': 'Running',
  'virtualrun': 'Running',
  'swim': 'Swimming',
  'swimming': 'Swimming',
  'alpineski': 'Skiing',
  'alpine skiing': 'Skiing',
  'backcountryski': 'Skiing',
  'nordicski': 'Skiing',
  'skiing': 'Skiing',
  'hike': 'Hiking',
  'hiking': 'Hiking',
  'rowing': 'Rowing',
  'row': 'Rowing',
  'weighttraining': 'Strength',
  'strength': 'Strength',
  'workout': 'Strength',
  // Additional Whoop-specific names
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
 * Get the best timestamp to use for matching.
 * Prefers UTC timestamp (start_date_utc) when available for accurate cross-platform matching.
 */
function getMatchingTimestamp(workout: NormalizedWorkout): string {
  // Prefer UTC timestamp for accurate matching with Whoop (which uses UTC)
  return workout.start_date_utc ?? workout.date;
}

/**
 * Match workouts across platforms using timestamp and activity type.
 * Algorithm:
 * - High confidence only: Start times within 5 minutes AND same activity type
 * - Workouts without high confidence matches are returned without Whoop data
 *
 * Uses UTC timestamps when available for accurate cross-platform matching.
 */
export function matchActivities(
  intervalsWorkouts: NormalizedWorkout[],
  whoopActivities: StrainActivity[]
): MatchedActivity[] {
  const matched: MatchedActivity[] = [];
  const usedWhoopIds = new Set<string>();

  for (const workout of intervalsWorkouts) {
    const workoutTimestamp = getMatchingTimestamp(workout);
    const workoutStart = parseISO(workoutTimestamp);

    let highConfidenceMatch: StrainActivity | null = null;

    for (const activity of whoopActivities) {
      if (usedWhoopIds.has(activity.id)) continue;

      const activityStart = parseISO(activity.start_time);
      const timeDiff = Math.abs(differenceInMinutes(workoutStart, activityStart));
      const sameType = areActivityTypesCompatible(
        workout.activity_type,
        activity.activity_type
      );

      // High confidence: timestamp match + type match
      if (timeDiff <= 5 && sameType) {
        highConfidenceMatch = activity;
        break; // Found best possible match
      }
    }

    if (highConfidenceMatch) {
      usedWhoopIds.add(highConfidenceMatch.id);
      matched.push({
        intervals_workout: workout,
        whoop_activity: highConfidenceMatch,
      });
    } else {
      // No match found, include workout without Whoop data
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
 * Uses UTC timestamps when available for accurate cross-platform matching.
 */
export function findMatchingWhoopActivity(
  workout: NormalizedWorkout,
  whoopActivities: StrainActivity[]
): StrainActivity | null {
  const workoutTimestamp = getMatchingTimestamp(workout);
  const workoutStart = parseISO(workoutTimestamp);

  // Only look for high confidence matches: timestamp + type match
  for (const activity of whoopActivities) {
    const activityStart = parseISO(activity.start_time);
    const timeDiff = Math.abs(differenceInMinutes(workoutStart, activityStart));
    const sameType = areActivityTypesCompatible(
      workout.activity_type,
      activity.activity_type
    );

    if (timeDiff <= 5 && sameType) {
      return activity;
    }
  }

  return null;
}
