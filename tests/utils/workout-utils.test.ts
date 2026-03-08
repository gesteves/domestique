import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DOMESTIQUE_TAG,
  areWorkoutsSimilar,
  matchWhoopActivity,
  enrichWorkoutsWithWhoop,
  normalizeActivityTypeToSport,
  sportToActivityType,
  fetchAndMergePlannedWorkouts,
} from '../../src/utils/workout-utils.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { WhoopClient } from '../../src/clients/whoop.js';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';
import type { PlannedWorkout, NormalizedWorkout, StrainActivity } from '../../src/types/index.js';

vi.mock('../../src/clients/intervals.js');
vi.mock('../../src/clients/whoop.js');
vi.mock('../../src/clients/trainerroad.js');

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

  describe('enrichWorkoutsWithWhoop', () => {
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

    const mockWhoopActivities: StrainActivity[] = [
      {
        id: 'a1',
        start_time: '2024-12-15T10:02:00Z',
        end_time: '2024-12-15T11:02:00Z',
        activity_type: 'Cycling',
        strain_score: 10.5,
        average_heart_rate: 145,
        max_heart_rate: 175,
        calories: 500,
      },
    ];

    it('should return workouts with null whoop when no whoop client', async () => {
      const workouts = [createWorkout()];
      const result = await enrichWorkoutsWithWhoop(workouts, null, '2024-12-15', '2024-12-15');

      expect(result).toHaveLength(1);
      expect(result[0].whoop).toBeNull();
      expect(result[0].id).toBe('w1');
    });

    it('should enrich workouts with matched Whoop data', async () => {
      const mockWhoop = new WhoopClient({
        accessToken: 'test',
        refreshToken: 'test',
        clientId: 'test',
        clientSecret: 'test',
      });
      vi.mocked(mockWhoop.getWorkouts).mockResolvedValue(mockWhoopActivities);

      const workouts = [createWorkout()];
      const result = await enrichWorkoutsWithWhoop(workouts, mockWhoop, '2024-12-15', '2024-12-15');

      expect(result).toHaveLength(1);
      expect(result[0].whoop).not.toBeNull();
      expect(result[0].whoop?.strain_score).toBe(10.5);
    });

    it('should gracefully handle Whoop fetch errors', async () => {
      const mockWhoop = new WhoopClient({
        accessToken: 'test',
        refreshToken: 'test',
        clientId: 'test',
        clientSecret: 'test',
      });
      vi.mocked(mockWhoop.getWorkouts).mockRejectedValue(new Error('API Error'));

      const workouts = [createWorkout()];
      const result = await enrichWorkoutsWithWhoop(workouts, mockWhoop, '2024-12-15', '2024-12-15');

      expect(result).toHaveLength(1);
      expect(result[0].whoop).toBeNull();
    });
  });

  describe('normalizeActivityTypeToSport', () => {
    it('should normalize known activity types', () => {
      expect(normalizeActivityTypeToSport('Cycling')).toBe('cycling');
      expect(normalizeActivityTypeToSport('Running')).toBe('running');
      expect(normalizeActivityTypeToSport('Swimming')).toBe('swimming');
      expect(normalizeActivityTypeToSport('Skiing')).toBe('skiing');
      expect(normalizeActivityTypeToSport('Hiking')).toBe('hiking');
      expect(normalizeActivityTypeToSport('Rowing')).toBe('rowing');
      expect(normalizeActivityTypeToSport('Strength')).toBe('strength');
    });

    it('should return other for unknown activity types', () => {
      expect(normalizeActivityTypeToSport('Yoga')).toBe('other');
      expect(normalizeActivityTypeToSport('Unknown')).toBe('other');
    });
  });

  describe('sportToActivityType', () => {
    it('should convert known sports to ActivityType', () => {
      expect(sportToActivityType('cycling')).toBe('Cycling');
      expect(sportToActivityType('running')).toBe('Running');
      expect(sportToActivityType('swimming')).toBe('Swimming');
      expect(sportToActivityType('skiing')).toBe('Skiing');
      expect(sportToActivityType('hiking')).toBe('Hiking');
      expect(sportToActivityType('rowing')).toBe('Rowing');
      expect(sportToActivityType('strength')).toBe('Strength');
    });

    it('should return undefined for unknown sports', () => {
      expect(sportToActivityType('yoga')).toBeUndefined();
      expect(sportToActivityType('other')).toBeUndefined();
    });
  });

  describe('fetchAndMergePlannedWorkouts', () => {
    let mockIntervals: IntervalsClient;
    let mockTrainerRoad: TrainerRoadClient;

    const trWorkouts: PlannedWorkout[] = [
      {
        id: 'tr-1',
        scheduled_for: '2024-12-15T09:00:00Z',
        name: 'Sweet Spot Base',
        expected_tss: 88,
        source: 'trainerroad',
      },
    ];

    const icuWorkouts: PlannedWorkout[] = [
      {
        id: 'int-1',
        scheduled_for: '2024-12-15T17:00:00Z',
        name: 'Easy Run',
        expected_tss: 35,
        source: 'intervals.icu',
      },
    ];

    beforeEach(() => {
      vi.clearAllMocks();
      mockIntervals = new IntervalsClient({ apiKey: 'test', athleteId: 'test' });
      mockTrainerRoad = new TrainerRoadClient({ calendarUrl: 'https://test.com' });
    });

    it('should merge workouts from both sources', async () => {
      vi.mocked(mockTrainerRoad.getPlannedWorkouts).mockResolvedValue(trWorkouts);
      vi.mocked(mockIntervals.getPlannedEvents).mockResolvedValue(icuWorkouts);

      const result = await fetchAndMergePlannedWorkouts(
        mockIntervals, mockTrainerRoad, '2024-12-15', '2024-12-15', 'UTC'
      );

      expect(result).toHaveLength(2);
    });

    it('should handle null TrainerRoad client', async () => {
      vi.mocked(mockIntervals.getPlannedEvents).mockResolvedValue(icuWorkouts);

      const result = await fetchAndMergePlannedWorkouts(
        mockIntervals, null, '2024-12-15', '2024-12-15', 'UTC'
      );

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('intervals.icu');
    });

    it('should handle TrainerRoad fetch error gracefully', async () => {
      vi.mocked(mockTrainerRoad.getPlannedWorkouts).mockRejectedValue(new Error('Failed'));
      vi.mocked(mockIntervals.getPlannedEvents).mockResolvedValue(icuWorkouts);

      const result = await fetchAndMergePlannedWorkouts(
        mockIntervals, mockTrainerRoad, '2024-12-15', '2024-12-15', 'UTC'
      );

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('intervals.icu');
    });

    it('should handle Intervals.icu fetch error gracefully', async () => {
      vi.mocked(mockTrainerRoad.getPlannedWorkouts).mockResolvedValue(trWorkouts);
      vi.mocked(mockIntervals.getPlannedEvents).mockRejectedValue(new Error('Failed'));

      const result = await fetchAndMergePlannedWorkouts(
        mockIntervals, mockTrainerRoad, '2024-12-15', '2024-12-15', 'UTC'
      );

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('trainerroad');
    });

    it('should deduplicate similar workouts', async () => {
      const duplicateIcu: PlannedWorkout[] = [
        {
          id: 'int-dup',
          scheduled_for: '2024-12-15T09:00:00Z',
          name: 'Sweet Spot Base',
          expected_tss: 88,
          source: 'intervals.icu',
        },
      ];

      vi.mocked(mockTrainerRoad.getPlannedWorkouts).mockResolvedValue(trWorkouts);
      vi.mocked(mockIntervals.getPlannedEvents).mockResolvedValue(duplicateIcu);

      const result = await fetchAndMergePlannedWorkouts(
        mockIntervals, mockTrainerRoad, '2024-12-15', '2024-12-15', 'UTC'
      );

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('trainerroad');
    });
  });
});
