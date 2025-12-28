import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HistoricalTools } from '../../src/tools/historical.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { WhoopClient } from '../../src/clients/whoop.js';
import type {
  NormalizedWorkout,
  WhoopRecoveryTrendEntry,
  StrainActivity,
  WellnessTrends,
  TrainingLoadTrends,
  WorkoutIntervalsResponse,
  WorkoutNotesResponse,
  ActivityPowerCurve,
  ActivityPaceCurve,
  ActivityHRCurve,
} from '../../src/types/index.js';

vi.mock('../../src/clients/intervals.js');
vi.mock('../../src/clients/whoop.js');

describe('HistoricalTools', () => {
  let tools: HistoricalTools;
  let mockIntervalsClient: IntervalsClient;
  let mockWhoopClient: WhoopClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));

    mockIntervalsClient = new IntervalsClient({ apiKey: 'test', athleteId: 'test' });
    mockWhoopClient = new WhoopClient({
      accessToken: 'test',
      refreshToken: 'test',
      clientId: 'test',
      clientSecret: 'test',
    });

    // Default timezone mock for all tests
    vi.mocked(mockIntervalsClient.getAthleteTimezone).mockResolvedValue('UTC');

    tools = new HistoricalTools(mockIntervalsClient, mockWhoopClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getWorkoutHistory', () => {
    const mockWorkouts: NormalizedWorkout[] = [
      {
        id: '1',
        date: '2024-12-10T10:00:00Z',
        start_date_utc: '2024-12-10T10:00:00Z',
        activity_type: 'Cycling',
        duration: '1:00:00',
        tss: 85,
        source: 'intervals.icu',
      },
      {
        id: '2',
        date: '2024-12-12T08:00:00Z',
        start_date_utc: '2024-12-12T08:00:00Z',
        activity_type: 'Running',
        duration: '0:40:00',
        tss: 45,
        source: 'intervals.icu',
      },
    ];

    const mockWhoopActivities: StrainActivity[] = [
      {
        id: 'whoop-1',
        start_time: '2024-12-10T10:01:00Z',
        end_time: '2024-12-10T11:00:00Z',
        activity_type: 'Cycling',
        duration: '0:59:00',
        strain_score: 12.5,
        average_heart_rate: 145,
        max_heart_rate: 175,
        calories: 650,
      },
    ];

    it('should fetch workouts for ISO date range with Whoop matching', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue(mockWhoopActivities);

      const result = await tools.getWorkoutHistory({
        start_date: '2024-12-01',
        end_date: '2024-12-15',
      });

      expect(result).toHaveLength(2);
      // First workout should have matched Whoop data
      expect(result[0].whoop).not.toBeNull();
      expect(result[0].whoop?.strain_score).toBe(12.5);
      // Second workout should not have matched Whoop data
      expect(result[1].whoop).toBeNull();
      expect(mockIntervalsClient.getActivities).toHaveBeenCalledWith(
        '2024-12-01',
        '2024-12-15',
        undefined
      );
    });

    it('should parse natural language start date', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);

      await tools.getWorkoutHistory({
        start_date: '30 days ago',
      });

      expect(mockIntervalsClient.getActivities).toHaveBeenCalledWith(
        '2024-11-15',
        '2024-12-15',
        undefined
      );
    });

    it('should default end_date to today', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);

      await tools.getWorkoutHistory({
        start_date: '2024-12-01',
      });

      expect(mockIntervalsClient.getActivities).toHaveBeenCalledWith(
        '2024-12-01',
        '2024-12-15',
        undefined
      );
    });

    it('should pass sport filter', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue([mockWorkouts[0]]);
      vi.mocked(mockWhoopClient.getWorkouts).mockResolvedValue([]);

      await tools.getWorkoutHistory({
        start_date: '2024-12-01',
        sport: 'cycling',
      });

      expect(mockIntervalsClient.getActivities).toHaveBeenCalledWith(
        '2024-12-01',
        '2024-12-15',
        'cycling'
      );
    });

    it('should return workouts without Whoop data when Whoop client is not configured', async () => {
      const toolsWithoutWhoop = new HistoricalTools(mockIntervalsClient, null);
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);

      const result = await toolsWithoutWhoop.getWorkoutHistory({
        start_date: '2024-12-01',
      });

      expect(result).toHaveLength(2);
      expect(result[0].whoop).toBeNull();
      expect(result[1].whoop).toBeNull();
    });
  });

  describe('getRecoveryTrends', () => {
    const mockRecoveries: WhoopRecoveryTrendEntry[] = [
      {
        date: '2024-12-13',
        sleep: {
          sleep_summary: {
            total_in_bed_time: '8:00:00',
            total_awake_time: '0:30:00',
            total_no_data_time: '0:00:00',
            total_light_sleep_time: '3:30:00',
            total_slow_wave_sleep_time: '2:00:00',
            total_rem_sleep_time: '2:00:00',
            total_restorative_sleep: '4:00:00',
            sleep_cycle_count: 4,
            disturbance_count: 2,
          },
          sleep_needed: {
            total_sleep_needed: '7:30:00',
            baseline: '7:00:00',
            need_from_sleep_debt: '0:15:00',
            need_from_recent_strain: '0:15:00',
            need_from_recent_nap: '0:00:00',
          },
          sleep_performance_percentage: 85,
          sleep_performance_level: 'OPTIMAL',
          sleep_performance_level_description: 'Optimal sleep',
        },
        recovery: {
          recovery_score: 80,
          hrv_rmssd: 60,
          resting_heart_rate: 52,
          recovery_level: 'SUFFICIENT',
          recovery_level_description: 'Sufficient recovery',
        },
      },
      {
        date: '2024-12-14',
        sleep: {
          sleep_summary: {
            total_in_bed_time: '7:00:00',
            total_awake_time: '0:30:00',
            total_no_data_time: '0:00:00',
            total_light_sleep_time: '3:00:00',
            total_slow_wave_sleep_time: '1:30:00',
            total_rem_sleep_time: '2:00:00',
            total_restorative_sleep: '3:30:00',
            sleep_cycle_count: 3,
            disturbance_count: 4,
          },
          sleep_needed: {
            total_sleep_needed: '7:30:00',
            baseline: '7:00:00',
            need_from_sleep_debt: '0:20:00',
            need_from_recent_strain: '0:10:00',
            need_from_recent_nap: '0:00:00',
          },
          sleep_performance_percentage: 75,
          sleep_performance_level: 'SUFFICIENT',
          sleep_performance_level_description: 'Sufficient sleep',
        },
        recovery: {
          recovery_score: 70,
          hrv_rmssd: 55,
          resting_heart_rate: 54,
          recovery_level: 'ADEQUATE',
          recovery_level_description: 'Adequate recovery',
        },
      },
      {
        date: '2024-12-15',
        sleep: {
          sleep_summary: {
            total_in_bed_time: '8:30:00',
            total_awake_time: '0:30:00',
            total_no_data_time: '0:00:00',
            total_light_sleep_time: '4:00:00',
            total_slow_wave_sleep_time: '2:00:00',
            total_rem_sleep_time: '2:00:00',
            total_restorative_sleep: '4:00:00',
            sleep_cycle_count: 4,
            disturbance_count: 1,
          },
          sleep_needed: {
            total_sleep_needed: '7:30:00',
            baseline: '7:00:00',
            need_from_sleep_debt: '0:15:00',
            need_from_recent_strain: '0:15:00',
            need_from_recent_nap: '0:00:00',
          },
          sleep_performance_percentage: 95,
          sleep_performance_level: 'OPTIMAL',
          sleep_performance_level_description: 'Optimal sleep',
        },
        recovery: {
          recovery_score: 90,
          hrv_rmssd: 70,
          resting_heart_rate: 50,
          recovery_level: 'SUFFICIENT',
          recovery_level_description: 'Sufficient recovery',
        },
      },
    ];

    it('should return recovery data with summary', async () => {
      vi.mocked(mockWhoopClient.getRecoveries).mockResolvedValue(mockRecoveries);

      const result = await tools.getRecoveryTrends({
        start_date: '2024-12-13',
        end_date: '2024-12-15',
      });

      expect(result.data).toEqual(mockRecoveries);
      expect(result.summary.avg_recovery).toBe(80); // (80 + 70 + 90) / 3
      expect(result.summary.avg_hrv).toBeCloseTo(61.7, 1); // (60 + 55 + 70) / 3
      expect(result.summary.avg_sleep_hours).toBeCloseTo(7.8, 1); // (8 + 7 + 8.5) / 3 based on total_in_bed_time
      expect(result.summary.min_recovery).toBe(70);
      expect(result.summary.max_recovery).toBe(90);
    });

    it('should return empty summary when no Whoop client', async () => {
      const toolsWithoutWhoop = new HistoricalTools(mockIntervalsClient, null);

      const result = await toolsWithoutWhoop.getRecoveryTrends({
        start_date: '2024-12-13',
      });

      expect(result.data).toEqual([]);
      expect(result.summary.avg_recovery).toBe(0);
    });

    it('should handle empty recovery data', async () => {
      vi.mocked(mockWhoopClient.getRecoveries).mockResolvedValue([]);

      const result = await tools.getRecoveryTrends({
        start_date: '2024-12-13',
      });

      expect(result.data).toEqual([]);
      expect(result.summary.avg_recovery).toBe(0);
      expect(result.summary.min_recovery).toBe(0);
      expect(result.summary.max_recovery).toBe(0);
    });
  });

  describe('getWellnessTrends', () => {
    // Full wellness data (as returned from API)
    const mockWellnessTrendsFull: WellnessTrends = {
      period_days: 7,
      start_date: '2024-12-08',
      end_date: '2024-12-15',
      data: [
        {
          date: '2024-12-08',
          weight: '74.5 kg',
          resting_hr: 52,
          hrv: 38.5,
          sleep_duration: '7h 30m',
          sleep_score: 85,
          sleep_quality: 1,
          soreness: 2,
          fatigue: 2,
          readiness: 70,
        },
        {
          date: '2024-12-10',
          weight: '74.3 kg',
          resting_hr: 50,
          hrv: 42.1,
          sleep_duration: '8h 15m',
          sleep_score: 92,
          sleep_quality: 1,
          soreness: 1,
          fatigue: 1,
          readiness: 85,
        },
        {
          date: '2024-12-12',
          weight: '74.8 kg',
          resting_hr: 55,
          hrv: 32.8,
          sleep_duration: '6h 45m',
          sleep_score: 72,
          sleep_quality: 2,
          soreness: 3,
          fatigue: 3,
          readiness: 55,
        },
        {
          date: '2024-12-15',
          weight: '74.6 kg',
          resting_hr: 51,
          hrv: 35.5,
          sleep_duration: '8h 0m',
          sleep_score: 87,
          sleep_quality: 1,
          soreness: 1,
          fatigue: 2,
          readiness: 65,
        },
      ],
    };

    // Expected filtered wellness (Whoop-duplicate fields removed)
    const mockWellnessTrendsFiltered: WellnessTrends = {
      period_days: 7,
      start_date: '2024-12-08',
      end_date: '2024-12-15',
      data: [
        {
          date: '2024-12-08',
          weight: '74.5 kg',
          soreness: 2,
          fatigue: 2,
        },
        {
          date: '2024-12-10',
          weight: '74.3 kg',
          soreness: 1,
          fatigue: 1,
        },
        {
          date: '2024-12-12',
          weight: '74.8 kg',
          soreness: 3,
          fatigue: 3,
        },
        {
          date: '2024-12-15',
          weight: '74.6 kg',
          soreness: 1,
          fatigue: 2,
        },
      ],
    };

    it('should return wellness trends with Whoop-duplicate fields filtered when Whoop is connected', async () => {
      vi.mocked(mockIntervalsClient.getWellnessTrends).mockResolvedValue(mockWellnessTrendsFull);

      const result = await tools.getWellnessTrends({
        start_date: '2024-12-08',
        end_date: '2024-12-15',
      });

      // Whoop-duplicate fields are filtered when Whoop is connected
      expect(result).toEqual(mockWellnessTrendsFiltered);
      expect(result.period_days).toBe(7);
      expect(result.data).toHaveLength(4);
      expect(mockIntervalsClient.getWellnessTrends).toHaveBeenCalledWith('2024-12-08', '2024-12-15');
    });

    it('should filter Whoop-duplicate fields from wellness trends', async () => {
      vi.mocked(mockIntervalsClient.getWellnessTrends).mockResolvedValue(mockWellnessTrendsFull);

      const result = await tools.getWellnessTrends({
        start_date: '2024-12-08',
        end_date: '2024-12-15',
      });

      const firstEntry = result.data[0];
      expect(firstEntry.date).toBe('2024-12-08');
      // Non-duplicate fields are present
      expect(firstEntry.weight).toBe('74.5 kg');
      expect(firstEntry.soreness).toBe(2);
      expect(firstEntry.fatigue).toBe(2);
      // Whoop-duplicate fields are filtered
      expect(firstEntry.resting_hr).toBeUndefined();
      expect(firstEntry.hrv).toBeUndefined();
      expect(firstEntry.sleep_duration).toBeUndefined();
      expect(firstEntry.sleep_score).toBeUndefined();
      expect(firstEntry.sleep_quality).toBeUndefined();
      expect(firstEntry.readiness).toBeUndefined();
      expect(firstEntry.respiration).toBeUndefined();
      expect(firstEntry.spo2).toBeUndefined();
    });

    it('should return full wellness trends when Whoop is not connected', async () => {
      const toolsWithoutWhoop = new HistoricalTools(mockIntervalsClient, null);
      vi.mocked(mockIntervalsClient.getWellnessTrends).mockResolvedValue(mockWellnessTrendsFull);

      const result = await toolsWithoutWhoop.getWellnessTrends({
        start_date: '2024-12-08',
        end_date: '2024-12-15',
      });

      // Full wellness data when Whoop is not connected
      expect(result).toEqual(mockWellnessTrendsFull);
      expect(result.data[0].resting_hr).toBe(52);
      expect(result.data[0].hrv).toBe(38.5);
      expect(result.data[0].sleep_duration).toBe('7h 30m');
    });

    it('should parse natural language start date', async () => {
      vi.mocked(mockIntervalsClient.getWellnessTrends).mockResolvedValue(mockWellnessTrendsFull);

      await tools.getWellnessTrends({
        start_date: '7 days ago',
      });

      expect(mockIntervalsClient.getWellnessTrends).toHaveBeenCalledWith('2024-12-08', '2024-12-15');
    });

    it('should default end_date to today', async () => {
      vi.mocked(mockIntervalsClient.getWellnessTrends).mockResolvedValue(mockWellnessTrendsFull);

      await tools.getWellnessTrends({
        start_date: '2024-12-08',
      });

      expect(mockIntervalsClient.getWellnessTrends).toHaveBeenCalledWith('2024-12-08', '2024-12-15');
    });

    it('should handle empty wellness data', async () => {
      const emptyTrends: WellnessTrends = {
        period_days: 7,
        start_date: '2024-12-08',
        end_date: '2024-12-15',
        data: [],
      };
      vi.mocked(mockIntervalsClient.getWellnessTrends).mockResolvedValue(emptyTrends);

      const result = await tools.getWellnessTrends({
        start_date: '2024-12-08',
      });

      expect(result.data).toEqual([]);
      expect(result.period_days).toBe(7);
    });

    it('should filter entries that only have Whoop-duplicate fields', async () => {
      // When entries only have Whoop-duplicate fields, they should be filtered out entirely
      const partialTrends: WellnessTrends = {
        period_days: 3,
        start_date: '2024-12-13',
        end_date: '2024-12-15',
        data: [
          { date: '2024-12-13', weight: '74.2 kg' },
          { date: '2024-12-14', resting_hr: 53, hrv: 40.2 }, // Only Whoop-duplicate fields
          { date: '2024-12-15', weight: '74.5 kg', sleep_duration: '7h 45m', sleep_score: 88 },
        ],
      };
      vi.mocked(mockIntervalsClient.getWellnessTrends).mockResolvedValue(partialTrends);

      const result = await tools.getWellnessTrends({
        start_date: '2024-12-13',
        end_date: '2024-12-15',
      });

      // Entry with only Whoop-duplicate fields is filtered out
      expect(result.data).toHaveLength(2);
      expect(result.data[0].date).toBe('2024-12-13');
      expect(result.data[0].weight).toBe('74.2 kg');
      expect(result.data[1].date).toBe('2024-12-15');
      expect(result.data[1].weight).toBe('74.5 kg');
      expect(result.data[1].sleep_duration).toBeUndefined();
    });
  });

  describe('getTrainingLoadTrends', () => {
    const mockTrainingLoadTrends: TrainingLoadTrends = {
      period_days: 42,
      sport: 'all',
      data: [
        { date: '2024-12-01', ctl: 50, atl: 45, tsb: 5, ramp_rate: 3, ctl_load: 40, atl_load: 60 },
        { date: '2024-12-15', ctl: 55, atl: 50, tsb: 5, ramp_rate: 4, ctl_load: 45, atl_load: 65 },
      ],
      summary: {
        current_ctl: 55,
        current_atl: 50,
        current_tsb: 5,
        ctl_trend: 'increasing',
        avg_ramp_rate: 3.5,
        peak_ctl: 55,
        peak_ctl_date: '2024-12-15',
        acwr: 0.91,
        acwr_status: 'optimal',
      },
    };

    it('should fetch training load trends with default days', async () => {
      vi.mocked(mockIntervalsClient.getTrainingLoadTrends).mockResolvedValue(mockTrainingLoadTrends);

      const result = await tools.getTrainingLoadTrends();

      expect(result).toEqual(mockTrainingLoadTrends);
      expect(mockIntervalsClient.getTrainingLoadTrends).toHaveBeenCalledWith(42);
    });

    it('should fetch training load trends with custom days', async () => {
      vi.mocked(mockIntervalsClient.getTrainingLoadTrends).mockResolvedValue(mockTrainingLoadTrends);

      const result = await tools.getTrainingLoadTrends(90);

      expect(result).toEqual(mockTrainingLoadTrends);
      expect(mockIntervalsClient.getTrainingLoadTrends).toHaveBeenCalledWith(90);
    });

    it('should propagate errors from client', async () => {
      vi.mocked(mockIntervalsClient.getTrainingLoadTrends).mockRejectedValue(new Error('API error'));

      await expect(tools.getTrainingLoadTrends()).rejects.toThrow('API error');
    });
  });

  describe('getWorkoutIntervals', () => {
    const mockIntervalsResponse: WorkoutIntervalsResponse = {
      activity_id: 'i12345',
      intervals: [
        {
          type: 'WORK',
          label: 'Interval 1',
          start_seconds: 600,
          duration: '0:04:00',
          average_watts: 300,
          max_watts: 350,
          average_hr: 165,
          max_hr: 175,
          power_zone: 4,
        },
        {
          type: 'RECOVERY',
          start_seconds: 840,
          duration: '0:02:00',
          average_watts: 150,
          average_hr: 120,
          power_zone: 1,
        },
      ],
      groups: [
        {
          id: '4min@300w165hr',
          count: 5,
          average_watts: 300,
          average_hr: 165,
          duration: '0:04:00',
        },
      ],
    };

    it('should fetch workout intervals for activity', async () => {
      vi.mocked(mockIntervalsClient.getActivityIntervals).mockResolvedValue(mockIntervalsResponse);

      const result = await tools.getWorkoutIntervals('i12345');

      expect(result).toEqual(mockIntervalsResponse);
      expect(result.activity_id).toBe('i12345');
      expect(result.intervals).toHaveLength(2);
      expect(result.groups).toHaveLength(1);
      expect(mockIntervalsClient.getActivityIntervals).toHaveBeenCalledWith('i12345');
    });

    it('should propagate errors from client', async () => {
      vi.mocked(mockIntervalsClient.getActivityIntervals).mockRejectedValue(new Error('Activity not found'));

      await expect(tools.getWorkoutIntervals('invalid-id')).rejects.toThrow('Activity not found');
    });
  });

  describe('getWorkoutNotes', () => {
    const mockNotesResponse: WorkoutNotesResponse = {
      activity_id: 'i12345',
      notes: [
        {
          id: 1,
          athlete_id: 'athlete-1',
          name: 'John Doe',
          created: '2024-12-15T10:00:00Z',
          type: 'TEXT',
          content: 'Felt strong today, legs were fresh after rest day.',
        },
        {
          id: 2,
          athlete_id: 'athlete-1',
          name: 'John Doe',
          created: '2024-12-15T11:00:00Z',
          type: 'TEXT',
          content: 'Power numbers were great on the intervals.',
        },
      ],
    };

    it('should fetch workout notes for activity', async () => {
      vi.mocked(mockIntervalsClient.getActivityNotes).mockResolvedValue(mockNotesResponse);

      const result = await tools.getWorkoutNotes('i12345');

      expect(result).toEqual(mockNotesResponse);
      expect(result.activity_id).toBe('i12345');
      expect(result.notes).toHaveLength(2);
      expect(result.notes[0].content).toContain('Felt strong today');
      expect(mockIntervalsClient.getActivityNotes).toHaveBeenCalledWith('i12345');
    });

    it('should return empty notes array when no notes exist', async () => {
      vi.mocked(mockIntervalsClient.getActivityNotes).mockResolvedValue({
        activity_id: 'i12345',
        notes: [],
      });

      const result = await tools.getWorkoutNotes('i12345');

      expect(result.notes).toEqual([]);
    });

    it('should propagate errors from client', async () => {
      vi.mocked(mockIntervalsClient.getActivityNotes).mockRejectedValue(new Error('API error'));

      await expect(tools.getWorkoutNotes('i12345')).rejects.toThrow('API error');
    });
  });

  describe('getWorkoutWeather', () => {
    it('should fetch workout weather for activity', async () => {
      vi.mocked(mockIntervalsClient.getActivityWeather).mockResolvedValue({
        activity_id: 'i12345',
        weather_description: 'Sunny, 22°C, light wind from NW at 10 km/h',
      });

      const result = await tools.getWorkoutWeather('i12345');

      expect(result.activity_id).toBe('i12345');
      expect(result.weather_description).toContain('Sunny');
      expect(mockIntervalsClient.getActivityWeather).toHaveBeenCalledWith('i12345');
    });

    it('should return null weather for indoor activities', async () => {
      vi.mocked(mockIntervalsClient.getActivityWeather).mockResolvedValue({
        activity_id: 'i12345',
        weather_description: null,
      });

      const result = await tools.getWorkoutWeather('i12345');

      expect(result.weather_description).toBeNull();
    });

    it('should propagate errors from client', async () => {
      vi.mocked(mockIntervalsClient.getActivityWeather).mockRejectedValue(new Error('API error'));

      await expect(tools.getWorkoutWeather('i12345')).rejects.toThrow('API error');
    });
  });

  describe('getPowerCurve', () => {
    const mockPowerCurveActivities: ActivityPowerCurve[] = [
      {
        activity_id: 'i12345',
        date: '2024-12-10',
        weight_kg: 75,
        curve: [
          { duration_seconds: 5, duration_label: '5s', watts: 900, watts_per_kg: 12 },
          { duration_seconds: 30, duration_label: '30s', watts: 600, watts_per_kg: 8 },
          { duration_seconds: 60, duration_label: '1min', watts: 450, watts_per_kg: 6 },
          { duration_seconds: 300, duration_label: '5min', watts: 350, watts_per_kg: 4.67 },
          { duration_seconds: 1200, duration_label: '20min', watts: 300, watts_per_kg: 4 },
          { duration_seconds: 3600, duration_label: '60min', watts: 270, watts_per_kg: 3.6 },
          { duration_seconds: 7200, duration_label: '2hr', watts: 240, watts_per_kg: 3.2 },
        ],
      },
    ];

    it('should fetch power curve with summary', async () => {
      vi.mocked(mockIntervalsClient.getPowerCurves).mockResolvedValue({
        durations: [5, 30, 60, 300, 1200, 3600, 7200],
        activities: mockPowerCurveActivities,
      });

      const result = await tools.getPowerCurve({
        start_date: '2024-12-01',
        end_date: '2024-12-15',
      });

      expect(result.period_start).toBe('2024-12-01');
      expect(result.period_end).toBe('2024-12-15');
      expect(result.sport).toBe('cycling');
      expect(result.activity_count).toBe(1);
      expect(result.summary.best_5s).toBeDefined();
      expect(result.summary.best_5s?.watts).toBe(900);
      expect(result.summary.best_20min?.watts).toBe(300);
      expect(result.summary.estimated_ftp).toBe(285); // 300 * 0.95
    });

    it('should parse natural language dates', async () => {
      vi.mocked(mockIntervalsClient.getPowerCurves).mockResolvedValue({
        durations: [5, 30, 60, 300, 1200, 3600, 7200],
        activities: mockPowerCurveActivities,
      });

      await tools.getPowerCurve({
        start_date: '90 days ago',
      });

      expect(mockIntervalsClient.getPowerCurves).toHaveBeenCalledWith(
        '2024-09-16',
        '2024-12-15',
        'Ride',
        [5, 30, 60, 300, 1200, 3600, 7200]
      );
    });

    it('should handle custom durations', async () => {
      vi.mocked(mockIntervalsClient.getPowerCurves).mockResolvedValue({
        durations: [10, 120],
        activities: [],
      });

      await tools.getPowerCurve({
        start_date: '2024-12-01',
        durations: [10, 120],
      });

      expect(mockIntervalsClient.getPowerCurves).toHaveBeenCalledWith(
        '2024-12-01',
        '2024-12-15',
        'Ride',
        [10, 120]
      );
    });

    it('should include comparison when compare_to params provided', async () => {
      vi.mocked(mockIntervalsClient.getPowerCurves)
        .mockResolvedValueOnce({
          durations: [5, 30, 60, 300, 1200, 3600, 7200],
          activities: mockPowerCurveActivities,
        })
        .mockResolvedValueOnce({
          durations: [5, 30, 60, 300, 1200, 3600, 7200],
          activities: [
            {
              ...mockPowerCurveActivities[0],
              curve: mockPowerCurveActivities[0].curve.map((p) => ({
                ...p,
                watts: p.watts - 20,
                watts_per_kg: p.watts_per_kg - 0.2,
              })),
            },
          ],
        });

      const result = await tools.getPowerCurve({
        start_date: '2024-12-01',
        end_date: '2024-12-15',
        compare_to_start: '2024-11-01',
        compare_to_end: '2024-11-15',
      });

      expect(result.comparison).toBeDefined();
      expect(result.comparison?.previous_period_start).toBe('2024-11-01');
      expect(result.comparison?.previous_period_end).toBe('2024-11-15');
      expect(result.comparison?.changes.length).toBeGreaterThan(0);
      expect(result.comparison?.changes[0].improved).toBe(true);
    });

    it('should handle empty activities', async () => {
      vi.mocked(mockIntervalsClient.getPowerCurves).mockResolvedValue({
        durations: [5, 30, 60, 300, 1200, 3600, 7200],
        activities: [],
      });

      const result = await tools.getPowerCurve({
        start_date: '2024-12-01',
      });

      expect(result.activity_count).toBe(0);
      expect(result.summary.best_5s).toBeNull();
      expect(result.summary.estimated_ftp).toBeNull();
    });
  });

  describe('getPaceCurve', () => {
    const mockRunningPaceActivities: ActivityPaceCurve[] = [
      {
        activity_id: 'i12346',
        date: '2024-12-10',
        weight_kg: 75,
        curve: [
          { distance_meters: 400, distance_label: '400m', time_seconds: 90, pace: '3:45/km' },
          { distance_meters: 1000, distance_label: '1km', time_seconds: 240, pace: '4:00/km' },
          { distance_meters: 1609, distance_label: 'mile', time_seconds: 400, pace: '4:08/km' },
          { distance_meters: 5000, distance_label: '5km', time_seconds: 1200, pace: '4:00/km' },
        ],
      },
    ];

    it('should fetch running pace curve with summary', async () => {
      vi.mocked(mockIntervalsClient.getPaceCurves).mockResolvedValue({
        distances: [400, 1000, 1609, 5000],
        gap_adjusted: false,
        activities: mockRunningPaceActivities,
      });

      const result = await tools.getPaceCurve({
        start_date: '2024-12-01',
        sport: 'running',
      });

      expect(result.period_start).toBe('2024-12-01');
      expect(result.sport).toBe('running');
      expect(result.gap_adjusted).toBe(false);
      expect(result.summary.best_400m).toBeDefined();
      expect(result.summary.best_400m?.time_seconds).toBe(90);
      expect(result.summary.best_1km?.pace).toBe('4:00/km');
    });

    it('should fetch swimming pace curve', async () => {
      const mockSwimmingActivities: ActivityPaceCurve[] = [
        {
          activity_id: 'i12347',
          date: '2024-12-10',
          weight_kg: 75,
          curve: [
            { distance_meters: 100, distance_label: '100m', time_seconds: 90, pace: '1:30/100m' },
            { distance_meters: 200, distance_label: '200m', time_seconds: 200, pace: '1:40/100m' },
          ],
        },
      ];

      vi.mocked(mockIntervalsClient.getPaceCurves).mockResolvedValue({
        distances: [100, 200],
        gap_adjusted: false,
        activities: mockSwimmingActivities,
      });

      const result = await tools.getPaceCurve({
        start_date: '2024-12-01',
        sport: 'swimming',
      });

      expect(result.sport).toBe('swimming');
      expect(result.summary.best_100m).toBeDefined();
      expect(result.summary.best_100m?.time_seconds).toBe(90);
      // Running-specific fields should not be in swimming response
      expect(result.summary.best_400m).toBeUndefined();
    });

    it('should use GAP when specified for running', async () => {
      vi.mocked(mockIntervalsClient.getPaceCurves).mockResolvedValue({
        distances: [400, 1000],
        gap_adjusted: true,
        activities: mockRunningPaceActivities,
      });

      const result = await tools.getPaceCurve({
        start_date: '2024-12-01',
        sport: 'running',
        gap: true,
      });

      expect(result.gap_adjusted).toBe(true);
      expect(mockIntervalsClient.getPaceCurves).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'Run',
        expect.any(Array),
        true
      );
    });

    it('should include comparison when compare_to params provided', async () => {
      vi.mocked(mockIntervalsClient.getPaceCurves)
        .mockResolvedValueOnce({
          distances: [400, 1000],
          gap_adjusted: false,
          activities: mockRunningPaceActivities,
        })
        .mockResolvedValueOnce({
          distances: [400, 1000],
          gap_adjusted: false,
          activities: [
            {
              ...mockRunningPaceActivities[0],
              curve: mockRunningPaceActivities[0].curve.map((p) => ({
                ...p,
                time_seconds: p.time_seconds + 10, // Slower previous period
              })),
            },
          ],
        });

      const result = await tools.getPaceCurve({
        start_date: '2024-12-01',
        sport: 'running',
        compare_to_start: '2024-11-01',
        compare_to_end: '2024-11-15',
      });

      expect(result.comparison).toBeDefined();
      expect(result.comparison?.changes[0].improved).toBe(true); // Faster now
    });
  });

  describe('getHRCurve', () => {
    const mockHRActivities: ActivityHRCurve[] = [
      {
        activity_id: 'i12348',
        date: '2024-12-10',
        curve: [
          { duration_seconds: 5, duration_label: '5s', bpm: 190 },
          { duration_seconds: 30, duration_label: '30s', bpm: 185 },
          { duration_seconds: 60, duration_label: '1min', bpm: 180 },
          { duration_seconds: 300, duration_label: '5min', bpm: 170 },
          { duration_seconds: 1200, duration_label: '20min', bpm: 165 },
          { duration_seconds: 3600, duration_label: '60min', bpm: 155 },
          { duration_seconds: 7200, duration_label: '2hr', bpm: 145 },
        ],
      },
    ];

    it('should fetch HR curve with summary', async () => {
      vi.mocked(mockIntervalsClient.getHRCurves).mockResolvedValue({
        durations: [5, 30, 60, 300, 1200, 3600, 7200],
        activities: mockHRActivities,
      });

      const result = await tools.getHRCurve({
        start_date: '2024-12-01',
      });

      expect(result.period_start).toBe('2024-12-01');
      expect(result.sport).toBeNull(); // No sport filter
      expect(result.summary.max_5s?.bpm).toBe(190);
      expect(result.summary.max_20min?.bpm).toBe(165);
    });

    it('should filter by sport', async () => {
      vi.mocked(mockIntervalsClient.getHRCurves).mockResolvedValue({
        durations: [5, 30, 60, 300, 1200, 3600, 7200],
        activities: mockHRActivities,
      });

      const result = await tools.getHRCurve({
        start_date: '2024-12-01',
        sport: 'cycling',
      });

      expect(result.sport).toBe('cycling');
      expect(mockIntervalsClient.getHRCurves).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'Ride',
        expect.any(Array)
      );
    });

    it('should include comparison when compare_to params provided', async () => {
      vi.mocked(mockIntervalsClient.getHRCurves)
        .mockResolvedValueOnce({
          durations: [5, 30, 60, 300, 1200, 3600, 7200],
          activities: mockHRActivities,
        })
        .mockResolvedValueOnce({
          durations: [5, 30, 60, 300, 1200, 3600, 7200],
          activities: [
            {
              ...mockHRActivities[0],
              curve: mockHRActivities[0].curve.map((p) => ({
                ...p,
                bpm: p.bpm - 5,
              })),
            },
          ],
        });

      const result = await tools.getHRCurve({
        start_date: '2024-12-01',
        compare_to_start: '2024-11-01',
        compare_to_end: '2024-11-15',
      });

      expect(result.comparison).toBeDefined();
      expect(result.comparison?.changes[0].change_bpm).toBe(5); // 190 - 185
    });

    it('should handle empty activities', async () => {
      vi.mocked(mockIntervalsClient.getHRCurves).mockResolvedValue({
        durations: [5, 30, 60, 300, 1200, 3600, 7200],
        activities: [],
      });

      const result = await tools.getHRCurve({
        start_date: '2024-12-01',
      });

      expect(result.activity_count).toBe(0);
      expect(result.summary.max_5s).toBeNull();
    });
  });

  describe('error handling across methods', () => {
    it('should handle Whoop errors gracefully in getWorkoutHistory', async () => {
      const mockWorkouts: NormalizedWorkout[] = [
        {
          id: '1',
          date: '2024-12-10T10:00:00Z',
          start_date_utc: '2024-12-10T10:00:00Z',
          activity_type: 'Cycling',
          duration: '1:00:00',
          source: 'intervals.icu',
        },
      ];

      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);
      vi.mocked(mockWhoopClient.getWorkouts).mockRejectedValue(new Error('Whoop API down'));

      // Should not throw, just return workouts without Whoop data
      const result = await tools.getWorkoutHistory({
        start_date: '2024-12-01',
      });

      expect(result).toHaveLength(1);
      expect(result[0].whoop).toBeNull();
    });
  });
});
