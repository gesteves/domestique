import { describe, it, expect } from 'vitest';
import {
  DOMESTIQUE_TAG,
  areWorkoutsSimilar,
  matchWhoopActivity,
} from '../../src/utils/workout-utils.js';
import type { PlannedWorkout, NormalizedWorkout, StrainActivity } from '../../src/types/index.js';

describe('workout-utils', () => {
  describe('DOMESTIQUE_TAG', () => {
    it('should be the expected value', () => {
      expect(DOMESTIQUE_TAG).toBe('domestique');
    });
  });

  describe('areWorkoutsSimilar', () => {
    const createPlannedWorkout = (
      overrides: Partial<PlannedWorkout> = {}
    ): PlannedWorkout => ({
      id: 'test-id',
      name: 'Test Workout',
      scheduled_for: '2024-12-15T08:00:00',
      sport: 'Cycling',
      source: 'intervals.icu',
      ...overrides,
    });

    it('should return false for different days', () => {
      const a = createPlannedWorkout({ scheduled_for: '2024-12-15T08:00:00' });
      const b = createPlannedWorkout({ scheduled_for: '2024-12-16T08:00:00' });
      expect(areWorkoutsSimilar(a, b)).toBe(false);
    });

    it('should return true for matching external_id', () => {
      const a = createPlannedWorkout({ external_id: 'tr-123' });
      const b = createPlannedWorkout({ external_id: 'tr-123' });
      expect(areWorkoutsSimilar(a, b)).toBe(true);
    });

    it('should return true when a.id matches b.external_id', () => {
      const a = createPlannedWorkout({ id: 'tr-123' });
      const b = createPlannedWorkout({ external_id: 'tr-123' });
      expect(areWorkoutsSimilar(a, b)).toBe(true);
    });

    it('should return true when b.id matches a.external_id', () => {
      const a = createPlannedWorkout({ external_id: 'tr-123' });
      const b = createPlannedWorkout({ id: 'tr-123' });
      expect(areWorkoutsSimilar(a, b)).toBe(true);
    });

    it('should return true for similar names (partial match)', () => {
      const a = createPlannedWorkout({ name: 'Tempo Run' });
      const b = createPlannedWorkout({ name: 'Tempo' });
      expect(areWorkoutsSimilar(a, b)).toBe(true);
    });

    it('should return true for similar names (case insensitive)', () => {
      const a = createPlannedWorkout({ name: 'TEMPO RUN' });
      const b = createPlannedWorkout({ name: 'tempo run' });
      expect(areWorkoutsSimilar(a, b)).toBe(true);
    });

    it('should return true for similar names (ignoring special characters)', () => {
      const a = createPlannedWorkout({ name: 'Tempo Run - Easy' });
      const b = createPlannedWorkout({ name: 'TempoRunEasy' });
      expect(areWorkoutsSimilar(a, b)).toBe(true);
    });

    it('should return true for similar TSS (within 5)', () => {
      const a = createPlannedWorkout({ expected_tss: 50, name: 'Workout A' });
      const b = createPlannedWorkout({ expected_tss: 53, name: 'Workout B' });
      expect(areWorkoutsSimilar(a, b)).toBe(true);
    });

    it('should return false for different TSS (more than 5 apart)', () => {
      const a = createPlannedWorkout({ expected_tss: 50, name: 'Workout A' });
      const b = createPlannedWorkout({ expected_tss: 60, name: 'Workout B' });
      expect(areWorkoutsSimilar(a, b)).toBe(false);
    });

    it('should return false for completely different workouts', () => {
      const a = createPlannedWorkout({ name: 'Sprint Intervals', expected_tss: 80 });
      const b = createPlannedWorkout({ name: 'Recovery Ride', expected_tss: 30 });
      expect(areWorkoutsSimilar(a, b)).toBe(false);
    });
  });

  describe('matchWhoopActivity', () => {
    const createWorkout = (
      overrides: Partial<NormalizedWorkout> = {}
    ): NormalizedWorkout => ({
      id: 'w1',
      start_time: '2024-12-15T10:00:00Z',
      activity_type: 'Cycling',
      duration_seconds: 3600,
      source: 'intervals.icu',
      ...overrides,
    });

    const createStrainActivity = (
      overrides: Partial<StrainActivity> = {}
    ): StrainActivity => ({
      id: 'a1',
      start_time: '2024-12-15T10:02:00Z',
      end_time: '2024-12-15T11:02:00Z',
      activity_type: 'Cycling',
      strain_score: 10.5,
      average_heart_rate: 145,
      max_heart_rate: 175,
      calories: 500,
      distance: 25000,
      elevation_gain: 300,
      zone_durations: [600, 1200, 900, 600, 300],
      ...overrides,
    });

    it('should return matched Whoop data for matching activity', () => {
      const workout = createWorkout();
      const activities = [createStrainActivity()];

      const result = matchWhoopActivity(workout, activities);

      expect(result).not.toBeNull();
      expect(result?.strain_score).toBe(10.5);
      expect(result?.average_heart_rate).toBe(145);
      expect(result?.max_heart_rate).toBe(175);
      expect(result?.calories).toBe(500);
      expect(result?.distance).toBe(25000);
      expect(result?.elevation_gain).toBe(300);
      expect(result?.zone_durations).toEqual([600, 1200, 900, 600, 300]);
    });

    it('should return null when no matching activity found', () => {
      const workout = createWorkout();
      const activities = [
        createStrainActivity({
          start_time: '2024-12-15T15:00:00Z', // Too far from workout
        }),
      ];

      const result = matchWhoopActivity(workout, activities);

      expect(result).toBeNull();
    });

    it('should return null when activities array is empty', () => {
      const workout = createWorkout();

      const result = matchWhoopActivity(workout, []);

      expect(result).toBeNull();
    });

    it('should handle undefined optional fields', () => {
      const workout = createWorkout();
      const activities = [
        {
          id: 'a1',
          start_time: '2024-12-15T10:02:00Z',
          end_time: '2024-12-15T11:02:00Z',
          activity_type: 'Cycling' as const,
          strain_score: 10.5,
          // No optional fields
        },
      ];

      const result = matchWhoopActivity(workout, activities);

      expect(result).not.toBeNull();
      expect(result?.strain_score).toBe(10.5);
      expect(result?.average_heart_rate).toBeUndefined();
      expect(result?.calories).toBeUndefined();
    });
  });
});
