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

      expect(result).toHaveLength(4);
    });

    it('should sort workouts by date', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trainerroadWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getUpcomingWorkouts({ oldest: '2024-12-15' });

      const dates = result.map((w) => new Date(w.scheduled_for).getTime());
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

      expect(result).toHaveLength(2); // Only TR workouts, duplicate removed
      expect(result.find((w) => w.source === 'intervals.icu')).toBeUndefined();
    });

    it('should handle TrainerRoad client not configured', async () => {
      const toolsWithoutTr = new PlanningTools(mockIntervalsClient, null);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await toolsWithoutTr.getUpcomingWorkouts({ oldest: '2024-12-15' });

      expect(result).toHaveLength(2);
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockRejectedValue(new Error('Failed'));
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getUpcomingWorkouts({ oldest: '2024-12-15' });

      expect(result).toHaveLength(2);
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
      expect(cyclingResult).toHaveLength(1);
      expect(cyclingResult[0].sport).toBe('Cycling');

      const runningResult = await tools.getUpcomingWorkouts({ oldest: '2024-12-15', sport: 'running' });
      expect(runningResult).toHaveLength(1);
      expect(runningResult[0].sport).toBe('Running');
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

      expect(result).toEqual([]);
    });
  });
});
