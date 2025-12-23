import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoricalTools } from '../../src/tools/historical.js';
import { IntervalsClient } from '../../src/clients/intervals.js';
import { WhoopClient } from '../../src/clients/whoop.js';
import type { NormalizedWorkout, RecoveryData, FitnessMetrics } from '../../src/types/index.js';

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
        activity_type: 'Cycling',
        duration_seconds: 3600,
        tss: 85,
        source: 'intervals.icu',
      },
      {
        id: '2',
        date: '2024-12-12T08:00:00Z',
        activity_type: 'Running',
        duration_seconds: 2400,
        tss: 45,
        source: 'intervals.icu',
      },
    ];

    it('should fetch workouts for ISO date range', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);

      const result = await tools.getWorkoutHistory({
        start_date: '2024-12-01',
        end_date: '2024-12-15',
      });

      expect(result).toEqual(mockWorkouts);
      expect(mockIntervalsClient.getActivities).toHaveBeenCalledWith(
        '2024-12-01',
        '2024-12-15',
        undefined
      );
    });

    it('should parse natural language start date', async () => {
      vi.mocked(mockIntervalsClient.getActivities).mockResolvedValue(mockWorkouts);

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
  });

  describe('getRecoveryTrends', () => {
    const mockRecoveries: RecoveryData[] = [
      {
        date: '2024-12-13',
        recovery_score: 80,
        hrv_rmssd: 60,
        resting_heart_rate: 52,
        sleep_performance_percentage: 85,
        sleep_duration_hours: 7.5,
      },
      {
        date: '2024-12-14',
        recovery_score: 70,
        hrv_rmssd: 55,
        resting_heart_rate: 54,
        sleep_performance_percentage: 75,
        sleep_duration_hours: 6.5,
      },
      {
        date: '2024-12-15',
        recovery_score: 90,
        hrv_rmssd: 70,
        resting_heart_rate: 50,
        sleep_performance_percentage: 95,
        sleep_duration_hours: 8.0,
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
      expect(result.summary.avg_sleep_hours).toBeCloseTo(7.3, 1); // (7.5 + 6.5 + 8.0) / 3
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

  describe('getFitnessProgression', () => {
    const mockMetrics: FitnessMetrics[] = [
      { date: '2024-12-01', ctl: 50, atl: 45, tsb: 5 },
      { date: '2024-12-08', ctl: 55, atl: 60, tsb: -5 },
      { date: '2024-12-15', ctl: 60, atl: 55, tsb: 5 },
    ];

    it('should return fitness data with summary', async () => {
      vi.mocked(mockIntervalsClient.getFitnessMetrics).mockResolvedValue(mockMetrics);

      const result = await tools.getFitnessProgression({
        start_date: '2024-12-01',
        end_date: '2024-12-15',
      });

      expect(result.data).toEqual(mockMetrics);
      expect(result.summary.start_ctl).toBe(50);
      expect(result.summary.end_ctl).toBe(60);
      expect(result.summary.ctl_change).toBe(10);
      expect(result.summary.peak_ctl).toBe(60);
      expect(result.summary.peak_ctl_date).toBe('2024-12-15');
      expect(result.summary.avg_tsb).toBeCloseTo(1.7, 1); // (5 + -5 + 5) / 3
    });

    it('should handle unsorted data', async () => {
      const unsortedMetrics = [
        mockMetrics[2], // 2024-12-15
        mockMetrics[0], // 2024-12-01
        mockMetrics[1], // 2024-12-08
      ];
      vi.mocked(mockIntervalsClient.getFitnessMetrics).mockResolvedValue(unsortedMetrics);

      const result = await tools.getFitnessProgression({
        start_date: '2024-12-01',
      });

      // Should still calculate correctly based on dates
      expect(result.summary.start_ctl).toBe(50);
      expect(result.summary.end_ctl).toBe(60);
    });

    it('should handle empty data', async () => {
      vi.mocked(mockIntervalsClient.getFitnessMetrics).mockResolvedValue([]);

      const result = await tools.getFitnessProgression({
        start_date: '2024-12-01',
      });

      expect(result.data).toEqual([]);
      expect(result.summary.start_ctl).toBe(0);
      expect(result.summary.end_ctl).toBe(0);
      expect(result.summary.ctl_change).toBe(0);
      expect(result.summary.peak_ctl).toBe(0);
      expect(result.summary.peak_ctl_date).toBe('');
    });

    it('should parse natural language dates', async () => {
      vi.mocked(mockIntervalsClient.getFitnessMetrics).mockResolvedValue(mockMetrics);

      await tools.getFitnessProgression({
        start_date: '30 days ago',
      });

      expect(mockIntervalsClient.getFitnessMetrics).toHaveBeenCalledWith(
        '2024-11-15',
        '2024-12-15'
      );
    });
  });
});
