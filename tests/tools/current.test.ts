import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CurrentTools } from '../../src/tools/current.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { WhoopClient } from '../../src/clients/whoop.js';
import { TrainerRoadClient } from '../../src/clients/trainerroad.js';
import { GoogleWeatherClient } from '../../src/clients/google-weather.js';
import { GoogleAirQualityClient } from '../../src/clients/google-air-quality.js';
import { GooglePollenClient } from '../../src/clients/google-pollen.js';
import { GoogleElevationClient } from '../../src/clients/google-elevation.js';
import { GoogleGeocodingClient } from '../../src/clients/google-geocoding.js';
import { GoogleTimezoneClient } from '../../src/clients/google-timezone.js';
import type { WhoopSleepData, WhoopRecoveryData, StrainData, PlannedWorkout, NormalizedWorkout, StrainActivity, FitnessMetrics, WellnessData, WhoopBodyMeasurements, Race } from '../../src/types/index.js';

// Mock the clients
vi.mock('../../src/clients/intervals.js');
vi.mock('../../src/clients/whoop.js');
vi.mock('../../src/clients/trainerroad.js');
vi.mock('../../src/clients/google-weather.js');
vi.mock('../../src/clients/google-air-quality.js');
vi.mock('../../src/clients/google-pollen.js');
vi.mock('../../src/clients/google-elevation.js');
vi.mock('../../src/clients/google-geocoding.js');
vi.mock('../../src/clients/google-timezone.js');

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
      sleep_performance_level: 'Optimal',
      sleep_performance_level_description: 'Your sleep performance is optimal',
    };

    const mockRecovery: WhoopRecoveryData = {
      recovery_score: 85,
      hrv_rmssd: 65,
      resting_heart_rate: 52,
      recovery_level: 'Sufficient',
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
      expect(result.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
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
      strain_level: 'High',
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
      expect(result.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
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
      expect(result.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
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
      expect(result.current_time).toMatch(/^2024-12-15T10:30:45(Z|\+00:00)$/);
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

      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trainerroadWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getTodaysPlannedWorkouts();

      expect(result.workouts).toHaveLength(2);
      expect(result.workouts).toContainEqual(trainerroadWorkouts[0]);
      expect(result.workouts).toContainEqual(intervalsWorkouts[0]);
      expect(result.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

      vi.useRealTimers();
    });

    it('should include current_time in user timezone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:30:45Z'));

      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('Asia/Tokyo');
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
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

      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(trainerroadWorkouts);
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
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockRejectedValue(new Error('Failed'));
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(intervalsWorkouts);

      const result = await tools.getTodaysPlannedWorkouts();

      expect(result.workouts).toHaveLength(1);
      expect(result.workouts[0]).toEqual(intervalsWorkouts[0]);
    });
  });

  describe('getTodaysWorkouts', () => {
    beforeEach(() => {
      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');
    });

    const mockCompletedWorkouts: NormalizedWorkout[] = [
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

    const mockPlannedTr: PlannedWorkout[] = [
      {
        id: 'tr-1',
        scheduled_for: '2024-12-15T18:00:00Z',
        name: 'Sweet Spot Base',
        expected_tss: 88,
        source: 'trainerroad',
      },
    ];

    const mockPlannedIcu: PlannedWorkout[] = [
      {
        id: 'int-1',
        scheduled_for: '2024-12-15T19:00:00Z',
        name: 'Easy Run',
        expected_tss: 35,
        source: 'intervals.icu',
      },
    ];

    it('should return both completed and planned workouts with TSS totals and current_time', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-15T10:30:45Z'));

      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockCompletedWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue(mockWhoopActivities);
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(mockPlannedTr);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(mockPlannedIcu);

      const result = await tools.getTodaysWorkouts();

      expect(result.completed_workouts).toHaveLength(1);
      expect(result.completed_workouts[0].whoop?.strain_score).toBe(12.5);
      expect(result.planned_workouts).toHaveLength(2);
      expect(result.workouts_completed).toBe(1);
      expect(result.workouts_planned).toBe(2);
      expect(result.tss_completed).toBe(85);
      expect(result.tss_planned).toBe(123); // 88 + 35
      expect(result.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

      vi.useRealTimers();
    });

    it('should fetch completed workouts with full data (skipExpensiveCalls not set)', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      await tools.getTodaysWorkouts();

      // The 4th argument (options) should not be passed (or should not have skipExpensiveCalls: true)
      // so per-activity expensive calls (heat zones, notes, weather) are included.
      const callArgs = vi.mocked(mockIntervalsClient.getActivities).mock.calls[0];
      const options = callArgs[3];
      expect(options?.skipExpensiveCalls).not.toBe(true);
    });

    it('should return empty arrays and zero totals when no workouts today', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getTodaysWorkouts();

      expect(result.completed_workouts).toEqual([]);
      expect(result.planned_workouts).toEqual([]);
      expect(result.workouts_completed).toBe(0);
      expect(result.workouts_planned).toBe(0);
      expect(result.tss_completed).toBe(0);
      expect(result.tss_planned).toBe(0);
      expect(result.current_time).toBeTruthy();
    });

    it('should work without Whoop client (workouts have whoop: null)', async () => {
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockCompletedWorkouts);
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(mockPlannedTr);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await toolsWithoutWhoop.getTodaysWorkouts();

      expect(result.completed_workouts).toHaveLength(1);
      expect(result.completed_workouts[0].whoop).toBeNull();
      expect(result.planned_workouts).toHaveLength(1);
    });

    it('should work without TrainerRoad client (planned only from Intervals)', async () => {
      const toolsWithoutTr = new CurrentTools(mockIntervalsClient, mockWhoopClient, null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue(mockPlannedIcu);

      const result = await toolsWithoutTr.getTodaysWorkouts();

      expect(result.planned_workouts).toHaveLength(1);
      expect(result.planned_workouts[0].source).toBe('intervals.icu');
      expect(result.workouts_planned).toBe(1);
      expect(result.tss_planned).toBe(35);
    });

    it('should handle errors in completed workouts gracefully', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockRejectedValue(new Error('Intervals down'));
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(mockPlannedTr);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getTodaysWorkouts();

      expect(result.completed_workouts).toEqual([]);
      expect(result.planned_workouts).toHaveLength(1);
    });

    it('should handle errors in planned workouts gracefully', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockCompletedWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockRejectedValue(new Error('TR down'));
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockRejectedValue(new Error('ICU down'));

      const result = await tools.getTodaysWorkouts();

      expect(result.completed_workouts).toHaveLength(1);
      expect(result.planned_workouts).toEqual([]);
    });

    it('should round TSS totals', async () => {
      const completedWithFractional: NormalizedWorkout[] = [
        { ...mockCompletedWorkouts[0], tss: 85.4 },
        { ...mockCompletedWorkouts[0], id: '2', tss: 30.7 },
      ];
      const plannedWithFractional: PlannedWorkout[] = [
        { ...mockPlannedTr[0], expected_tss: 50.6 },
      ];

      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(completedWithFractional);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(plannedWithFractional);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getTodaysWorkouts();

      expect(result.tss_completed).toBe(116); // round(85.4 + 30.7) = round(116.1) = 116
      expect(result.tss_planned).toBe(51); // round(50.6) = 51
    });
  });

  describe('getTodaysSummary', () => {
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
      sleep_performance_level: 'Optimal',
      sleep_performance_level_description: 'Your sleep performance is optimal',
    };

    const mockRecovery: WhoopRecoveryData = {
      recovery_score: 85,
      hrv_rmssd: 65,
      resting_heart_rate: 52,
      recovery_level: 'Sufficient',
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
      strain_level: 'High',
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

    // Full wellness data (as returned from the client). Includes a `sources`
    // map identifying each field's configured provider (garmin/whoop/oura).
    const mockWellnessFull: WellnessData = {
      weight: '74.5 kg',
      resting_hr: '51 bpm',
      hrv: '35.47 ms',
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
      vo2max: '54 mL/kg/min',
      steps: 22,
      respiration: '16.7 breaths/min',
      comments: 'Test wellness entry',
      sources: {
        weight: 'garmin',
        resting_hr: 'garmin',
        hrv: 'garmin',
        vo2max: 'garmin',
        steps: 'garmin',
        sleep_duration: 'whoop',
        sleep_score: 'whoop',
        sleep_quality: 'whoop',
        readiness: 'whoop',
        respiration: 'whoop',
      },
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
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue(mockPlannedWorkouts);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getTodaysSummary();

      expect(result.whoop.sleep).toEqual(mockSleep);
      expect(result.whoop.recovery).toEqual(mockRecovery);
      expect(result.whoop.strain).toEqual(mockStrain);
      expect(result.whoop.body_measurements).toEqual(mockBodyMeasurements);
      expect(result.fitness).toEqual(mockFitness);
      // All wellness fields surface, including Whoop overlaps, so the LLM can
      // compare them against whoop.* using the per-field sources map.
      expect(result.wellness).toEqual(mockWellnessFull);
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
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getTodaysSummary();

      // 10:30:45 UTC = 05:30:45 America/New_York (UTC-5)
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
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getTodaysSummary();

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
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getTodaysSummary();

      expect(result.fitness).toBeNull();
    });

    it('passes wellness through unchanged whether or not Whoop is connected', async () => {
      // Without Whoop
      const toolsWithoutWhoop = new CurrentTools(mockIntervalsClient, null, mockTrainerRoadClient);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(mockFitness);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(mockWellnessFull);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const noWhoopResult = await toolsWithoutWhoop.getTodaysSummary();
      expect(noWhoopResult.wellness).toEqual(mockWellnessFull);

      // With Whoop — overlapping fields (HRV, RHR, sleep, etc.) and the
      // sources map are preserved so the LLM can compare against whoop.*.
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({
        sleep: null,
        recovery: null,
      });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(mockWellnessFull);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);

      const withWhoopResult = await tools.getTodaysSummary();
      expect(withWhoopResult.wellness).toEqual(mockWellnessFull);
      expect(withWhoopResult.wellness?.hrv).toBe('35.47 ms');
      expect(withWhoopResult.wellness?.resting_hr).toBe('51 bpm');
      expect(withWhoopResult.wellness?.sleep_duration).toBe('8h 10m');
      expect(withWhoopResult.wellness?.sources?.hrv).toBe('garmin');
      expect(withWhoopResult.wellness?.sources?.sleep_duration).toBe('whoop');
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
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getTodaysSummary();

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
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);

      const result = await tools.getTodaysSummary();

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
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getUpcomingRaces).mockResolvedValue([todaysRace, futureRace]);

      const result = await tools.getTodaysSummary();

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
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getUpcomingRaces).mockResolvedValue([]);

      const result = await tools.getTodaysSummary();

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
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getUpcomingRaces).mockResolvedValue([futureRace]);

      const result = await tools.getTodaysSummary();

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
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getUpcomingRaces).mockRejectedValue(new Error('Failed'));

      const result = await tools.getTodaysSummary();

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

      const result = await toolsWithoutTr.getTodaysSummary();

      expect(result.scheduled_race).toBeNull();
    });
  });

  describe('weather forecast', () => {
    let mockGoogleWeatherClient: GoogleWeatherClient;
    let mockGoogleAirQualityClient: GoogleAirQualityClient;
    let mockGooglePollenClient: GooglePollenClient;
    let mockGoogleElevationClient: GoogleElevationClient;

    // Sample Google Weather responses for the three calls. Athlete is in America/Boise.
    const sampleCurrent = {
      currentTime: '2026-04-28T14:49:34Z',
      isDaytime: true,
      weatherCondition: { description: { text: 'Mostly clear' } },
      temperature: { degrees: 4.07, unit: 'CELSIUS' },
      relativeHumidity: 58,
      wind: {
        direction: { degrees: 226, cardinal: 'SOUTHWEST' },
        speed: { value: 12.12, unit: 'KILOMETERS_PER_HOUR' },
      },
    };

    const sampleHourly = {
      forecastHours: [
        // past — drop
        { interval: { startTime: '2026-04-28T13:00:00Z' }, temperature: { degrees: -0.47, unit: 'CELSIUS' } },
        // future today — keep
        { interval: { startTime: '2026-04-28T20:00:00Z' }, temperature: { degrees: 12.01, unit: 'CELSIUS' } },
        // tomorrow — drop
        { interval: { startTime: '2026-04-29T13:00:00Z' }, temperature: { degrees: 1.28, unit: 'CELSIUS' } },
      ],
    };

    const sampleAlerts = {
      weatherAlerts: [
        {
          alertTitle: { text: 'Freeze Warning' },
          description: 'Freezing temperatures expected.',
          severity: 'MODERATE',
          startTime: '2026-04-29T00:00:00Z',
          expirationTime: '2026-04-29T12:00:00Z',
          dataSource: { name: 'National Weather Service' },
        },
      ],
    };

    beforeEach(() => {
      mockGoogleWeatherClient = new GoogleWeatherClient({ apiKey: 'k' });
      mockGoogleAirQualityClient = new GoogleAirQualityClient({ apiKey: 'k' });
      mockGooglePollenClient = new GooglePollenClient({ apiKey: 'k' });
      mockGoogleElevationClient = new GoogleElevationClient({ apiKey: 'k' });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-28T14:49:34Z'));
      vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('America/Boise');
      // Default the daily forecast to undefined so existing tests that don't
      // care about sun events don't have to mock it explicitly.
      vi.mocked(mockGoogleWeatherClient.getDailyForecast).mockResolvedValue(undefined as never);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns empty forecasts when Google Weather is not configured', async () => {
      const toolsNoWeather = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        null
      );

      const result = await toolsNoWeather.getWeatherForecast();
      expect(result.forecasts).toEqual([]);
      expect(result.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      expect(mockIntervalsClient.getEnabledWeatherLocations).not.toHaveBeenCalled();
    });

    it('builds per-location forecasts when Google Weather is configured', async () => {
      const toolsWithWeather = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Moose', latitude: 43.65, longitude: -110.71, location: 'Moose,Wyoming,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);

      const result = await toolsWithWeather.getWeatherForecast();

      expect(mockGoogleWeatherClient.getCurrentConditions).toHaveBeenCalledWith(43.65, -110.71);
      expect(mockGoogleWeatherClient.getHourlyForecast).toHaveBeenCalledWith(43.65, -110.71);
      expect(mockGoogleWeatherClient.getWeatherAlerts).toHaveBeenCalledWith(43.65, -110.71);

      expect(result.forecasts).toHaveLength(1);
      const fc = result.forecasts[0];
      expect(fc.location).toBe('Moose');
      expect(fc.current_conditions?.condition).toBe('Mostly clear');
      expect(fc.current_conditions?.temperature).toBe('4.1 °C');
      // Hourly should only contain the one future hour for today.
      // Without a Time Zone client, the location's tz falls back to the
      // athlete's tz (America/Boise = MDT, UTC-6). 20:00 UTC = 14:00 MDT.
      expect(fc.hourly_forecast).toHaveLength(1);
      expect(fc.hourly_forecast[0].forecast_start).toMatch(/at 2:00 PM MDT$/);
      // Alerts pass through with the slimmed shape; datetimes pre-formatted
      // and enum values normalized to sentence case.
      expect(fc.alerts).toEqual([
        {
          title: 'Freeze Warning',
          description: 'Freezing temperatures expected.',
          event_type: undefined,
          area_name: undefined,
          severity: 'Moderate',
          urgency: undefined,
          certainty: undefined,
          start_time: 'Tuesday, April 28, 2026 at 6:00 PM MDT', // 2026-04-29T00:00 UTC = 18:00 MDT prior day
          expiration_time: 'Wednesday, April 29, 2026 at 6:00 AM MDT',
          source: 'National Weather Service',
        },
      ]);
    });

    it('keeps a location when one of the three Google calls fails (alerts only)', async () => {
      const toolsWithWeather = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Boise', latitude: 1, longitude: 2, location: 'Boise,Idaho,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockRejectedValue(new Error('alerts boom'));

      const result = await toolsWithWeather.getWeatherForecast();
      expect(result.forecasts.map((f) => f.location)).toEqual(['Boise']);
      expect(result.forecasts[0].alerts).toEqual([]);
      expect(result.forecasts[0].current_conditions?.temperature).toBe('4.1 °C');
    });

    it('returns a null current_conditions when current conditions fails but keeps the location', async () => {
      const toolsWithWeather = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'A', latitude: 0, longitude: 0, location: 'A,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockRejectedValue(new Error('boom'));
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);

      const result = await toolsWithWeather.getWeatherForecast();
      expect(result.forecasts.map((f) => f.location)).toEqual(['A']);
      expect(result.forecasts[0].current_conditions).toBeNull();
    });

    it("includes the forecast in getTodaysSummary's response", async () => {
      const toolsWithWeather = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Boise', latitude: 43.61, longitude: -116.20, location: 'Boise,Idaho,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({ sleep: null, recovery: null });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getUpcomingRaces).mockResolvedValue([]);

      const result = await toolsWithWeather.getTodaysSummary();
      expect(result.forecast).toHaveLength(1);
      expect(result.forecast[0].location).toBe('Boise');
    });

    it("getTodaysSummary forecast is [] when Google Weather isn't configured", async () => {
      vi.mocked(mockWhoopClient.getTodayRecovery).mockResolvedValue({ sleep: null, recovery: null });
      vi.mocked(mockWhoopClient.getTodayStrain).mockResolvedValue(null);
      vi.mocked(mockWhoopClient.getBodyMeasurements).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayFitness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getTodayWellness).mockResolvedValue(null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);
      vi.mocked(mockIntervalsClient.getPlannedEvents).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getPlannedWorkouts).mockResolvedValue([]);
      vi.mocked(mockTrainerRoadClient.getUpcomingRaces).mockResolvedValue([]);

      // tools (the suite-level instance) is constructed without Google Weather
      const result = await tools.getTodaysSummary();
      expect(result.forecast).toEqual([]);
    });

    it('attaches AQI from the Google Air Quality client when configured', async () => {
      const toolsWithAirQuality = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient,
        mockGoogleAirQualityClient
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Moose', latitude: 43.65, longitude: -110.71, location: 'Moose,Wyoming,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);
      vi.mocked(mockGoogleAirQualityClient.getCurrentAirQuality).mockResolvedValue({
        indexes: [
          {
            code: 'usa_epa',
            displayName: 'AQI (US)',
            aqi: 41,
            category: 'Good air quality',
            dominantPollutant: 'pm25',
          },
        ],
      });
      vi.mocked(mockGoogleAirQualityClient.getHourlyAirQualityForecast).mockResolvedValue({
        hourlyForecasts: [
          {
            dateTime: '2026-04-28T20:00:00Z',
            indexes: [
              {
                code: 'usa_epa',
                displayName: 'AQI (US)',
                aqi: 55,
                category: 'Moderate air quality',
                dominantPollutant: 'o3',
              },
            ],
          },
        ],
      });

      const result = await toolsWithAirQuality.getWeatherForecast();

      expect(mockGoogleAirQualityClient.getCurrentAirQuality).toHaveBeenCalledWith(43.65, -110.71);
      expect(mockGoogleAirQualityClient.getHourlyAirQualityForecast).toHaveBeenCalledWith(
        43.65,
        -110.71,
        24
      );

      const fc = result.forecasts[0];
      expect(fc.current_conditions?.air_quality?.aqi).toBe(41);
      expect(fc.current_conditions?.air_quality?.dominant_pollutant).toBe('pm25');
      expect(fc.current_conditions?.air_quality?.index_display_name).toBe('AQI (US)');
      expect(fc.hourly_forecast).toHaveLength(1);
      expect(fc.hourly_forecast[0].air_quality?.aqi).toBe(55);
      expect(fc.hourly_forecast[0].air_quality?.dominant_pollutant).toBe('o3');
    });

    it('keeps the forecast when Air Quality calls fail', async () => {
      const toolsWithAirQuality = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient,
        mockGoogleAirQualityClient
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Moose', latitude: 43.65, longitude: -110.71, location: 'Moose,Wyoming,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);
      vi.mocked(mockGoogleAirQualityClient.getCurrentAirQuality).mockRejectedValue(new Error('boom'));
      vi.mocked(mockGoogleAirQualityClient.getHourlyAirQualityForecast).mockRejectedValue(new Error('boom'));

      const result = await toolsWithAirQuality.getWeatherForecast();
      const fc = result.forecasts[0];
      expect(fc.location).toBe('Moose');
      expect(fc.current_conditions?.air_quality).toBeUndefined();
      expect(fc.hourly_forecast[0].air_quality).toBeUndefined();
      // Weather data is still present
      expect(fc.current_conditions?.temperature).toBe('4.1 °C');
    });

    it('does not call the Air Quality client when it is not configured', async () => {
      const toolsWeatherOnly = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient,
        null
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Moose', latitude: 43.65, longitude: -110.71, location: 'Moose,Wyoming,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);

      const result = await toolsWeatherOnly.getWeatherForecast();
      expect(mockGoogleAirQualityClient.getCurrentAirQuality).not.toHaveBeenCalled();
      expect(mockGoogleAirQualityClient.getHourlyAirQualityForecast).not.toHaveBeenCalled();
      expect(result.forecasts[0].current_conditions?.air_quality).toBeUndefined();
    });

    it('attaches pollen from the Google Pollen client when configured', async () => {
      const toolsWithPollen = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient,
        null,
        mockGooglePollenClient
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Moose', latitude: 43.65, longitude: -110.71, location: 'Moose,Wyoming,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);
      vi.mocked(mockGooglePollenClient.getPollenForecast).mockResolvedValue({
        regionCode: 'us',
        dailyInfo: [
          {
            date: { year: 2026, month: 4, day: 28 },
            pollenTypeInfo: [
              {
                code: 'GRASS',
                displayName: 'Grass',
                inSeason: true,
                indexInfo: {
                  code: 'UPI',
                  displayName: 'Universal Pollen Index',
                  value: 3,
                  category: 'Moderate',
                  indexDescription: 'Moderately allergic people may experience symptoms.',
                },
                healthRecommendations: ['Keep windows closed and use AC if possible.'],
              },
            ],
            plantInfo: [
              {
                code: 'BIRCH',
                displayName: 'Birch',
                inSeason: false,
                indexInfo: {
                  code: 'UPI',
                  displayName: 'Universal Pollen Index',
                  value: 1,
                  category: 'Very Low',
                },
              },
            ],
          },
        ],
      });

      const result = await toolsWithPollen.getWeatherForecast();

      expect(mockGooglePollenClient.getPollenForecast).toHaveBeenCalledWith(43.65, -110.71, 1);

      const fc = result.forecasts[0];
      expect((fc.current_conditions as unknown as { pollen?: unknown })?.pollen).toBeUndefined();
      expect(fc.pollen?.date).toBe('2026-04-28');
      expect(fc.pollen?.universal_pollen_index).toEqual([
        {
          value: 3,
          category: 'Moderate',
          description: 'Moderately allergic people may experience symptoms.',
          pollen_types: ['Grass'],
          plants: undefined,
        },
        { value: 1, category: 'Very Low', description: undefined, pollen_types: undefined, plants: ['Birch'] },
      ]);
      expect((fc.pollen as unknown as { health_recommendations?: unknown })?.health_recommendations).toBeUndefined();
    });

    it('keeps the forecast when the Pollen call fails', async () => {
      const toolsWithPollen = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient,
        null,
        mockGooglePollenClient
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Moose', latitude: 43.65, longitude: -110.71, location: 'Moose,Wyoming,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);
      vi.mocked(mockGooglePollenClient.getPollenForecast).mockRejectedValue(new Error('boom'));

      const result = await toolsWithPollen.getWeatherForecast();
      const fc = result.forecasts[0];
      expect(fc.location).toBe('Moose');
      expect(fc.pollen).toBeUndefined();
      expect(fc.current_conditions?.temperature).toBe('4.1 °C');
    });

    it("attaches today's sunrise/sunset from the daily forecast", async () => {
      const toolsWithWeather = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Moose', latitude: 43.65, longitude: -110.71, location: 'Moose,Wyoming,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);
      vi.mocked(mockGoogleWeatherClient.getDailyForecast).mockResolvedValue({
        forecastDays: [
          {
            displayDate: { year: 2026, month: 4, day: 28 },
            sunEvents: {
              sunriseTime: '2026-04-28T12:30:00Z',
              sunsetTime: '2026-04-29T02:15:00Z',
            },
          },
        ],
      });

      const result = await toolsWithWeather.getWeatherForecast();

      expect(mockGoogleWeatherClient.getDailyForecast).toHaveBeenCalledWith(43.65, -110.71);
      const fc = result.forecasts[0];
      // Pre-formatted in the location's tz (Boise = MDT, UTC-6 in DST).
      // 12:30 UTC = 06:30 MDT; 02:15 UTC next day = 20:15 MDT today.
      expect(fc.sunrise).toMatch(/at 6:30 AM MDT$/);
      expect(fc.sunset).toMatch(/at 8:15 PM MDT$/);
    });

    it('keeps the forecast when the daily forecast call fails', async () => {
      const toolsWithWeather = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Moose', latitude: 43.65, longitude: -110.71, location: 'Moose,Wyoming,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);
      vi.mocked(mockGoogleWeatherClient.getDailyForecast).mockRejectedValue(new Error('daily boom'));

      const result = await toolsWithWeather.getWeatherForecast();
      const fc = result.forecasts[0];
      expect(fc.location).toBe('Moose');
      expect(fc.sunrise).toBeUndefined();
      expect(fc.sunset).toBeUndefined();
      expect(fc.current_conditions?.temperature).toBe('4.1 °C');
    });

    it('does not call the Pollen client when it is not configured', async () => {
      const toolsWeatherOnly = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient,
        null,
        null
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Moose', latitude: 43.65, longitude: -110.71, location: 'Moose,Wyoming,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);

      const result = await toolsWeatherOnly.getWeatherForecast();
      expect(mockGooglePollenClient.getPollenForecast).not.toHaveBeenCalled();
      expect(result.forecasts[0].pollen).toBeUndefined();
    });

    it('attaches elevation from the Google Elevation client when configured', async () => {
      const toolsWithElevation = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient,
        null,
        null,
        mockGoogleElevationClient
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Moose', latitude: 43.65, longitude: -110.71, location: 'Moose,Wyoming,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);
      vi.mocked(mockGoogleElevationClient.getElevation).mockResolvedValue({
        status: 'OK',
        results: [{ elevation: 1980.4, location: { lat: 43.65, lng: -110.71 }, resolution: 4.7 }],
      });

      const result = await toolsWithElevation.getWeatherForecast();

      expect(mockGoogleElevationClient.getElevation).toHaveBeenCalledWith(43.65, -110.71);
      expect(result.forecasts[0].elevation).toBe('1980 m');
    });

    it('keeps the forecast when the Elevation call fails', async () => {
      const toolsWithElevation = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient,
        null,
        null,
        mockGoogleElevationClient
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Moose', latitude: 43.65, longitude: -110.71, location: 'Moose,Wyoming,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);
      vi.mocked(mockGoogleElevationClient.getElevation).mockRejectedValue(new Error('elevation boom'));

      const result = await toolsWithElevation.getWeatherForecast();
      const fc = result.forecasts[0];
      expect(fc.location).toBe('Moose');
      expect(fc.elevation).toBeUndefined();
      expect(fc.current_conditions?.temperature).toBe('4.1 °C');
    });

    it('does not call the Elevation client when it is not configured', async () => {
      const toolsWeatherOnly = new CurrentTools(
        mockIntervalsClient,
        mockWhoopClient,
        mockTrainerRoadClient,
        mockGoogleWeatherClient,
        null,
        null,
        null
      );

      vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
        { id: 1, label: 'Moose', latitude: 43.65, longitude: -110.71, location: 'Moose,Wyoming,US' },
      ]);
      vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
      vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourly);
      vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);

      const result = await toolsWeatherOnly.getWeatherForecast();
      expect(mockGoogleElevationClient.getElevation).not.toHaveBeenCalled();
      expect(result.forecasts[0].elevation).toBeUndefined();
    });

    describe('future dates and geocoded locations', () => {
      let mockGoogleGeocodingClient: GoogleGeocodingClient;

      const sampleDailyAt = (ymd: string) => ({
        forecastDays: [
          {
            displayDate: { year: Number(ymd.slice(0, 4)), month: Number(ymd.slice(5, 7)), day: Number(ymd.slice(8, 10)) },
            sunEvents: { sunriseTime: `${ymd}T13:30:00Z`, sunsetTime: `${ymd}T03:00:00Z` },
            maxTemperature: { degrees: 22.5, unit: 'CELSIUS' },
            minTemperature: { degrees: 8.1, unit: 'CELSIUS' },
            feelsLikeMaxTemperature: { degrees: 21, unit: 'CELSIUS' },
            feelsLikeMinTemperature: { degrees: 6, unit: 'CELSIUS' },
            daytimeForecast: {
              weatherCondition: { description: { text: 'Mostly sunny' } },
              relativeHumidity: 35,
              uvIndex: 7,
              cloudCover: 20,
              precipitation: { qpf: { quantity: 0, unit: 'MILLIMETERS' }, probability: { percent: 5, type: 'RAIN' } },
              thunderstormProbability: 0,
              wind: {
                direction: { degrees: 270, cardinal: 'WEST' },
                speed: { value: 14, unit: 'KILOMETERS_PER_HOUR' },
                gust: { value: 22, unit: 'KILOMETERS_PER_HOUR' },
              },
            },
          },
        ],
      });

      const sampleHourlyAcrossDays = {
        forecastHours: [
          // 2026-04-30 in Boise (UTC-6) = 2026-04-30T06:00Z..2026-05-01T05:59Z
          { interval: { startTime: '2026-04-30T06:00:00Z' }, temperature: { degrees: 8, unit: 'CELSIUS' } },
          { interval: { startTime: '2026-04-30T18:00:00Z' }, temperature: { degrees: 18, unit: 'CELSIUS' }, isDaytime: true },
          { interval: { startTime: '2026-05-01T04:00:00Z' }, temperature: { degrees: 11, unit: 'CELSIUS' }, isDaytime: false },
          // Different date — should be filtered out
          { interval: { startTime: '2026-05-01T13:00:00Z' }, temperature: { degrees: 5, unit: 'CELSIUS' } },
        ],
      };

      beforeEach(() => {
        mockGoogleGeocodingClient = new GoogleGeocodingClient({ apiKey: 'k' });
      });

      it('rejects dates outside the supported window', async () => {
        const tools = new CurrentTools(
          mockIntervalsClient,
          mockWhoopClient,
          mockTrainerRoadClient,
          mockGoogleWeatherClient
        );
        await expect(tools.getWeatherForecast({ date: '2026-05-15' })).rejects.toThrow(/outside the supported window/);
        await expect(tools.getWeatherForecast({ date: '2026-04-27' })).rejects.toThrow(/outside the supported window/);
      });

      it('returns empty forecasts when Google Weather is not configured (no args)', async () => {
        const tools = new CurrentTools(mockIntervalsClient, mockWhoopClient, mockTrainerRoadClient, null);
        const result = await tools.getWeatherForecast({ date: '2026-05-02' });
        expect(result.forecasts).toEqual([]);
      });

      it('throws when location arg is provided but geocoding is not configured', async () => {
        const tools = new CurrentTools(
          mockIntervalsClient,
          mockWhoopClient,
          mockTrainerRoadClient,
          mockGoogleWeatherClient,
          null,
          null,
          null,
          null
        );
        await expect(tools.getWeatherForecast({ location: 'Boulder, CO' })).rejects.toThrow(/Free-text location lookup is not available/);
      });

      it('builds a future-date forecast with only daily/hourly when date > today and no AQ/pollen configured', async () => {
        const tools = new CurrentTools(
          mockIntervalsClient,
          mockWhoopClient,
          mockTrainerRoadClient,
          mockGoogleWeatherClient
        );

        vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
          { id: 1, label: 'Moose', latitude: 43.65, longitude: -110.71, location: 'Moose,Wyoming,US' },
        ]);
        vi.mocked(mockGoogleWeatherClient.getDailyForecast).mockResolvedValue(sampleDailyAt('2026-04-30'));
        vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue(sampleHourlyAcrossDays);

        const result = await tools.getWeatherForecast({ date: '2026-04-30' });

        // No current_conditions on future-date forecast — current weather is N/A.
        // Alerts are still fetched: a publisher may issue an alert today whose
        // window covers a future date, and selectAlerts gates by overlap.
        expect(mockGoogleWeatherClient.getCurrentConditions).not.toHaveBeenCalled();
        expect(mockGoogleWeatherClient.getWeatherAlerts).toHaveBeenCalledWith(43.65, -110.71);

        expect(result.forecasts).toHaveLength(1);
        const fc = result.forecasts[0];
        expect(fc.location).toBe('Moose');
        expect(fc.forecast_date).toBe('2026-04-30');
        expect(fc.current_conditions).toBeUndefined();
        expect(fc.alerts).toEqual([]);
        // All hours that fall on the local date 2026-04-30 in Boise (UTC-6 in DST):
        // - 2026-04-30T06:00Z = 00:00 local (keep)
        // - 2026-04-30T18:00Z = 12:00 local (keep)
        // - 2026-05-01T04:00Z = 22:00 local same day (keep)
        // - 2026-05-01T13:00Z = 07:00 local next day (drop)
        // forecast_start is pre-formatted in the location's tz.
        expect(fc.hourly_forecast).toHaveLength(3);
        expect(fc.hourly_forecast[0].forecast_start).toMatch(/at 12:00 AM MDT$/);
        expect(fc.hourly_forecast[1].forecast_start).toMatch(/at 12:00 PM MDT$/);
        expect(fc.hourly_forecast[2].forecast_start).toMatch(/at 10:00 PM MDT$/);
        expect(fc.daily_summary?.condition).toBe('Mostly sunny');
        expect(fc.daily_summary?.temperature_max).toBe('22.5 °C');
        expect(fc.daily_summary?.temperature_min).toBe('8.1 °C');
      });

      it('omits pollen for dates beyond the Pollen API window (today+5 or later)', async () => {
        const tools = new CurrentTools(
          mockIntervalsClient,
          mockWhoopClient,
          mockTrainerRoadClient,
          mockGoogleWeatherClient,
          null,
          mockGooglePollenClient
        );

        vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
          { id: 1, label: 'X', latitude: 0, longitude: 0, location: 'X' },
        ]);
        vi.mocked(mockGoogleWeatherClient.getDailyForecast).mockResolvedValue(sampleDailyAt('2026-05-05'));
        vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue({ forecastHours: [] });

        // 2026-05-05 is today (2026-04-28) + 7 days — beyond pollen's 5-day window
        const result = await tools.getWeatherForecast({ date: '2026-05-05' });
        expect(mockGooglePollenClient.getPollenForecast).not.toHaveBeenCalled();
        expect(result.forecasts[0].pollen).toBeUndefined();
      });

      it('omits hourly air quality for dates beyond the AQ window (today+4 or later)', async () => {
        const tools = new CurrentTools(
          mockIntervalsClient,
          mockWhoopClient,
          mockTrainerRoadClient,
          mockGoogleWeatherClient,
          mockGoogleAirQualityClient
        );

        vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
          { id: 1, label: 'X', latitude: 0, longitude: 0, location: 'X' },
        ]);
        vi.mocked(mockGoogleWeatherClient.getDailyForecast).mockResolvedValue(sampleDailyAt('2026-05-03'));
        vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue({ forecastHours: [] });

        // 2026-05-03 is today (2026-04-28) + 5 days — beyond AQ's 96h window
        await tools.getWeatherForecast({ date: '2026-05-03' });
        expect(mockGoogleAirQualityClient.getHourlyAirQualityForecast).not.toHaveBeenCalled();
      });

      it('geocodes the location string and returns a single resolved forecast', async () => {
        const tools = new CurrentTools(
          mockIntervalsClient,
          mockWhoopClient,
          mockTrainerRoadClient,
          mockGoogleWeatherClient,
          null,
          null,
          null,
          mockGoogleGeocodingClient
        );

        vi.mocked(mockGoogleGeocodingClient.geocode).mockResolvedValue({
          formattedAddress: 'San Francisco, CA, USA',
          latitude: 37.7749,
          longitude: -122.4194,
        });
        vi.mocked(mockGoogleWeatherClient.getDailyForecast).mockResolvedValue(sampleDailyAt('2026-04-30'));
        vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue({ forecastHours: [] });

        const result = await tools.getWeatherForecast({ date: '2026-04-30', location: 'San Francisco, CA' });

        expect(mockGoogleGeocodingClient.geocode).toHaveBeenCalledWith('San Francisco, CA');
        // Intervals.icu enabled-location lookup must be skipped when location is provided
        expect(mockIntervalsClient.getEnabledWeatherLocations).not.toHaveBeenCalled();
        expect(result.forecasts).toHaveLength(1);
        expect(result.forecasts[0].location).toBe('San Francisco, CA, USA');
        expect(result.forecasts[0].latitude).toBe(37.7749);
        expect(result.forecasts[0].longitude).toBe(-122.4194);
      });

      it('hourly forecast for today now includes nighttime hours of the same local day', async () => {
        const tools = new CurrentTools(
          mockIntervalsClient,
          mockWhoopClient,
          mockTrainerRoadClient,
          mockGoogleWeatherClient
        );

        // System time set in the parent beforeEach to 2026-04-28T14:49:34Z (08:49 Boise)
        vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
          { id: 1, label: 'Boise', latitude: 0, longitude: 0, location: 'Boise,Idaho,US' },
        ]);
        vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
        vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue(sampleAlerts);
        vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue({
          forecastHours: [
            { interval: { startTime: '2026-04-28T20:00:00Z' }, temperature: { degrees: 12, unit: 'CELSIUS' }, isDaytime: true },
            { interval: { startTime: '2026-04-29T04:00:00Z' }, temperature: { degrees: 6, unit: 'CELSIUS' }, isDaytime: false }, // 22:00 local same day
          ],
        });

        const result = await tools.getWeatherForecast();
        // Pre-formatted in the location's tz (Boise = MDT, UTC-6 in DST).
        // 20:00 UTC = 14:00 MDT same day; 04:00 UTC next day = 22:00 MDT same day.
        const fc = result.forecasts[0];
        expect(fc.hourly_forecast).toHaveLength(2);
        expect(fc.hourly_forecast[0].forecast_start).toMatch(/at 2:00 PM MDT$/);
        expect(fc.hourly_forecast[1].forecast_start).toMatch(/at 10:00 PM MDT$/);
      });

      it('uses the geocoded location\'s timezone for hour filtering and formatting (NYC athlete asks for SF)', async () => {
        // Athlete tz is America/Boise (set in parent beforeEach), but this
        // test simulates the cross-tz case: the geocoded location is in SF,
        // and the timezone client resolves PT for it. Hours filtered to the
        // SF local date and rendered in PDT.
        const mockTz = new GoogleTimezoneClient({ apiKey: 'k' });
        const tools = new CurrentTools(
          mockIntervalsClient,
          mockWhoopClient,
          mockTrainerRoadClient,
          mockGoogleWeatherClient,
          null,
          null,
          null,
          mockGoogleGeocodingClient,
          mockTz
        );
        vi.mocked(mockGoogleGeocodingClient.geocode).mockResolvedValue({
          formattedAddress: 'San Francisco, CA, USA',
          latitude: 37.7749,
          longitude: -122.4194,
        });
        vi.mocked(mockTz.getTimezone).mockResolvedValue('America/Los_Angeles');
        vi.mocked(mockGoogleWeatherClient.getDailyForecast).mockResolvedValue(sampleDailyAt('2026-04-30'));
        vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue({
          forecastHours: [
            // 2026-04-30 in SF (PDT, UTC-7) = 2026-04-30T07:00Z..2026-05-01T06:59Z
            { interval: { startTime: '2026-04-30T07:00:00Z' }, temperature: { degrees: 8, unit: 'CELSIUS' } },  // 00:00 PDT
            { interval: { startTime: '2026-04-30T18:00:00Z' }, temperature: { degrees: 18, unit: 'CELSIUS' } }, // 11:00 PDT
            { interval: { startTime: '2026-05-01T06:00:00Z' }, temperature: { degrees: 11, unit: 'CELSIUS' } }, // 23:00 PDT — the hour that was missing under MDT filtering
            // Different SF date — should be filtered out
            { interval: { startTime: '2026-05-01T07:00:00Z' }, temperature: { degrees: 5, unit: 'CELSIUS' } },
          ],
        });

        const result = await tools.getWeatherForecast({ date: '2026-04-30', location: 'San Francisco, CA' });

        expect(mockTz.getTimezone).toHaveBeenCalledWith(37.7749, -122.4194);
        expect(result.forecasts).toHaveLength(1);
        const fc = result.forecasts[0];
        // All three SF-local hours of 2026-04-30 are kept; tz-incorrect filter would have dropped the 23:00 PDT entry.
        expect(fc.hourly_forecast).toHaveLength(3);
        expect(fc.hourly_forecast[0].forecast_start).toMatch(/at 12:00 AM PDT$/);
        expect(fc.hourly_forecast[1].forecast_start).toMatch(/at 11:00 AM PDT$/);
        expect(fc.hourly_forecast[2].forecast_start).toMatch(/at 11:00 PM PDT$/);
      });

      it('also resolves timezones for Intervals.icu locations (no location arg)', async () => {
        const mockTz = new GoogleTimezoneClient({ apiKey: 'k' });
        const tools = new CurrentTools(
          mockIntervalsClient,
          mockWhoopClient,
          mockTrainerRoadClient,
          mockGoogleWeatherClient,
          null,
          null,
          null,
          null,
          mockTz
        );
        vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
          { id: 1, label: 'Tokyo office', latitude: 35.6762, longitude: 139.6503, location: 'Tokyo,Japan' },
        ]);
        vi.mocked(mockTz.getTimezone).mockResolvedValue('Asia/Tokyo');
        vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
        vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue({ forecastHours: [] });
        vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue({ weatherAlerts: [] });

        const result = await tools.getWeatherForecast();

        expect(mockTz.getTimezone).toHaveBeenCalledWith(35.6762, 139.6503);
        expect(result.forecasts).toHaveLength(1);
        // System time is 2026-04-28T14:49:34Z. In Tokyo (UTC+9) that's 23:49
        // local; in the athlete's tz (Boise, MDT, UTC-6) it's 08:49 local.
        // Confirm `as_of` is rendered in Tokyo time (the location's tz), not Boise.
        expect(result.forecasts[0].current_conditions?.as_of).toMatch(/at 11:49 PM/);
      });

      it('requests enough hourly entries to cover the entire target local day (not just the API default 24)', async () => {
        // System time: 2026-04-28T14:49:34Z (08:49 Boise / America/Boise = MDT).
        // Target: 2026-04-30 in Boise. End of that day local = 2026-05-01 00:00 MDT
        // = 2026-05-01T06:00Z. From now that's roughly 63h17m → ceil to 64.
        const tools = new CurrentTools(
          mockIntervalsClient,
          mockWhoopClient,
          mockTrainerRoadClient,
          mockGoogleWeatherClient
        );
        vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
          { id: 1, label: 'Moose', latitude: 0, longitude: 0, location: 'Moose,Wyoming,US' },
        ]);
        vi.mocked(mockGoogleWeatherClient.getDailyForecast).mockResolvedValue(sampleDailyAt('2026-04-30'));
        vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue({ forecastHours: [] });

        await tools.getWeatherForecast({ date: '2026-04-30' });

        expect(mockGoogleWeatherClient.getHourlyForecast).toHaveBeenCalledTimes(1);
        const call = vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mock.calls[0];
        const hoursRequested = call[2] as number;
        // Must be at least 64 to reach end of 2026-04-30 in MDT; cap is 240.
        expect(hoursRequested).toBeGreaterThanOrEqual(64);
        expect(hoursRequested).toBeLessThanOrEqual(240);
      });

      it('falls back to athlete tz when timezone lookup fails for a location', async () => {
        const mockTz = new GoogleTimezoneClient({ apiKey: 'k' });
        const tools = new CurrentTools(
          mockIntervalsClient,
          mockWhoopClient,
          mockTrainerRoadClient,
          mockGoogleWeatherClient,
          null,
          null,
          null,
          null,
          mockTz
        );
        vi.mocked(mockIntervalsClient.getEnabledWeatherLocations).mockResolvedValue([
          { id: 1, label: 'Boise', latitude: 0, longitude: 0, location: 'Boise,Idaho,US' },
        ]);
        vi.mocked(mockTz.getTimezone).mockRejectedValue(new Error('tz boom'));
        vi.mocked(mockGoogleWeatherClient.getCurrentConditions).mockResolvedValue(sampleCurrent);
        vi.mocked(mockGoogleWeatherClient.getHourlyForecast).mockResolvedValue({ forecastHours: [] });
        vi.mocked(mockGoogleWeatherClient.getWeatherAlerts).mockResolvedValue({ weatherAlerts: [] });

        const result = await tools.getWeatherForecast();
        expect(result.forecasts).toHaveLength(1);
        // Falls back to athlete tz (America/Boise = MDT) for the response formatting.
        expect(result.forecasts[0].current_conditions?.as_of).toMatch(/MDT$/);
      });
    });
  });
});
