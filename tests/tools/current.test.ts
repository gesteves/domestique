import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CurrentTools } from '../../src/tools/current.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { WhoopClient } from '../../src/clients/whoop.js';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';
import type { RecoveryData, StrainData, PlannedWorkout, NormalizedWorkout } from '../../src/types/index.js';

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

  describe('getTodaysStrain', () => {
    const mockStrain: StrainData = {
      date: '2024-12-15',
      strain_score: 15.5,
      average_heart_rate: 75,
      max_heart_rate: 185,
      calories: 2500,
      activities: [],
    };

    it('should return strain data from Whoop', async () => {
      vi.mocked(mockWhoopClient.getStrainData).mockResolvedValue([mockStrain]);

      const result = await tools.getTodaysStrain();

      expect(result).toEqual(mockStrain);
    });

    it('should return null when no strain data for today', async () => {
      vi.mocked(mockWhoopClient.getStrainData).mockResolvedValue([]);

      const result = await tools.getTodaysStrain();

      expect(result).toBeNull();
    });

    it('should return null when Whoop client is not configured', async () => {
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);

      const result = await toolsWithoutWhoop.getTodaysStrain();

      expect(result).toBeNull();
    });
  });

  describe('getTodaysCompletedWorkouts', () => {
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
    ];

    it('should return completed workouts from Intervals.icu', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);

      const result = await tools.getTodaysCompletedWorkouts();

      expect(result).toEqual(mockWorkouts);
      expect(mockIntervalsClient.getActivities).toHaveBeenCalled();
    });

    it('should return empty array when no workouts today', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);

      const result = await tools.getTodaysCompletedWorkouts();

      expect(result).toEqual([]);
    });
  });

  describe('getStrainHistory', () => {
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

    it('should return strain data from Whoop for date range', async () => {
      vi.mocked(mockWhoopClient.getStrainData).mockResolvedValue(mockStrain);

      const result = await tools.getStrainHistory({
        start_date: '2024-12-01',
        end_date: '2024-12-15',
      });

      expect(result).toEqual(mockStrain);
      expect(mockWhoopClient.getStrainData).toHaveBeenCalledWith('2024-12-01', '2024-12-15');
    });

    it('should default end_date to today', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));

      vi.mocked(mockWhoopClient.getStrainData).mockResolvedValue(mockStrain);

      await tools.getStrainHistory({ start_date: '2024-12-01' });

      expect(mockWhoopClient.getStrainData).toHaveBeenCalledWith('2024-12-01', '2024-12-15');

      vi.useRealTimers();
    });

    it('should return empty array when Whoop client is not configured', async () => {
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);

      const result = await toolsWithoutWhoop.getStrainHistory({
        start_date: '2024-12-01',
        end_date: '2024-12-15',
      });

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

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(trainerroadWorkouts[0]);
      expect(result).toContainEqual(intervalsWorkouts[0]);
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
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('trainerroad');
    });

    it('should handle TrainerRoad client not configured', async () => {
      const toolsWithoutTr = new CurrentTools(mockIntervalsClient, mockWhoopClient, null);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await toolsWithoutTr.getTodaysPlannedWorkouts();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(intervalsWorkouts[0]);
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockRejectedValue(new Error('Failed'));
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getTodaysPlannedWorkouts();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(intervalsWorkouts[0]);
    });
  });
});
