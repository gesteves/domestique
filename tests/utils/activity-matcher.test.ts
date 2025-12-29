import { describe, it, expect } from 'vitest';
import {
  normalizeActivityType,
  areActivityTypesCompatible,
  matchActivities,
  findMatchingWhoopActivity,
} from '../../src/utils/activity-matcher.js';
import type { NormalizedWorkout, StrainActivity } from '../../src/types/index.js';

describe('activity-matcher', () => {
  describe('normalizeActivityType', () => {
    it('should normalize cycling types', () => {
      expect(normalizeActivityType('Ride')).toBe('Cycling');
      expect(normalizeActivityType('ride')).toBe('Cycling');
      expect(normalizeActivityType('Cycling')).toBe('Cycling');
      expect(normalizeActivityType('VirtualRide')).toBe('Cycling');
      // Note: virtual_ride becomes "virtual ride" which is not in the map
    });

    it('should normalize running types', () => {
      expect(normalizeActivityType('Run')).toBe('Running');
      expect(normalizeActivityType('running')).toBe('Running');
      expect(normalizeActivityType('VirtualRun')).toBe('Running');
    });

    it('should normalize swimming types', () => {
      expect(normalizeActivityType('Swim')).toBe('Swimming');
      expect(normalizeActivityType('swimming')).toBe('Swimming');
    });

    it('should normalize skiing types', () => {
      expect(normalizeActivityType('AlpineSki')).toBe('Skiing');
      expect(normalizeActivityType('alpine skiing')).toBe('Skiing');
      expect(normalizeActivityType('BackcountrySki')).toBe('Skiing');
      expect(normalizeActivityType('NordicSki')).toBe('Skiing');
      expect(normalizeActivityType('cross country skiing')).toBe('Skiing');
      expect(normalizeActivityType('downhill skiing')).toBe('Skiing');
    });

    it('should normalize hiking types', () => {
      expect(normalizeActivityType('Hike')).toBe('Hiking');
      expect(normalizeActivityType('hiking')).toBe('Hiking');
    });

    it('should normalize rowing types', () => {
      expect(normalizeActivityType('Rowing')).toBe('Rowing');
      expect(normalizeActivityType('row')).toBe('Rowing');
    });

    it('should normalize strength types', () => {
      expect(normalizeActivityType('WeightTraining')).toBe('Strength');
      expect(normalizeActivityType('strength')).toBe('Strength');
      expect(normalizeActivityType('Workout')).toBe('Strength');
      expect(normalizeActivityType('functional fitness')).toBe('Strength');
      expect(normalizeActivityType('HIIT')).toBe('Strength');
    });

    it('should return Other for unknown types', () => {
      expect(normalizeActivityType('Unknown')).toBe('Other');
      expect(normalizeActivityType('yoga')).toBe('Other');
      expect(normalizeActivityType('meditation')).toBe('Other');
    });
  });

  describe('areActivityTypesCompatible', () => {
    it('should return true for exact matches', () => {
      expect(areActivityTypesCompatible('Cycling', 'Cycling')).toBe(true);
      expect(areActivityTypesCompatible('Running', 'Running')).toBe(true);
    });

    it('should return true when either type is Other', () => {
      expect(areActivityTypesCompatible('Cycling', 'Other')).toBe(true);
      expect(areActivityTypesCompatible('Other', 'Running')).toBe(true);
      expect(areActivityTypesCompatible('Other', 'Other')).toBe(true);
    });

    it('should return false for different types', () => {
      expect(areActivityTypesCompatible('Cycling', 'Running')).toBe(false);
      expect(areActivityTypesCompatible('Swimming', 'Skiing')).toBe(false);
    });
  });

  describe('matchActivities', () => {
    const createWorkout = (
      id: string,
      startTime: string,
      type: string
    ): NormalizedWorkout => ({
      id,
      start_time: startTime,
      activity_type: normalizeActivityType(type),
      duration_seconds: 3600,
      source: 'intervals.icu',
    });

    const createStrainActivity = (
      id: string,
      startTime: string,
      type: string
    ): StrainActivity => ({
      id,
      start_time: startTime,
      end_time: new Date(new Date(startTime).getTime() + 3600000).toISOString(),
      activity_type: normalizeActivityType(type),
      strain_score: 10,
    });

    it('should match activities by timestamp', () => {
      const workouts = [
        createWorkout('w1', '2024-12-15T10:00:00Z', 'Ride'),
      ];
      const activities = [
        createStrainActivity('a1', '2024-12-15T10:02:00Z', 'Cycling'),
      ];

      const result = matchActivities(workouts, activities);

      expect(result).toHaveLength(1);
      expect(result[0].intervals_workout?.id).toBe('w1');
      expect(result[0].whoop_activity?.id).toBe('a1');
    });

    it('should not match activities when timestamps differ by more than 5 minutes', () => {
      const workouts = [
        createWorkout('w1', '2024-12-15T10:00:00Z', 'Ride'),
      ];
      const activities = [
        createStrainActivity('a1', '2024-12-15T15:00:00Z', 'Cycling'),
      ];

      const result = matchActivities(workouts, activities);

      expect(result).toHaveLength(2);
      expect(result[0].intervals_workout?.id).toBe('w1');
      expect(result[0].whoop_activity).toBeUndefined();
      expect(result[1].whoop_activity?.id).toBe('a1');
      expect(result[1].intervals_workout).toBeUndefined();
    });

    it('should not match activities when types differ', () => {
      const workouts = [
        createWorkout('w1', '2024-12-15T10:00:00Z', 'Ride'),
      ];
      const activities = [
        createStrainActivity('a1', '2024-12-15T15:00:00Z', 'Running'),
      ];

      const result = matchActivities(workouts, activities);

      expect(result).toHaveLength(2);
      expect(result[0].intervals_workout?.id).toBe('w1');
      expect(result[0].whoop_activity).toBeUndefined();
      expect(result[1].whoop_activity?.id).toBe('a1');
      expect(result[1].intervals_workout).toBeUndefined();
    });

    it('should include unmatched workouts', () => {
      const workouts = [
        createWorkout('w1', '2024-12-15T10:00:00Z', 'Ride'),
      ];
      const activities: StrainActivity[] = [];

      const result = matchActivities(workouts, activities);

      expect(result).toHaveLength(1);
      expect(result[0].intervals_workout?.id).toBe('w1');
      expect(result[0].whoop_activity).toBeUndefined();
    });

    it('should include unmatched Whoop activities', () => {
      const workouts: NormalizedWorkout[] = [];
      const activities = [
        createStrainActivity('a1', '2024-12-15T10:00:00Z', 'Cycling'),
      ];

      const result = matchActivities(workouts, activities);

      expect(result).toHaveLength(1);
      expect(result[0].intervals_workout).toBeUndefined();
      expect(result[0].whoop_activity?.id).toBe('a1');
    });

    it('should handle multiple activities on the same day', () => {
      const workouts = [
        createWorkout('w1', '2024-12-15T08:00:00Z', 'Ride'),
        createWorkout('w2', '2024-12-15T17:00:00Z', 'Run'),
      ];
      const activities = [
        createStrainActivity('a1', '2024-12-15T08:01:00Z', 'Cycling'),
        createStrainActivity('a2', '2024-12-15T17:02:00Z', 'Running'),
      ];

      const result = matchActivities(workouts, activities);

      expect(result).toHaveLength(2);
      expect(result[0].intervals_workout?.id).toBe('w1');
      expect(result[0].whoop_activity?.id).toBe('a1');
      expect(result[1].intervals_workout?.id).toBe('w2');
      expect(result[1].whoop_activity?.id).toBe('a2');
    });

    it('should not reuse Whoop activities for multiple workouts', () => {
      const workouts = [
        createWorkout('w1', '2024-12-15T08:00:00Z', 'Ride'),
        createWorkout('w2', '2024-12-15T09:00:00Z', 'Ride'),
      ];
      const activities = [
        createStrainActivity('a1', '2024-12-15T08:01:00Z', 'Cycling'),
      ];

      const result = matchActivities(workouts, activities);

      // First workout gets the match, second doesn't
      const matchedActivities = result.filter((r) => r.whoop_activity);
      expect(matchedActivities).toHaveLength(1);
    });
  });

  describe('findMatchingWhoopActivity', () => {
    const workout: NormalizedWorkout = {
      id: 'w1',
      start_time: '2024-12-15T10:00:00Z',
      activity_type: 'Cycling',
      duration_seconds: 3600,
      source: 'intervals.icu',
    };

    it('should find matching activity by timestamp', () => {
      const activities: StrainActivity[] = [
        {
          id: 'a1',
          start_time: '2024-12-15T10:02:00Z',
          end_time: '2024-12-15T11:02:00Z',
          activity_type: 'Cycling',
          strain_score: 10,
        },
      ];

      const result = findMatchingWhoopActivity(workout, activities);

      expect(result?.id).toBe('a1');
    });

    it('should return null when timestamps differ by more than 5 minutes', () => {
      const activities: StrainActivity[] = [
        {
          id: 'a1',
          start_time: '2024-12-15T15:00:00Z',
          end_time: '2024-12-15T16:00:00Z',
          activity_type: 'Cycling',
          strain_score: 10,
        },
      ];

      const result = findMatchingWhoopActivity(workout, activities);

      expect(result).toBeNull();
    });

    it('should return null when no match found', () => {
      const activities: StrainActivity[] = [
        {
          id: 'a1',
          start_time: '2024-12-14T10:00:00Z', // Different day
          end_time: '2024-12-14T11:00:00Z',
          activity_type: 'Cycling',
          strain_score: 10,
        },
      ];

      const result = findMatchingWhoopActivity(workout, activities);

      expect(result).toBeNull();
    });

    it('should return the first high confidence match found', () => {
      const activities: StrainActivity[] = [
        {
          id: 'a1',
          start_time: '2024-12-15T10:01:00Z', // Close timestamp (high confidence)
          end_time: '2024-12-15T11:01:00Z',
          activity_type: 'Cycling',
          strain_score: 10,
        },
        {
          id: 'a2',
          start_time: '2024-12-15T15:00:00Z', // Same day, but >5 min difference (no match)
          end_time: '2024-12-15T16:00:00Z',
          activity_type: 'Cycling',
          strain_score: 10,
        },
      ];

      const result = findMatchingWhoopActivity(workout, activities);

      expect(result?.id).toBe('a1');
    });
  });
});
