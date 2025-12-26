import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CurrentTools } from '../../src/tools/current.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { WhoopClient } from '../../src/clients/whoop.js';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';
import type { RecoveryData, StrainData, PlannedWorkout, NormalizedWorkout, StrainActivity, FitnessMetrics, WellnessData } from '../../src/types/index.js';

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
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(mockStrain);

      const result = await tools.getTodaysStrain();

      expect(result).toEqual(mockStrain);
      expect(mockWhoopClient.getTodayStrain).toHaveBeenCalled();
    });

    it('should return null when no strain data for today', async () => {
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);

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
        start_date_utc: '2024-12-15T10:00:00Z',
        activity_type: 'Cycling',
        duration_seconds: 3600,
        distance_km: 45,
        tss: 85,
        source: 'intervals.icu',
      },
    ];

    const mockWhoopActivities: StrainActivity[] = [
      {
        id: 'whoop-1',
        start_time: '2024-12-15T10:01:00Z',
        end_time: '2024-12-15T11:00:00Z',
        activity_type: 'Cycling',
        strain_score: 12.5,
        average_heart_rate: 145,
        max_heart_rate: 175,
        calories: 650,
      },
    ];

    it('should return completed workouts from Intervals.icu with matched Whoop data', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue(mockWhoopActivities);

      const result = await tools.getTodaysCompletedWorkouts();

      expect(result).toHaveLength(1);
      expect(result[0].whoop).not.toBeNull();
      expect(result[0].whoop?.strain_score).toBe(12.5);
      expect(mockIntervalsClient.getActivities).toHaveBeenCalled();
    });

    it('should return empty array when no workouts today', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);

      const result = await tools.getTodaysCompletedWorkouts();

      expect(result).toEqual([]);
    });

    it('should return workouts without Whoop data when no Whoop client configured', async () => {
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);

      const result = await toolsWithoutWhoop.getTodaysCompletedWorkouts();

      expect(result).toHaveLength(1);
      expect(result[0].whoop).toBeNull();
    });

    it('should return workouts with null Whoop when no Whoop match found', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);

      const result = await tools.getTodaysCompletedWorkouts();

      expect(result).toHaveLength(1);
      expect(result[0].whoop).toBeNull();
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
      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');
      vi.mocked(mockWhoopClient.getStrainData).mockResolvedValue(mockStrain);

      const result = await tools.getStrainHistory({
        start_date: '2024-12-01',
        end_date: '2024-12-15',
      });

      expect(result).toEqual(mockStrain);
      expect(mockWhoopClient.getStrainData).toHaveBeenCalledWith('2024-12-01', '2024-12-15');
    });

    it('should default end_date to today using athlete timezone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));

      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');
      vi.mocked(mockWhoopClient.getStrainData).mockResolvedValue(mockStrain);

      await tools.getStrainHistory({ start_date: '2024-12-01' });

      expect(mockWhoopClient.getStrainData).toHaveBeenCalledWith('2024-12-01', '2024-12-15');

      vi.useRealTimers();
    });

    it('should parse relative dates using athlete timezone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));

      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('America/Denver');
      vi.mocked(mockWhoopClient.getStrainData).mockResolvedValue(mockStrain);

      await tools.getStrainHistory({ start_date: 'yesterday' });

      // Yesterday in America/Denver when it's 12:00 UTC on Dec 15
      // Denver is UTC-7, so local time is 05:00 on Dec 15, yesterday is Dec 14
      expect(mockWhoopClient.getStrainData).toHaveBeenCalledWith('2024-12-14', '2024-12-15');

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

  describe('getDailySummary', () => {
    const mockRecovery: RecoveryData = {
      date: '2024-12-15',
      recovery_score: 85,
      hrv_rmssd: 65,
      resting_heart_rate: 52,
      sleep_performance_percentage: 90,
      sleep_duration: '7:30:00',
      recovery_level: 'SUFFICIENT',
      recovery_level_description: 'Your recovery is sufficient',
      sleep_performance_level: 'OPTIMAL',
      sleep_performance_level_description: 'Your sleep performance is optimal',
    };

    const mockStrain: StrainData = {
      date: '2024-12-15',
      strain_score: 15.5,
      strain_level: 'HIGH',
      strain_level_description: 'High strain',
      average_heart_rate: 75,
      max_heart_rate: 185,
      calories: 2500,
      activities: [],
    };

    const mockFitness: FitnessMetrics = {
      date: '2024-12-15',
      ctl: 65,
      atl: 72,
      tsb: -7,
      ramp_rate: 4.5,
      ctl_load: 1.8,
      atl_load: 10.2,
    };

    const mockWellness: WellnessData = {
      weight: '74.5 kg',
    };

    const mockWorkouts: NormalizedWorkout[] = [
      {
        id: '1',
        date: '2024-12-15T10:00:00Z',
        start_date_utc: '2024-12-15T10:00:00Z',
        activity_type: 'Cycling',
        duration: '1:00:00',
        tss: 85,
        source: 'intervals.icu',
      },
    ];

    const mockPlannedWorkouts: PlannedWorkout[] = [
      {
        id: 'tr-1',
        date: '2024-12-15T09:00:00Z',
        name: 'Sweet Spot Base',
        expected_tss: 88,
        source: 'trainerroad',
      },
    ];

    beforeEach(() => {
      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');
    });

    it('should return complete daily summary with all data', async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue(mockRecovery);
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(mockStrain);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(mockFitness);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(mockWellness);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue(mockPlannedWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      expect(result.whoop.recovery).toEqual(mockRecovery);
      expect(result.whoop.strain).toEqual(mockStrain);
      expect(result.fitness).toEqual(mockFitness);
      expect(result.wellness).toEqual(mockWellness);
      expect(result.completed_workouts).toHaveLength(1);
      expect(result.planned_workouts).toHaveLength(1);
      expect(result.workouts_completed).toBe(1);
      expect(result.workouts_planned).toBe(1);
      expect(result.tss_completed).toBe(85);
      expect(result.tss_planned).toBe(88);
    });

    it('should include current_date with full datetime in user timezone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:30:45Z'));

      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('America/New_York');
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      // Should be ISO 8601 format with timezone offset
      // 10:30:45 UTC = 05:30:45 America/New_York (UTC-5)
      expect(result.current_date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
      expect(result.current_date).toBe('2024-12-15T05:30:45-05:00');

      vi.useRealTimers();
    });

    it('should include fitness metrics with ctl_load and atl_load', async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(mockFitness);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      expect(result.fitness).not.toBeNull();
      expect(result.fitness?.ctl).toBe(65);
      expect(result.fitness?.atl).toBe(72);
      expect(result.fitness?.tsb).toBe(-7);
      expect(result.fitness?.ctl_load).toBe(1.8);
      expect(result.fitness?.atl_load).toBe(10.2);
    });

    it('should handle null fitness when fetch fails', async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockRejectedValue(new Error('Failed'));
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      expect(result.fitness).toBeNull();
    });

    it('should handle missing Whoop client gracefully', async () => {
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(mockFitness);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(mockWellness);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await toolsWithoutWhoop.getDailySummary();

      expect(result.whoop.recovery).toBeNull();
      expect(result.whoop.strain).toBeNull();
      expect(result.fitness).toEqual(mockFitness);
      expect(result.wellness).toEqual(mockWellness);
    });

    it('should include wellness data with weight', async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(mockWellness);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      expect(result.wellness).not.toBeNull();
      expect(result.wellness?.weight).toBe('74.5 kg');
    });

    it('should handle null wellness when no data', async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      expect(result.wellness).toBeNull();
    });

    it('should handle wellness fetch failure gracefully', async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockRejectedValue(new Error('Failed'));
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      expect(result.wellness).toBeNull();
    });
  });
});
