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

    tools = new PlanningTools(mockIntervalsClient, mockTrainerRoadClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getUpcomingWorkouts', () => {
    const trainerroadWorkouts: PlannedWorkout[] = [
      {
        id: 'tr-1',
        date: '2024-12-16T09:00:00Z',
        name: 'Sweet Spot Base',
        expected_tss: 88,
        source: 'trainerroad',
      },
      {
        id: 'tr-2',
        date: '2024-12-18T09:00:00Z',
        name: 'VO2max Intervals',
        expected_tss: 75,
        source: 'trainerroad',
      },
    ];

    const intervalsWorkouts: PlannedWorkout[] = [
      {
        id: 'int-1',
        date: '2024-12-17T17:00:00Z',
        name: 'Easy Run',
        expected_tss: 35,
        source: 'intervals.icu',
      },
      {
        id: 'int-2',
        date: '2024-12-19T08:00:00Z',
        name: 'Long Ride',
        expected_tss: 120,
        source: 'intervals.icu',
      },
    ];

    it('should return merged workouts from both sources', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trainerroadWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getUpcomingWorkouts({ days: 7 });

      expect(result).toHaveLength(4);
    });

    it('should sort workouts by date', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trainerroadWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getUpcomingWorkouts({ days: 7 });

      const dates = result.map((w) => new Date(w.date).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
      }
    });

    it('should deduplicate similar workouts', async () => {
      const duplicateWorkout: PlannedWorkout = {
        id: 'int-dup',
        date: '2024-12-16T09:00:00Z',
        name: 'Sweet Spot Base',
        expected_tss: 88,
        source: 'intervals.icu',
      };

      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trainerroadWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([duplicateWorkout]);

      const result = await tools.getUpcomingWorkouts({ days: 7 });

      expect(result).toHaveLength(2); // Only TR workouts, duplicate removed
      expect(result.find((w) => w.source === 'intervals.icu')).toBeUndefined();
    });

    it('should handle TrainerRoad client not configured', async () => {
      const toolsWithoutTr = new PlanningTools(mockIntervalsClient, null);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await toolsWithoutTr.getUpcomingWorkouts({ days: 7 });

      expect(result).toHaveLength(2);
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockRejectedValue(new Error('Failed'));
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getUpcomingWorkouts({ days: 7 });

      expect(result).toHaveLength(2);
    });

    it('should use correct date range', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      await tools.getUpcomingWorkouts({ days: 7 });

      expect(mockIntervalsClient.getPlannedEvents).toHaveBeenCalledWith(
        '2024-12-15',
        '2024-12-22'
      );
    });
  });

  describe('getPlannedWorkoutDetails', () => {
    const trBikeWorkout: PlannedWorkout = {
      id: 'tr-1',
      date: '2024-12-16T09:00:00Z',
      name: 'Sweet Spot Base',
      description: 'Hard intervals',
      expected_tss: 88,
      expected_if: 0.88,
      discipline: 'Bike',
      source: 'trainerroad',
    };

    const intRunWorkout: PlannedWorkout = {
      id: 'int-1',
      date: '2024-12-16T17:00:00Z',
      name: 'Easy Run',
      expected_tss: 35,
      discipline: 'Run',
      source: 'intervals.icu',
    };

    it('should return all merged workouts for a date', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([trBikeWorkout]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([intRunWorkout]);

      const result = await tools.getPlannedWorkoutDetails({ date: '2024-12-16' });

      expect(result).toHaveLength(2);
      expect(result.find((w) => w.discipline === 'Bike')).toBeDefined();
      expect(result.find((w) => w.discipline === 'Run')).toBeDefined();
    });

    it('should filter by sport when specified', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([trBikeWorkout]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([intRunWorkout]);

      const bikeResult = await tools.getPlannedWorkoutDetails({ date: '2024-12-16', sport: 'cycling' });
      expect(bikeResult).toHaveLength(1);
      expect(bikeResult[0].discipline).toBe('Bike');

      const runResult = await tools.getPlannedWorkoutDetails({ date: '2024-12-16', sport: 'running' });
      expect(runResult).toHaveLength(1);
      expect(runResult[0].discipline).toBe('Run');
    });

    it('should return empty array when no workouts match', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getPlannedWorkoutDetails({ date: '2024-12-16' });

      expect(result).toEqual([]);
    });

    it('should return empty array when sport filter has no match', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([trBikeWorkout]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getPlannedWorkoutDetails({ date: '2024-12-16', sport: 'swimming' });

      expect(result).toEqual([]);
    });

    it('should parse natural language date', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      await tools.getPlannedWorkoutDetails({ date: 'tomorrow' });

      expect(mockTrainerRoadClient.getPlannedWorkouts).toHaveBeenCalledWith('2024-12-16', '2024-12-16');
      expect(mockIntervalsClient.getPlannedEvents).toHaveBeenCalledWith('2024-12-16', '2024-12-16');
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockRejectedValue(new Error('Failed'));
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([intRunWorkout]);

      const result = await tools.getPlannedWorkoutDetails({ date: '2024-12-16' });

      expect(result).toHaveLength(1);
      expect(result[0].discipline).toBe('Run');
    });
  });
});
