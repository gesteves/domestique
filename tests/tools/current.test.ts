import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CurrentTools } from '../../src/tools/current.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { WhoopClient } from '../../src/clients/whoop.js';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';
import type { WhoopSleepData, WhoopRecoveryData, StrainData, PlannedWorkout, NormalizedWorkout, StrainActivity, FitnessMetrics, WellnessData, WhoopBodyMeasurements, Race } from '../../src/types/index.js';

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
    beforeEach(() => {
      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');
    });

    const mockSleep: WhoopSleepData = {
      sleep_summary: {
        total_in_bed_time: '8:00:00',
        total_awake_time: '0:30:00',
        total_no_data_time: '0:00:00',
        total_light_sleep_time: '3:30:00',
        total_slow_wave_sleep_time: '2:00:00',
        total_rem_sleep_time: '2:00:00',
        total_restorative_sleep: '4:00:00',
        sleep_cycle_count: 4,
        disturbance_count: 3,
      },
      sleep_needed: {
        total_sleep_needed: '7:30:00',
        baseline: '7:00:00',
        need_from_sleep_debt: '0:15:00',
        need_from_recent_strain: '0:15:00',
        need_from_recent_nap: '0:00:00',
      },
      sleep_performance_percentage: 90,
      sleep_performance_level: 'OPTIMAL',
      sleep_performance_level_description: 'Your sleep performance is optimal',
    };

    const mockRecovery: WhoopRecoveryData = {
      recovery_score: 85,
      hrv_rmssd: 65,
      resting_heart_rate: 52,
      recovery_level: 'SUFFICIENT',
      recovery_level_description: 'Your recovery is sufficient',
    };

    it('should return sleep and recovery data from Whoop with current_time', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:30:45Z'));

      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: mockSleep,
        recovery: mockRecovery,
      });

      const result = await tools.getTodaysRecovery();

      expect(result.whoop.sleep).toEqual(mockSleep);
      expect(result.whoop.recovery).toEqual(mockRecovery);
      expect(result.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
      expect(mockWhoopClient.getTodayRecovery).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should include current_time in user timezone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:30:45Z'));

      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('America/New_York');
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });

      const result = await tools.getTodaysRecovery();

      // 10:30:45 UTC = 05:30:45 America/New_York (UTC-5)
      expect(result.current_time).toBe('2024-12-15T05:30:45-05:00');
      expect(result.whoop.sleep).toBeNull();
      expect(result.whoop.recovery).toBeNull();

      vi.useRealTimers();
    });

    it('should return null sleep and recovery when Whoop client is not configured', async () => {
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);

      const result = await toolsWithoutWhoop.getTodaysRecovery();

      expect(result.whoop.sleep).toBeNull();
      expect(result.whoop.recovery).toBeNull();
      expect(result.current_time).toBeTruthy();
    });

    it('should propagate errors from Whoop client', async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockRejectedValue(new Error('API Error'));

      await expect(tools.getTodaysRecovery()).rejects.toThrow('API Error');
    });
  });

  describe('getTodaysStrain', () => {
    beforeEach(() => {
      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');
    });

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

    it('should return strain data from Whoop with current_time', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:30:45Z'));

      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(mockStrain);

      const result = await tools.getTodaysStrain();

      expect(result.whoop.strain).toEqual(mockStrain);
      expect(result.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
      expect(mockWhoopClient.getTodayStrain).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should include current_time in user timezone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:30:45Z'));

      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('America/Denver');
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);

      const result = await tools.getTodaysStrain();

      // 10:30:45 UTC = 03:30:45 America/Denver (UTC-7)
      expect(result.current_time).toBe('2024-12-15T03:30:45-07:00');
      expect(result.whoop.strain).toBeNull();

      vi.useRealTimers();
    });

    it('should return null strain when no strain data for today', async () => {
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);

      const result = await tools.getTodaysStrain();

      expect(result.whoop.strain).toBeNull();
      expect(result.current_time).toBeTruthy();
    });

    it('should return null strain when Whoop client is not configured', async () => {
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);

      const result = await toolsWithoutWhoop.getTodaysStrain();

      expect(result.whoop.strain).toBeNull();
      expect(result.current_time).toBeTruthy();
    });
  });

  describe('getTodaysCompletedWorkouts', () => {
    beforeEach(() => {
      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');
    });

    const mockWorkouts: NormalizedWorkout[] = [
      {
        id: '1',
        start_time: '2024-12-15T10:00:00+00:00',
        activity_type: 'Cycling',
        duration: '1:00:00',
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
        duration: '0:59:00',
        strain_score: 12.5,
        average_heart_rate: 145,
        max_heart_rate: 175,
        calories: 650,
      },
    ];

    it('should return completed workouts from Intervals.icu with matched Whoop data and current_time', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:30:45Z'));

      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue(mockWhoopActivities);

      const result = await tools.getTodaysCompletedWorkouts();

      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0].whoop).not.toBeNull();
      expect(result.workouts[0].whoop?.strain_score).toBe(12.5);
      expect(result.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
      expect(mockIntervalsClient.getActivities).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should include current_time in user timezone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:30:45Z'));

      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('Europe/London');
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);

      const result = await tools.getTodaysCompletedWorkouts();

      // 10:30:45 UTC = 10:30:45 Europe/London (UTC+0 in winter)
      expect(result.current_time).toBe('2024-12-15T10:30:45+00:00');
      expect(result.workouts).toEqual([]);

      vi.useRealTimers();
    });

    it('should return empty workouts array when no workouts today', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);

      const result = await tools.getTodaysCompletedWorkouts();

      expect(result.workouts).toEqual([]);
      expect(result.current_time).toBeTruthy();
    });

    it('should return workouts without Whoop data when no Whoop client configured', async () => {
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);

      const result = await toolsWithoutWhoop.getTodaysCompletedWorkouts();

      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0].whoop).toBeNull();
      expect(result.current_time).toBeTruthy();
    });

    it('should return workouts with null Whoop when no Whoop match found', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);

      const result = await tools.getTodaysCompletedWorkouts();

      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0].whoop).toBeNull();
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
        oldest: '2024-12-01',
        newest: '2024-12-15',
      });

      expect(result).toEqual(mockStrain);
      expect(mockWhoopClient.getStrainData).toHaveBeenCalledWith('2024-12-01', '2024-12-15');
    });

    it('should default newest to today using athlete timezone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));

      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');
      vi.mocked(mockWhoopClient.getStrainData).mockResolvedValue(mockStrain);

      await tools.getStrainHistory({ oldest: '2024-12-01' });

      expect(mockWhoopClient.getStrainData).toHaveBeenCalledWith('2024-12-01', '2024-12-15');

      vi.useRealTimers();
    });

    it('should parse relative dates using athlete timezone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));

      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('America/Denver');
      vi.mocked(mockWhoopClient.getStrainData).mockResolvedValue(mockStrain);

      await tools.getStrainHistory({ oldest: 'yesterday' });

      // Yesterday in America/Denver when it's 12:00 UTC on Dec 15
      // Denver is UTC-7, so local time is 05:00 on Dec 15, yesterday is Dec 14
      expect(mockWhoopClient.getStrainData).toHaveBeenCalledWith('2024-12-14', '2024-12-15');

      vi.useRealTimers();
    });

    it('should return empty array when Whoop client is not configured', async () => {
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);

      const result = await toolsWithoutWhoop.getStrainHistory({
        oldest: '2024-12-01',
        newest: '2024-12-15',
      });

      expect(result).toEqual([]);
    });
  });

  describe('getTodaysPlannedWorkouts', () => {
    beforeEach(() => {
      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');
    });

    const trainerroadWorkouts: PlannedWorkout[] = [
      {
        id: 'tr-1',
        scheduled_for: '2024-12-15T09:00:00Z',
        name: 'Sweet Spot Base',
        expected_tss: 88,
        source: 'trainerroad',
      },
    ];

    const intervalsWorkouts: PlannedWorkout[] = [
      {
        id: 'int-1',
        scheduled_for: '2024-12-15T17:00:00Z',
        name: 'Easy Run',
        expected_tss: 35,
        source: 'intervals.icu',
      },
    ];

    it('should return workouts from both sources with current_time', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:30:45Z'));

      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue(trainerroadWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getTodaysPlannedWorkouts();

      expect(result.workouts).toHaveLength(2);
      expect(result.workouts).toContainEqual(trainerroadWorkouts[0]);
      expect(result.workouts).toContainEqual(intervalsWorkouts[0]);
      expect(result.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);

      vi.useRealTimers();
    });

    it('should include current_time in user timezone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:30:45Z'));

      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('Asia/Tokyo');
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getTodaysPlannedWorkouts();

      // 10:30:45 UTC = 19:30:45 Asia/Tokyo (UTC+9)
      expect(result.current_time).toBe('2024-12-15T19:30:45+09:00');
      expect(result.workouts).toEqual([]);

      vi.useRealTimers();
    });

    it('should deduplicate similar workouts', async () => {
      const duplicateWorkout: PlannedWorkout = {
        id: 'int-1',
        scheduled_for: '2024-12-15T09:00:00Z',
        name: 'Sweet Spot Base', // Same name
        expected_tss: 88, // Same TSS
        source: 'intervals.icu',
      };

      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue(trainerroadWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([duplicateWorkout]);

      const result = await tools.getTodaysPlannedWorkouts();

      // Should only have TrainerRoad version (preferred)
      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0].source).toBe('trainerroad');
    });

    it('should handle TrainerRoad client not configured', async () => {
      const toolsWithoutTr = new CurrentTools(mockIntervalsClient, mockWhoopClient, null);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await toolsWithoutTr.getTodaysPlannedWorkouts();

      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0]).toEqual(intervalsWorkouts[0]);
      expect(result.current_time).toBeTruthy();
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockRejectedValue(new Error('Failed'));
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getTodaysPlannedWorkouts();

      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0]).toEqual(intervalsWorkouts[0]);
    });
  });

  describe('getDailySummary', () => {
    const mockSleep: WhoopSleepData = {
      sleep_summary: {
        total_in_bed_time: '8:00:00',
        total_awake_time: '0:30:00',
        total_no_data_time: '0:00:00',
        total_light_sleep_time: '3:30:00',
        total_slow_wave_sleep_time: '2:00:00',
        total_rem_sleep_time: '2:00:00',
        total_restorative_sleep: '4:00:00',
        sleep_cycle_count: 4,
        disturbance_count: 3,
      },
      sleep_needed: {
        total_sleep_needed: '7:30:00',
        baseline: '7:00:00',
        need_from_sleep_debt: '0:15:00',
        need_from_recent_strain: '0:15:00',
        need_from_recent_nap: '0:00:00',
      },
      sleep_performance_percentage: 90,
      sleep_performance_level: 'OPTIMAL',
      sleep_performance_level_description: 'Your sleep performance is optimal',
    };

    const mockRecovery: WhoopRecoveryData = {
      recovery_score: 85,
      hrv_rmssd: 65,
      resting_heart_rate: 52,
      recovery_level: 'SUFFICIENT',
      recovery_level_description: 'Your recovery is sufficient',
    };

    const mockBodyMeasurements: WhoopBodyMeasurements = {
      height_meter: 1.83,
      weight_kilogram: 75.5,
      max_heart_rate: 190,
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

    // Full wellness data (as returned from API)
    const mockWellnessFull: WellnessData = {
      weight: '74.5 kg',
      resting_hr: 51,
      hrv: 35.47,
      sleep_duration: '8h 10m',
      sleep_score: 87,
      sleep_quality: 1,
      soreness: 1,
      fatigue: 2,
      stress: 1,
      mood: 2,
      motivation: 2,
      injury: 1,
      hydration: 2,
      readiness: 60,
      vo2max: 54,
      steps: 22,
      respiration: 16.73,
      comments: 'Test wellness entry',
    };

    // Wellness data with Whoop-duplicate fields filtered out
    // When Whoop is connected, these fields are removed: resting_hr, hrv, hrv_sdnn,
    // sleep_duration, sleep_score, sleep_quality, avg_sleeping_hr, readiness, respiration, spo2
    const mockWellnessFiltered: WellnessData = {
      weight: '74.5 kg',
      soreness: 1,
      fatigue: 2,
      stress: 1,
      mood: 2,
      motivation: 2,
      injury: 1,
      hydration: 2,
      vo2max: 54,
      steps: 22,
      comments: 'Test wellness entry',
    };

    const mockWorkouts: NormalizedWorkout[] = [
      {
        id: '1',
        start_time: '2024-12-15T10:00:00+00:00',
        activity_type: 'Cycling',
        duration: '1:00:00',
        tss: 85,
        source: 'intervals.icu',
      },
    ];

    const mockPlannedWorkouts: PlannedWorkout[] = [
      {
        id: 'tr-1',
        scheduled_for: '2024-12-15T09:00:00Z',
        name: 'Sweet Spot Base',
        expected_tss: 88,
        source: 'trainerroad',
      },
    ];

    beforeEach(() => {
      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');
      vi.mocked(mockTrainerRoadClient.getUpcomingRaces).mockResolvedValue([]);
    });

    it('should return complete daily summary with all data', async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: mockSleep,
        recovery: mockRecovery,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(mockStrain);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(mockBodyMeasurements);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(mockFitness);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(mockWellnessFull);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue(mockPlannedWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      expect(result.whoop.sleep).toEqual(mockSleep);
      expect(result.whoop.recovery).toEqual(mockRecovery);
      expect(result.whoop.strain).toEqual(mockStrain);
      expect(result.whoop.body_measurements).toEqual(mockBodyMeasurements);
      expect(result.fitness).toEqual(mockFitness);
      // Whoop-duplicate fields are filtered when Whoop is connected
      expect(result.wellness).toEqual(mockWellnessFiltered);
      expect(result.completed_workouts).toHaveLength(1);
      expect(result.planned_workouts).toHaveLength(1);
      expect(result.workouts_completed).toBe(1);
      expect(result.workouts_planned).toBe(1);
      expect(result.tss_completed).toBe(85);
      expect(result.tss_planned).toBe(88);
    });

    it('should include current_time with full datetime in user timezone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:30:45Z'));

      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('America/New_York');
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      // Should be ISO 8601 format with timezone offset
      // 10:30:45 UTC = 05:30:45 America/New_York (UTC-5)
      expect(result.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
      expect(result.current_time).toBe('2024-12-15T05:30:45-05:00');

      vi.useRealTimers();
    });

    it('should include fitness metrics with ctl_load and atl_load', async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
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
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockRejectedValue(new Error('Failed'));
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      expect(result.fitness).toBeNull();
    });

    it('should handle missing Whoop client gracefully and return full wellness data', async () => {
      // When Whoop is not connected, wellness data should NOT be filtered
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(mockFitness);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(mockWellnessFull);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await toolsWithoutWhoop.getDailySummary();

      expect(result.whoop.sleep).toBeNull();
      expect(result.whoop.recovery).toBeNull();
      expect(result.whoop.strain).toBeNull();
      expect(result.whoop.body_measurements).toBeNull();
      expect(result.fitness).toEqual(mockFitness);
      // Full wellness data when Whoop is not connected
      expect(result.wellness).toEqual(mockWellnessFull);
      expect(result.wellness?.resting_hr).toBe(51);
      expect(result.wellness?.hrv).toBe(35.47);
      expect(result.wellness?.sleep_duration).toBe('8h 10m');
    });

    it('should filter Whoop-duplicate wellness fields when Whoop is connected', async () => {
      // When Whoop is connected, duplicate fields are filtered from wellness
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(mockWellnessFull);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      expect(result.wellness).not.toBeNull();
      // Non-duplicate fields are present
      expect(result.wellness?.weight).toBe('74.5 kg');
      expect(result.wellness?.soreness).toBe(1);
      expect(result.wellness?.fatigue).toBe(2);
      expect(result.wellness?.stress).toBe(1);
      expect(result.wellness?.mood).toBe(2);
      expect(result.wellness?.motivation).toBe(2);
      expect(result.wellness?.injury).toBe(1);
      expect(result.wellness?.hydration).toBe(2);
      expect(result.wellness?.vo2max).toBe(54);
      expect(result.wellness?.steps).toBe(22);
      expect(result.wellness?.comments).toBe('Test wellness entry');
      // Whoop-duplicate fields are filtered out
      expect(result.wellness?.resting_hr).toBeUndefined();
      expect(result.wellness?.hrv).toBeUndefined();
      expect(result.wellness?.sleep_duration).toBeUndefined();
      expect(result.wellness?.sleep_score).toBeUndefined();
      expect(result.wellness?.sleep_quality).toBeUndefined();
      expect(result.wellness?.readiness).toBeUndefined();
      expect(result.wellness?.respiration).toBeUndefined();
      expect(result.wellness?.spo2).toBeUndefined();
    });

    it('should return null wellness when only Whoop-duplicate fields exist', async () => {
      // If wellness only has fields that duplicate Whoop, it should be null
      const onlyWhoopDuplicates: WellnessData = {
        resting_hr: 50,
        hrv: 40.5,
        sleep_duration: '7h 30m',
      };
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(onlyWhoopDuplicates);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      // After filtering, no fields remain, so wellness should be null
      expect(result.wellness).toBeNull();
    });

    it('should handle null wellness when no data', async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
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
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockRejectedValue(new Error('Failed'));
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      expect(result.wellness).toBeNull();
    });

    it('should return scheduled_race when a race is scheduled for today', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:00:00Z'));

      const todaysRace: Race = {
        scheduled_for: '2024-12-15T07:00:00Z',
        name: 'Winter Triathlon',
        sport: 'Triathlon',
      };

      const futureRace: Race = {
        scheduled_for: '2024-12-25T08:00:00Z',
        name: 'Christmas Race',
        sport: 'Triathlon',
      };

      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getUpcomingRaces).mockResolvedValue([todaysRace, futureRace]);

      const result = await tools.getDailySummary();

      expect(result.scheduled_race).toEqual(todaysRace);

      vi.useRealTimers();
    });

    it('should return null scheduled_race when no races are scheduled', async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getUpcomingRaces).mockResolvedValue([]);

      const result = await tools.getDailySummary();

      expect(result.scheduled_race).toBeNull();
    });

    it('should return null scheduled_race when races exist but none for today', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:00:00Z'));

      const futureRace: Race = {
        scheduled_for: '2024-12-25T08:00:00Z',
        name: 'Christmas Race',
        sport: 'Triathlon',
      };

      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getUpcomingRaces).mockResolvedValue([futureRace]);

      const result = await tools.getDailySummary();

      expect(result.scheduled_race).toBeNull();

      vi.useRealTimers();
    });

    it('should handle race fetch failure gracefully', async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getTodayWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getUpcomingRaces).mockRejectedValue(new Error('Failed'));

      const result = await tools.getDailySummary();

      expect(result.scheduled_race).toBeNull();
    });

    it('should return null scheduled_race when TrainerRoad client is not configured', async () => {
      const toolsWithoutTr = new CurrentTools(mockIntervalsClient, mockWhoopClient, null);

      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await toolsWithoutTr.getDailySummary();

      expect(result.scheduled_race).toBeNull();
    });
  });
});
