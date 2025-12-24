import { parseISO, differenceInMinutes, format } from 'date-fns';
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
 * 1. High confidence: Start times within 5 minutes AND same activity type
 * 2. Medium confidence: Same date AND same activity type
 * 3. Low confidence: Same date only
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
    const workoutDate = format(workoutStart, 'yyyy-MM-dd');

    let bestMatch: {
      activity: StrainActivity;
      confidence: 'high' | 'medium' | 'low';
      method: 'timestamp' | 'date_and_type' | 'date_only';
    } | null = null;

    for (const activity of whoopActivities) {
      if (usedWhoopIds.has(activity.id)) continue;

      const activityStart = parseISO(activity.start_time);
      const activityDate = format(activityStart, 'yyyy-MM-dd');
      const timeDiff = Math.abs(differenceInMinutes(workoutStart, activityStart));
      const sameType = areActivityTypesCompatible(
        workout.activity_type,
        activity.activity_type
      );

      // High confidence: timestamp match + type match
      if (timeDiff <= 5 && sameType) {
        bestMatch = {
          activity,
          confidence: 'high',
          method: 'timestamp',
        };
        break; // Found best possible match
      }

      // Medium confidence: same date + type match
      if (workoutDate === activityDate && sameType) {
        if (!bestMatch || bestMatch.confidence === 'low') {
          bestMatch = {
            activity,
            confidence: 'medium',
            method: 'date_and_type',
          };
        }
      }

      // Low confidence: same date only
      if (workoutDate === activityDate && !bestMatch) {
        bestMatch = {
          activity,
          confidence: 'low',
          method: 'date_only',
        };
      }
    }

    if (bestMatch) {
      usedWhoopIds.add(bestMatch.activity.id);
      matched.push({
        intervals_workout: workout,
        whoop_activity: bestMatch.activity,
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
 * Uses UTC timestamps when available for accurate cross-platform matching.
 */
export function findMatchingWhoopActivity(
  workout: NormalizedWorkout,
  whoopActivities: StrainActivity[]
): StrainActivity | null {
  const workoutTimestamp = getMatchingTimestamp(workout);
  const workoutStart = parseISO(workoutTimestamp);
  const workoutDate = format(workoutStart, 'yyyy-MM-dd');

  // First pass: look for timestamp + type match
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

  // Second pass: look for date + type match
  for (const activity of whoopActivities) {
    const activityDate = format(parseISO(activity.start_time), 'yyyy-MM-dd');
    const sameType = areActivityTypesCompatible(
      workout.activity_type,
      activity.activity_type
    );

    if (workoutDate === activityDate && sameType) {
      return activity;
    }
  }

  return null;
}
