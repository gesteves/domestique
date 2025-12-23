import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CurrentTools } from '../../src/tools/current.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { WhoopClient } from '../../src/clients/whoop.js';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';
import type { NormalizedWorkout, RecoveryData, StrainData, PlannedWorkout, WorkoutWithWhoop, StrainActivity } from '../../src/types/index.js';

// Mock the clients
vi.mock('../../src/clients/intervals.js');
vi.mock('../../src/clients/whoop.js');
vi.mock('../../src/clients/trainerroad.js');

describe('CurrentTools', () => {
  let tools: CurrentTools;
  let mockIntervalsClient: IntervalsClient;
  let mockWhoopClient: WhoopClient;
  let mockTrainerRoadClient: TrainerRoadClient;

  beforeEach(() => {
    vi.clearAllMocks();

    mockIntervalsClient = new IntervalsClient({ apiKey: 'test', athleteId: 'test' });
    mockWhoopClient = new WhoopClient({
      accessToken: 'test',
      refreshToken: 'test',
      clientId: 'test',
      clientSecret: 'test',
    });
    mockTrainerRoadClient = new TrainerRoadClient({ calendarUrl: 'https://test.com' });

    tools = new CurrentTools(mockIntervalsClient, mockWhoopClient, mockTrainerRoadClient);
  });

  describe('getTodaysRecovery', () => {
    it('should return recovery data from Whoop', async () => {
      const mockRecovery: RecoveryData = {
        date: '2024-12-15',
        recovery_score: 85,
        hrv_rmssd: 65,
        resting_heart_rate: 52,
        sleep_performance_percentage: 90,
        sleep_duration_hours: 7.5,
      };

      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue(mockRecovery);

      const result = await tools.getTodaysRecovery();

      expect(result).toEqual(mockRecovery);
      expect(mockWhoopClient.getTodayRecovery).toHaveBeenCalled();
    });

    it('should return null when Whoop client is not configured', async () => {
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);

      const result = await toolsWithoutWhoop.getTodaysRecovery();

      expect(result).toBeNull();
    });

    it('should propagate errors from Whoop client', async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockRejectedValue(new Error('API Error'));

      await expect(tools.getTodaysRecovery()).rejects.toThrow('API Error');
    });
  });

  describe('getRecentWorkouts', () => {
    const mockWorkouts: NormalizedWorkout[] = [
      {
        id: '1',
        date: '2024-12-15T10:00:00Z',
        activity_type: 'Cycling',
        duration_seconds: 3600,
        distance_km: 45,
        tss: 85,
        source: 'intervals.icu',
      },
      {
        id: '2',
        date: '2024-12-14T08:00:00Z',
        activity_type: 'Running',
        duration_seconds: 2400,
        distance_km: 8,
        tss: 45,
        source: 'intervals.icu',
      },
    ];

    it('should return workouts for specified days', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);

      const result = await tools.getRecentWorkouts({ days: 7 });

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[0].whoop).toBeNull(); // No matching Whoop activity
      expect(mockIntervalsClient.getActivities).toHaveBeenCalled();
    });

    it('should pass sport filter to client', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([mockWorkouts[0]]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);

      const result = await tools.getRecentWorkouts({ days: 7, sport: 'cycling' });

      expect(result).toHaveLength(1);
      expect(mockIntervalsClient.getActivities).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'cycling'
      );
    });

    it('should use default days when not specified', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);

      await tools.getRecentWorkouts({ days: 7 });

      // Verify the date range is approximately 7 days
      const [start, end] = vi.mocked(mockIntervalsClient.getActivities).mock.calls[0];
      const startDate = new Date(start);
      const endDate = new Date(end);
      const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeCloseTo(7, 0);
    });

    it('should match and include Whoop data when activity matches', async () => {
      const whoopActivities: StrainActivity[] = [
        {
          id: 'whoop-1',
          activity_type: 'Cycling',
          start_time: '2024-12-15T10:00:00Z', // Same time as workout 1
          end_time: '2024-12-15T11:00:00Z',
          strain_score: 14.5,
          average_heart_rate: 145,
          max_heart_rate: 175,
          calories: 650,
        },
      ];

      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue(whoopActivities);

      const result = await tools.getRecentWorkouts({ days: 7 });

      expect(result[0].whoop).not.toBeNull();
      expect(result[0].whoop?.strain_score).toBe(14.5);
      expect(result[0].whoop?.match_confidence).toBe('high');
      expect(result[1].whoop).toBeNull(); // No matching Whoop activity for running
    });

    it('should return workouts without Whoop data when Whoop is not configured', async () => {
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);

      const result = await toolsWithoutWhoop.getRecentWorkouts({ days: 7 });

      expect(result).toHaveLength(2);
      expect(result[0].whoop).toBeNull();
      expect(result[1].whoop).toBeNull();
    });
  });

  describe('getRecentStrain', () => {
    const mockStrain: StrainData[] = [
      {
        date: '2024-12-15',
        strain_score: 15.5,
        average_heart_rate: 75,
        max_heart_rate: 185,
        calories: 2500,
        activities: [],
      },
    ];

    it('should return strain data from Whoop', async () => {
      vi.mocked(mockWhoopClient.getStrainData).mockResolvedValue(mockStrain);

      const result = await tools.getRecentStrain({ days: 7 });

      expect(result).toEqual(mockStrain);
    });

    it('should return empty array when Whoop client is not configured', async () => {
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);

      const result = await toolsWithoutWhoop.getRecentStrain({ days: 7 });

      expect(result).toEqual([]);
    });
  });

  describe('getTodaysPlannedWorkouts', () => {
    const trainerroadWorkouts: PlannedWorkout[] = [
      {
        id: 'tr-1',
        date: '2024-12-15T09:00:00Z',
        name: 'Sweet Spot Base',
        expected_tss: 88,
        source: 'trainerroad',
      },
    ];

    const intervalsWorkouts: PlannedWorkout[] = [
      {
        id: 'int-1',
        date: '2024-12-15T17:00:00Z',
        name: 'Easy Run',
        expected_tss: 35,
        source: 'intervals.icu',
      },
    ];

    it('should return workouts from both sources', async () => {
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue(trainerroadWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getTodaysPlannedWorkouts();

      expect(result.trainerroad).toEqual(trainerroadWorkouts);
      expect(result.intervals).toEqual(intervalsWorkouts);
      expect(result.merged).toHaveLength(2);
    });

    it('should deduplicate similar workouts', async () => {
      const duplicateWorkout: PlannedWorkout = {
        id: 'int-1',
        date: '2024-12-15T09:00:00Z',
        name: 'Sweet Spot Base', // Same name
        expected_tss: 88, // Same TSS
        source: 'intervals.icu',
      };

      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue(trainerroadWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([duplicateWorkout]);

      const result = await tools.getTodaysPlannedWorkouts();

      // Should only have TrainerRoad version (preferred)
      expect(result.merged).toHaveLength(1);
      expect(result.merged[0].source).toBe('trainerroad');
    });

    it('should handle TrainerRoad client not configured', async () => {
      const toolsWithoutTr = new CurrentTools(mockIntervalsClient, mockWhoopClient, null);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await toolsWithoutTr.getTodaysPlannedWorkouts();

      expect(result.trainerroad).toEqual([]);
      expect(result.intervals).toEqual(intervalsWorkouts);
      expect(result.merged).toHaveLength(1);
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockRejectedValue(new Error('Failed'));
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getTodaysPlannedWorkouts();

      expect(result.trainerroad).toEqual([]);
      expect(result.intervals).toEqual(intervalsWorkouts);
    });
  });
});
