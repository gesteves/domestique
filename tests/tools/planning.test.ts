import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlanningTools } from '../../src/tools/planning.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';
import type { PlannedWorkout } from '../../src/types/index.js';

vi.mock('../../src/clients/intervals.js');
vi.mock('../../src/clients/trainerroad.js');

describe('PlanningTools', () => {
  let tools: PlanningTools;
  let mockIntervalsClient: IntervalsClient;
  let mockTrainerRoadClient: TrainerRoadClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));

    mockIntervalsClient = new IntervalsClient({ apiKey: 'test', athleteId: 'test' });
    mockTrainerRoadClient = new TrainerRoadClient({ calendarUrl: 'https://test.com' });

    // Mock getAthleteTimezone to return UTC
    vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');

    tools = new PlanningTools(mockIntervalsClient, mockTrainerRoadClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getUpcomingWorkouts', () => {
    const trainerroadWorkouts: PlannedWorkout[] = [
      {
        id: 'tr-1',
        scheduled_for: '2024-12-16T09:00:00Z',
        name: 'Sweet Spot Base',
        expected_tss: 88,
        source: 'trainerroad',
      },
      {
        id: 'tr-2',
        scheduled_for: '2024-12-18T09:00:00Z',
        name: 'VO2max Intervals',
        expected_tss: 75,
        source: 'trainerroad',
      },
    ];

    const intervalsWorkouts: PlannedWorkout[] = [
      {
        id: 'int-1',
        scheduled_for: '2024-12-17T17:00:00Z',
        name: 'Easy Run',
        expected_tss: 35,
        source: 'intervals.icu',
      },
      {
        id: 'int-2',
        scheduled_for: '2024-12-19T08:00:00Z',
        name: 'Long Ride',
        expected_tss: 120,
        source: 'intervals.icu',
      },
    ];

    it('should return merged workouts from both sources', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trainerroadWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getUpcomingWorkouts({ oldest: '2024-12-15' });

      expect(result.workouts).toHaveLength(4);
    });

    it('should sort workouts by date', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trainerroadWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getUpcomingWorkouts({ oldest: '2024-12-15' });

      const dates = result.workouts.map((w) => new Date(w.scheduled_for).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
      }
    });

    it('should deduplicate similar workouts', async () => {
      const duplicateWorkout: PlannedWorkout = {
        id: 'int-dup',
        scheduled_for: '2024-12-16T09:00:00Z',
        name: 'Sweet Spot Base',
        expected_tss: 88,
        source: 'intervals.icu',
      };

      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trainerroadWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([duplicateWorkout]);

      const result = await tools.getUpcomingWorkouts({ oldest: '2024-12-15' });

      expect(result.workouts).toHaveLength(2); // Only TR workouts, duplicate removed
      expect(result.workouts.find((w) => w.source === 'intervals.icu')).toBeUndefined();
    });

    it('should handle TrainerRoad client not configured', async () => {
      const toolsWithoutTr = new PlanningTools(mockIntervalsClient, null);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await toolsWithoutTr.getUpcomingWorkouts({ oldest: '2024-12-15' });

      expect(result.workouts).toHaveLength(2);
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockRejectedValue(new Error('Failed'));
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getUpcomingWorkouts({ oldest: '2024-12-15' });

      expect(result.workouts).toHaveLength(2);
    });

    it('should use correct date range with oldest only (defaults to 7 days)', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      await tools.getUpcomingWorkouts({ oldest: '2024-12-15' });

      expect(mockIntervalsClient.getPlannedEvents).toHaveBeenCalledWith(
        '2024-12-15',
        '2024-12-22'
      );
    });

    it('should use correct date range with both oldest and newest', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      await tools.getUpcomingWorkouts({ oldest: '2024-12-15', newest: '2024-12-31' });

      expect(mockIntervalsClient.getPlannedEvents).toHaveBeenCalledWith(
        '2024-12-15',
        '2024-12-31'
      );
    });

    it('should parse natural language dates', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      await tools.getUpcomingWorkouts({ oldest: 'today', newest: 'next week' });

      // System time is set to 2024-12-15, "next week" should resolve to 2024-12-22
      expect(mockIntervalsClient.getPlannedEvents).toHaveBeenCalledWith(
        '2024-12-15',
        '2024-12-22'
      );
    });

    it('should default oldest to today when not provided', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      await tools.getUpcomingWorkouts({});

      // System time is set to 2024-12-15, should default to today + 7 days
      expect(mockIntervalsClient.getPlannedEvents).toHaveBeenCalledWith(
        '2024-12-15',
        '2024-12-22'
      );
    });

    it('should filter by sport when specified', async () => {
      const bikeWorkout: PlannedWorkout = {
        id: 'tr-1',
        scheduled_for: '2024-12-16T09:00:00Z',
        name: 'Sweet Spot Base',
        expected_tss: 88,
        sport: 'Cycling',
        source: 'trainerroad',
      };

      const runWorkout: PlannedWorkout = {
        id: 'int-1',
        scheduled_for: '2024-12-17T17:00:00Z',
        name: 'Easy Run',
        expected_tss: 35,
        sport: 'Running',
        source: 'intervals.icu',
      };

      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([bikeWorkout]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([runWorkout]);

      const cyclingResult = await tools.getUpcomingWorkouts({ oldest: '2024-12-15', sport: 'cycling' });
      expect(cyclingResult.workouts).toHaveLength(1);
      expect(cyclingResult.workouts[0].sport).toBe('Cycling');

      const runningResult = await tools.getUpcomingWorkouts({ oldest: '2024-12-15', sport: 'running' });
      expect(runningResult.workouts).toHaveLength(1);
      expect(runningResult.workouts[0].sport).toBe('Running');
    });

    it('should return empty array when sport filter has no match', async () => {
      const bikeWorkout: PlannedWorkout = {
        id: 'tr-1',
        scheduled_for: '2024-12-16T09:00:00Z',
        name: 'Sweet Spot Base',
        expected_tss: 88,
        sport: 'Cycling',
        source: 'trainerroad',
      };

      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([bikeWorkout]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getUpcomingWorkouts({ oldest: '2024-12-15', sport: 'swimming' });

      expect(result.workouts).toEqual([]);
    });
  });

  describe('setWorkoutIntervals', () => {
    it('should set intervals on activity successfully', async () => {
      vi.mocked(mockIntervalsClient.updateActivityIntervals).mockResolvedValue(undefined);

      const result = await tools.setWorkoutIntervals({
        activity_id: 'i12345_activity123',
        intervals: [
          { start_time: 0, end_time: 300, type: 'RECOVERY', label: 'Warmup' },
          { start_time: 300, end_time: 600, type: 'WORK', label: 'Interval 1' },
          { start_time: 600, end_time: 660, type: 'RECOVERY', label: 'Recovery 1' },
        ],
      });

      expect(result.activity_id).toBe('i12345_activity123');
      expect(result.intervals_set).toBe(3);
      expect(result.intervals_icu_url).toBe('https://intervals.icu/activities/i12345_activity123');

      expect(mockIntervalsClient.updateActivityIntervals).toHaveBeenCalledWith(
        'i12345_activity123',
        [
          { start_time: 0, end_time: 300, type: 'RECOVERY', label: 'Warmup' },
          { start_time: 300, end_time: 600, type: 'WORK', label: 'Interval 1' },
          { start_time: 600, end_time: 660, type: 'RECOVERY', label: 'Recovery 1' },
        ],
        true
      );
    });

    it('should pass replace_existing_intervals=false to client when specified', async () => {
      vi.mocked(mockIntervalsClient.updateActivityIntervals).mockResolvedValue(undefined);

      await tools.setWorkoutIntervals({
        activity_id: 'activity123',
        intervals: [{ start_time: 0, end_time: 300, type: 'WORK' }],
        replace_existing_intervals: false,
      });

      expect(mockIntervalsClient.updateActivityIntervals).toHaveBeenCalledWith(
        'activity123',
        [{ start_time: 0, end_time: 300, type: 'WORK' }],
        false
      );
    });

    it('should pass replace_existing_intervals=true to client when explicitly specified', async () => {
      vi.mocked(mockIntervalsClient.updateActivityIntervals).mockResolvedValue(undefined);

      await tools.setWorkoutIntervals({
        activity_id: 'activity123',
        intervals: [{ start_time: 0, end_time: 300, type: 'WORK' }],
        replace_existing_intervals: true,
      });

      expect(mockIntervalsClient.updateActivityIntervals).toHaveBeenCalledWith(
        'activity123',
        [{ start_time: 0, end_time: 300, type: 'WORK' }],
        true
      );
    });

    it('should set intervals without labels', async () => {
      vi.mocked(mockIntervalsClient.updateActivityIntervals).mockResolvedValue(undefined);

      const result = await tools.setWorkoutIntervals({
        activity_id: 'activity456',
        intervals: [
          { start_time: 0, end_time: 300, type: 'WORK' },
          { start_time: 300, end_time: 360, type: 'RECOVERY' },
        ],
      });

      expect(result.intervals_set).toBe(2);
    });

    it('should throw error when intervals array is empty', async () => {
      await expect(
        tools.setWorkoutIntervals({
          activity_id: 'activity123',
          intervals: [],
        })
      ).rejects.toThrow('At least one interval is required');
    });

    it('should throw error for negative start_time', async () => {
      await expect(
        tools.setWorkoutIntervals({
          activity_id: 'activity123',
          intervals: [{ start_time: -1, end_time: 300, type: 'WORK' }],
        })
      ).rejects.toThrow('Interval 1: start_time must be a non-negative number');
    });

    it('should throw error when end_time is not greater than start_time', async () => {
      await expect(
        tools.setWorkoutIntervals({
          activity_id: 'activity123',
          intervals: [{ start_time: 300, end_time: 300, type: 'WORK' }],
        })
      ).rejects.toThrow('Interval 1: end_time must be greater than start_time');
    });

    it('should throw error when end_time is less than start_time', async () => {
      await expect(
        tools.setWorkoutIntervals({
          activity_id: 'activity123',
          intervals: [{ start_time: 300, end_time: 200, type: 'WORK' }],
        })
      ).rejects.toThrow('Interval 1: end_time must be greater than start_time');
    });

    it('should throw error for invalid interval type', async () => {
      await expect(
        tools.setWorkoutIntervals({
          activity_id: 'activity123',
          intervals: [{ start_time: 0, end_time: 300, type: 'INVALID' as 'WORK' }],
        })
      ).rejects.toThrow("Interval 1: type must be 'WORK' or 'RECOVERY'");
    });

    it('should validate all intervals and report first error', async () => {
      await expect(
        tools.setWorkoutIntervals({
          activity_id: 'activity123',
          intervals: [
            { start_time: 0, end_time: 300, type: 'WORK' }, // valid
            { start_time: 300, end_time: 200, type: 'RECOVERY' }, // invalid
            { start_time: -1, end_time: 100, type: 'WORK' }, // also invalid but checked second
          ],
        })
      ).rejects.toThrow('Interval 2: end_time must be greater than start_time');
    });

    it('should propagate API errors', async () => {
      vi.mocked(mockIntervalsClient.updateActivityIntervals).mockRejectedValue(
        new Error('Activity not found')
      );

      await expect(
        tools.setWorkoutIntervals({
          activity_id: 'nonexistent',
          intervals: [{ start_time: 0, end_time: 300, type: 'WORK' }],
        })
      ).rejects.toThrow('Activity not found');
    });
  });
});
