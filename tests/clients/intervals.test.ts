import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IntervalsClient } from '../../src/clients/intervals.js';

describe('IntervalsClient', () => {
  let client: IntervalsClient;
  const mockFetch = vi.fn();

  beforeEach(() => {
    client = new IntervalsClient({
      apiKey: 'test-api-key',
      athleteId: 'i12345',
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  describe('constructor', () => {
    it('should create client with correct auth header', () => {
      // The auth header is tested implicitly via the fetch calls
      expect(client).toBeInstanceOf(IntervalsClient);
    });
  });

  describe('getActivities', () => {
    // Realistic mock based on actual Intervals.icu API response
    const mockActivities = [
      {
        id: 'i113367711',
        start_date_local: '2025-12-22T16:54:12',
        start_date: '2025-12-22T23:54:12Z',
        type: 'VirtualRide',
        name: 'Zwift - TrainerRoad: Klammspitze on Petit Boucle in France',
        description: null,
        moving_time: 7236,
        elapsed_time: 7238,
        distance: 65530.26,
        icu_training_load: 86,
        icu_intensity: 65.5914,
        weighted_avg_watts: 183,
        average_watts: 181,
        average_heartrate: 135,
        max_heartrate: 152,
        total_elevation_gain: 480,
        calories: 1248,
        average_speed: 9.052,
        max_speed: 17.805,
        coasting_time: 32,
        icu_rpe: 3,
        feel: null,
        trainer: true,
        commute: false,
        race: false,
        icu_hr_zones: [138, 154, 160, 171, 176, 181, 190],
        icu_power_zones: [55, 75, 90, 105, 120, 150, 999],
        pace_zones: null,
        icu_zone_times: [
          { id: 'Z1', secs: 571 },
          { id: 'Z2', secs: 6524 },
          { id: 'Z3', secs: 141 },
          { id: 'Z4', secs: 0 },
          { id: 'Z5', secs: 0 },
          { id: 'Z6', secs: 0 },
          { id: 'Z7', secs: 0 },
          { id: 'SS', secs: 8 },
        ],
        icu_hr_zone_times: [4536, 2700, 0, 0, 0, 0, 0],
        pace_zone_times: null,
        icu_joules_above_ftp: 0,
        icu_max_wbal_depletion: 0,
        polarization_index: 0,
        gap: null,
        average_stride: null,
        average_altitude: 25.928112,
        min_altitude: 10.4,
        max_altitude: 120.8,
        average_temp: null,
        min_temp: null,
        max_temp: null,
        session_rpe: 361,
        strain_score: 118.56503,
        device_name: 'ZWIFT',
        power_meter: null,
        trimp: 145.78423,
        icu_ftp: 279,
        icu_eftp: null,
        icu_pm_ftp: 195,
        joules: 1307298,
        carbs_used: 241,
        carbs_ingested: null,
        ctl: 63.477615,
        atl: 49.264656,
        average_cadence: 91.98834,
        max_cadence: null,
        variability_index: 1.0110497,
        decoupling: -0.95401156,
        efficiency_factor: 1.3555555,
        icu_lap_count: 17,
        workout_doc: { class: 'Endurance' },
      },
      {
        id: 'act2',
        start_date_local: '2024-12-14T08:00:00',
        start_date: '2024-12-14T15:00:00Z',
        type: 'Run',
        name: 'Easy Run',
        moving_time: 2400,
        distance: 8000,
        icu_training_load: 45,
        average_heartrate: 140,
        trainer: false,
        commute: false,
        race: false,
      },
    ];

    it('should fetch activities for date range', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivities),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('/athlete/i12345/activities');
      expect(callUrl).toContain('oldest=2024-12-14');
      expect(callUrl).toContain('newest=2024-12-15');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('i113367711');
      expect(result[0].activity_type).toBe('Cycling');
      expect(result[0].duration_seconds).toBe(7236);
      expect(result[0].distance_km).toBeCloseTo(65.53, 2);
      expect(result[0].source).toBe('intervals.icu');
    });

    it('should include UTC timestamp for cross-platform matching', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivities),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].date).toBe('2025-12-22T16:54:12'); // local time
      expect(result[0].start_date_utc).toBe('2025-12-22T23:54:12Z'); // UTC
    });

    it('should include activity context flags', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivities),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].is_indoor).toBe(true);
      expect(result[0].is_commute).toBe(false);
      expect(result[0].is_race).toBe(false);
    });

    it('should include zone thresholds and time in zones', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivities),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].hr_zones).toEqual([138, 154, 160, 171, 176, 181, 190]);
      expect(result[0].power_zones).toEqual([55, 75, 90, 105, 120, 150, 999]);
      expect(result[0].power_zone_times).toHaveLength(8);
      expect(result[0].power_zone_times?.[0]).toEqual({ zone_id: 'Z1', seconds: 571 });
      expect(result[0].power_zone_times?.[7]).toEqual({ zone_id: 'SS', seconds: 8 });
      expect(result[0].hr_zone_times).toEqual([4536, 2700, 0, 0, 0, 0, 0]);
    });

    it('should include advanced power and session metrics', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivities),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].joules_above_ftp).toBe(0);
      expect(result[0].max_wbal_depletion).toBe(0);
      expect(result[0].polarization_index).toBe(0);
      expect(result[0].session_rpe).toBe(361);
      expect(result[0].strain_score).toBeCloseTo(118.565, 2);
      expect(result[0].device_name).toBe('ZWIFT');
    });

    it('should include altitude data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivities),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].average_altitude_m).toBeCloseTo(25.93, 2);
      expect(result[0].min_altitude_m).toBe(10.4);
      expect(result[0].max_altitude_m).toBe(120.8);
    });

    it('should filter by sport when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivities),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15', 'cycling');

      expect(result).toHaveLength(1);
      expect(result[0].activity_type).toBe('Cycling');
    });

    it('should include correct authorization header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await client.getActivities('2024-12-14', '2024-12-15');

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(callOptions.headers).toHaveProperty('Authorization');
      const auth = (callOptions.headers as Record<string, string>).Authorization;
      expect(auth).toMatch(/^Basic /);
    });

    it('should throw error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(client.getActivities('2024-12-14', '2024-12-15'))
        .rejects.toThrow('Intervals.icu API error: 401 Unauthorized');
    });

    it('should handle empty response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result).toHaveLength(0);
    });
  });

  describe('getActivity', () => {
    const mockActivity = {
      id: 'i113367711',
      start_date_local: '2025-12-22T16:54:12',
      start_date: '2025-12-22T23:54:12Z',
      type: 'VirtualRide',
      name: 'Zwift - TrainerRoad: Klammspitze',
      moving_time: 7236,
      distance: 65530.26,
      icu_training_load: 86,
      trainer: true,
      icu_zone_times: [
        { id: 'Z1', secs: 571 },
        { id: 'Z2', secs: 6524 },
      ],
    };

    it('should fetch single activity by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivity),
      });

      const result = await client.getActivity('i113367711');

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('/activities/i113367711');
      expect(result.id).toBe('i113367711');
      expect(result.is_indoor).toBe(true);
      expect(result.start_date_utc).toBe('2025-12-22T23:54:12Z');
    });
  });

  describe('getFitnessMetrics', () => {
    const mockWellness = [
      { id: '1', date: '2024-12-14', ctl: 50, atl: 60 },
      { id: '2', date: '2024-12-15', ctl: 52, atl: 58 },
    ];

    it('should fetch and transform fitness metrics', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWellness),
      });

      const result = await client.getFitnessMetrics('2024-12-14', '2024-12-15');

      expect(result).toHaveLength(2);
      expect(result[0].ctl).toBe(50);
      expect(result[0].atl).toBe(60);
      expect(result[0].tsb).toBe(-10); // CTL - ATL
      expect(result[1].tsb).toBe(-6);
    });
  });

  describe('getPlannedEvents', () => {
    const mockEvents = [
      {
        id: 1,
        uid: 'event-1',
        start_date_local: '2024-12-16T09:00:00',
        name: 'Threshold Intervals',
        description: 'Hard workout',
        type: 'Ride',
        category: 'WORKOUT',
        icu_training_load: 80,
        moving_time: 3600,
      },
      {
        id: 2,
        start_date_local: '2024-12-17T10:00:00',
        name: 'Race Day',
        category: 'RACE',
        type: 'Ride',
      },
    ];

    it('should fetch and transform planned events', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEvents),
      });

      const result = await client.getPlannedEvents('2024-12-16', '2024-12-17');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('event-1');
      expect(result[0].name).toBe('Threshold Intervals');
      expect(result[0].expected_tss).toBe(80);
      expect(result[0].source).toBe('intervals.icu');
    });
  });

  describe('getTodayFitness', () => {
    it('should return today\'s fitness metrics', async () => {
      const mockWellness = [{ id: '1', date: '2024-12-15', ctl: 55, atl: 50 }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWellness),
      });

      const result = await client.getTodayFitness();

      expect(result?.ctl).toBe(55);
      expect(result?.tsb).toBe(5);
    });

    it('should return null when no data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await client.getTodayFitness();

      expect(result).toBeNull();
    });
  });
});
