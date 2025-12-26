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

  // Mock sport settings for zone normalization (cached after first fetch)
  const mockSportSettings = [
    {
      id: 1,
      name: 'Cycling',
      types: ['Ride', 'VirtualRide'],
      hr_zone_names: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z7'],
      power_zone_names: ['Active Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2Max', 'Anaerobic', 'Neuromuscular'],
      max_hr: 190,
      sweet_spot_min: 84,
      sweet_spot_max: 97,
    },
    {
      id: 2,
      name: 'Running',
      types: ['Run'],
      hr_zone_names: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z7'],
      pace_zone_names: ['Easy', 'Moderate', 'Tempo', 'Threshold', 'Interval', 'Repetition'],
      pace_units: 'MINS_KM',
      max_hr: 195,
    },
  ];

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
        strain_score: 118.56503, // API returns strain_score, normalized to icu_strain_score
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
        lthr: 165,
        icu_weight: 74.5,
        icu_resting_hr: 52,
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
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockActivities),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      // Should make at least 2 calls: activities + sport-settings (cached after first use)
      expect(mockFetch).toHaveBeenCalled();
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('/athlete/i12345/activities');
      expect(callUrl).toContain('oldest=2024-12-14');
      expect(callUrl).toContain('newest=2024-12-15');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('i113367711');
      expect(result[0].activity_type).toBe('Cycling');
      expect(result[0].duration).toBe('2:00:36');
      expect(result[0].distance).toBe('65.5 km');
      expect(result[0].source).toBe('intervals.icu');
    });

    it('should include UTC timestamp for cross-platform matching', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockActivities),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].date).toBe('2025-12-22T16:54:12'); // local time
      expect(result[0].start_date_utc).toBe('2025-12-22T23:54:12Z'); // UTC
    });

    it('should include activity context flags', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockActivities),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      // VirtualRide with trainer: true should be indoor
      expect(result[0].is_indoor).toBe(true);
      expect(result[0].is_commute).toBe(false);
      expect(result[0].is_race).toBe(false);
      
      // Run with trainer: false should not be indoor
      expect(result[1].is_indoor).toBe(false);
    });

    it('should mark activity as indoor if type contains "virtual"', async () => {
      const virtualRunActivity = [{
        id: 'vrun1',
        start_date_local: '2024-12-14T08:00:00',
        start_date: '2024-12-14T15:00:00Z',
        type: 'VirtualRun',
        name: 'Virtual Run',
        moving_time: 2400,
        distance: 8000,
        trainer: false, // trainer is false, but type contains "virtual"
      }];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(virtualRunActivity),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].is_indoor).toBe(true);
    });

    it('should mark activity as indoor if source is Zwift', async () => {
      const zwiftActivity = [{
        id: 'zwift1',
        start_date_local: '2024-12-14T08:00:00',
        start_date: '2024-12-14T15:00:00Z',
        type: 'Ride', // Not VirtualRide
        name: 'Zwift Ride',
        moving_time: 3600,
        distance: 30000,
        trainer: false, // trainer is false
        source: 'Zwift', // but source is Zwift
      }];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(zwiftActivity),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].is_indoor).toBe(true);
    });

    it('should include zone thresholds and time in zones', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockActivities),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      // hr_zones should be normalized zone objects with names and ranges
      expect(result[0].hr_zones).toHaveLength(7);
      expect(result[0].hr_zones?.[0]).toMatchObject({
        name: 'Z1',
        low_bpm: expect.any(Number),
        high_bpm: expect.any(Number),
      });

      // power_zones should be normalized zone objects with names, percentages, and watts
      expect(result[0].power_zones).toBeDefined();
      expect(result[0].power_zones?.[0]).toMatchObject({
        name: expect.any(String),
        low_percent: expect.any(Number),
        high_percent: expect.any(Number),
        low_watts: expect.any(Number),
      });
    });

    it('should include session metrics', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockActivities),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].session_rpe).toBe(361);
      expect(result[0].icu_strain_score).toBeCloseTo(118.565, 2);
    });

    it('should include athlete metrics at time of activity', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockActivities),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].lthr).toBe(165);
      expect(result[0].weight).toBe('74.5 kg');
      expect(result[0].resting_hr).toBe(52);
    });

    it('should include power, efficiency, fitness, and energy metrics from list endpoint (non-prefixed fields)', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockActivities),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      // Power metrics (from non-prefixed fields in list endpoint)
      expect(result[0].normalized_power).toBe(183);
      expect(result[0].average_power).toBe(181);

      // Efficiency metrics
      expect(result[0].variability_index).toBeCloseTo(1.011, 2);
      expect(result[0].efficiency_factor).toBeCloseTo(1.356, 2);

      // Fitness snapshot
      expect(result[0].ctl_at_activity).toBeCloseTo(63.48, 1);
      expect(result[0].atl_at_activity).toBeCloseTo(49.26, 1);
      expect(result[0].tsb_at_activity).toBeCloseTo(14.21, 1);

      // Energy
      expect(result[0].work_kj).toBeCloseTo(1307.3, 1);
    });

    it('should include altitude data', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockActivities),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
      });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].average_altitude_m).toBeCloseTo(25.93, 2);
      expect(result[0].min_altitude_m).toBe(10.4);
      expect(result[0].max_altitude_m).toBe(120.8);
    });

    it('should filter by sport when specified', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockActivities),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
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
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockActivity),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        });

      const result = await client.getActivity('i113367711');

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('/activities/i113367711');
      expect(result.id).toBe('i113367711');
      expect(result.is_indoor).toBe(true);
      expect(result.start_date_utc).toBe('2025-12-22T23:54:12Z');
    });

    it('should handle icu_ prefixed fields from single activity endpoint', async () => {
      // The /activities/{id} endpoint returns icu_ prefixed fields for power, efficiency, fitness, and energy
      const mockSingleActivityResponse = {
        id: 'i113796426',
        start_date_local: '2025-12-25T12:01:55',
        start_date: '2025-12-25T19:01:55Z',
        type: 'VirtualRide',
        name: 'Zwift - TrainerRoad: Bald on Big Flat 8 in Watopia',
        moving_time: 3636,
        distance: 35774.63,
        icu_training_load: 45,
        trainer: null, // Not set in single endpoint
        source: 'ZWIFT', // But source indicates it's Zwift
        // Single activity endpoint uses icu_ prefixed fields
        icu_weighted_avg_watts: 186,
        icu_average_watts: 184,
        icu_variability_index: 1.0108696,
        icu_efficiency_factor: 1.3285714,
        icu_ctl: 64.22861,
        icu_atl: 59.80257,
        icu_joules: 669232,
        icu_ftp: 279,
        decoupling: 1.0321792,
        lthr: 172,
        icu_weight: 74.8,
        icu_resting_hr: 52,
        icu_zone_times: [
          { id: 'Z1', secs: 308 },
          { id: 'Z2', secs: 3310 },
        ],
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSingleActivityResponse),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        });

      const result = await client.getActivity('i113796426');

      // Power metrics (from icu_ prefixed fields)
      expect(result.normalized_power).toBe(186);
      expect(result.average_power).toBe(184);

      // Efficiency metrics
      expect(result.variability_index).toBeCloseTo(1.011, 2);
      expect(result.efficiency_factor).toBeCloseTo(1.329, 2);

      // Fitness snapshot (from icu_ prefixed fields)
      expect(result.ctl_at_activity).toBeCloseTo(64.23, 1);
      expect(result.atl_at_activity).toBeCloseTo(59.80, 1);
      expect(result.tsb_at_activity).toBeCloseTo(4.43, 1);

      // Energy (from icu_ prefixed fields)
      expect(result.work_kj).toBeCloseTo(669.2, 1);

      // Athlete metrics
      expect(result.lthr).toBe(172);
      expect(result.weight).toBe('74.8 kg');
      expect(result.resting_hr).toBe(52);

      // is_indoor should be true since source is 'ZWIFT'
      expect(result.is_indoor).toBe(true);
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
      const mockProfile = { athlete: { id: 'test', timezone: 'America/Denver' } };
      const mockWellness = [{ id: '1', date: '2024-12-15', ctl: 55, atl: 50 }];

      // First call: getAthleteTimezone (fetches /profile)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      });
      // Second call: getFitnessMetrics (fetches /wellness)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWellness),
      });

      const result = await client.getTodayFitness();

      expect(result?.ctl).toBe(55);
      expect(result?.tsb).toBe(5);
    });

    it('should return null when no data', async () => {
      const mockProfile = { athlete: { id: 'test', timezone: 'America/Denver' } };

      // First call: getAthleteTimezone (fetches /profile)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      });
      // Second call: getFitnessMetrics (fetches /wellness)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await client.getTodayFitness();

      expect(result).toBeNull();
    });
  });

  describe('getTodayWellness', () => {
    it('should return today\'s wellness data with weight', async () => {
      const mockProfile = { athlete: { id: 'test', timezone: 'America/Denver' } };
      const mockWellness = { id: '2024-12-15', weight: 74.5 };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWellness),
      });

      const result = await client.getTodayWellness();

      expect(result?.weight).toBe('74.5 kg');
    });

    it('should return null when no wellness data for today', async () => {
      const mockProfile = { athlete: { id: 'test', timezone: 'America/Denver' } };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await client.getTodayWellness();

      expect(result).toBeNull();
    });

    it('should return wellness without weight when weight is null', async () => {
      const mockProfile = { athlete: { id: 'test', timezone: 'America/Denver' } };
      const mockWellness = { id: '2024-12-15', weight: null }; // Null weight

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWellness),
      });

      const result = await client.getTodayWellness();

      expect(result).not.toBeNull();
      expect(result?.weight).toBeUndefined();
    });
  });

  describe('getWellnessTrends', () => {
    it('should return wellness trends for date range', async () => {
      const mockWellness = [
        { id: '2024-12-13', weight: 74.5 },
        { id: '2024-12-14', weight: 74.3 },
        { id: '2024-12-15', weight: 74.8 },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWellness),
      });

      const result = await client.getWellnessTrends('2024-12-13', '2024-12-15');

      expect(result.period_days).toBe(3);
      expect(result.start_date).toBe('2024-12-13');
      expect(result.end_date).toBe('2024-12-15');
      expect(result.data).toHaveLength(3);
      expect(result.data[0].date).toBe('2024-12-13');
      expect(result.data[0].weight).toBe('74.5 kg');
    });

    it('should handle empty wellness data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await client.getWellnessTrends('2024-12-13', '2024-12-15');

      expect(result.data).toHaveLength(0);
      expect(result.period_days).toBe(3);
    });

    it('should filter out entries with null weight', async () => {
      const mockWellness = [
        { id: '2024-12-13', weight: 74.5 },
        { id: '2024-12-14', weight: null }, // Null weight should be filtered out
        { id: '2024-12-15', weight: 74.8 },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWellness),
      });

      const result = await client.getWellnessTrends('2024-12-13', '2024-12-15');

      // Only entries with weight data should be included
      expect(result.data).toHaveLength(2);
      expect(result.data[0].date).toBe('2024-12-13');
      expect(result.data[0].weight).toBe('74.5 kg');
      expect(result.data[1].date).toBe('2024-12-15');
      expect(result.data[1].weight).toBe('74.8 kg');
    });
  });

  // ============================================
  // Performance Curves
  // ============================================

  describe('getPowerCurves', () => {
    const mockPowerCurvesResponse = {
      after_kj: 0,
      secs: [5, 30, 60, 300, 1200, 3600],
      curves: [
        {
          id: 'i113367711',
          start_date_local: '2025-12-22T16:54:12',
          weight: 73.5,
          watts: [850, 450, 350, 280, 260, 220],
        },
        {
          id: 'i113367712',
          start_date_local: '2025-12-20T14:30:00',
          weight: 73.5,
          watts: [800, 420, 340, 290, 270, 230],
        },
      ],
    };

    it('should fetch and transform power curves', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPowerCurvesResponse),
      });

      const result = await client.getPowerCurves('2025-12-01', '2025-12-22', 'Ride');

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('/activity-power-curves');
      expect(callUrl).toContain('oldest=2025-12-01');
      expect(callUrl).toContain('newest=2025-12-22');
      expect(callUrl).toContain('type=Ride');

      expect(result.durations).toEqual([5, 30, 60, 300, 1200, 3600]);
      expect(result.activities).toHaveLength(2);
    });

    it('should include activity data with watts and W/kg', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPowerCurvesResponse),
      });

      const result = await client.getPowerCurves('2025-12-01', '2025-12-22');

      const firstActivity = result.activities[0];
      expect(firstActivity.activity_id).toBe('i113367711');
      expect(firstActivity.date).toBe('2025-12-22T16:54:12');
      expect(firstActivity.weight_kg).toBe(73.5);
      expect(firstActivity.curve).toHaveLength(6);
    });

    it('should calculate watts per kg correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPowerCurvesResponse),
      });

      const result = await client.getPowerCurves('2025-12-01', '2025-12-22');

      const firstPoint = result.activities[0].curve[0];
      expect(firstPoint.duration_seconds).toBe(5);
      expect(firstPoint.duration_label).toBe('5s');
      expect(firstPoint.watts).toBe(850);
      // 850 / 73.5 ≈ 11.56
      expect(firstPoint.watts_per_kg).toBeCloseTo(11.56, 1);
    });

    it('should format duration labels correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPowerCurvesResponse),
      });

      const result = await client.getPowerCurves('2025-12-01', '2025-12-22');

      const labels = result.activities[0].curve.map((p) => p.duration_label);
      expect(labels).toEqual(['5s', '30s', '1min', '5min', '20min', '1hr']);
    });

    it('should pass custom durations when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ secs: [5, 7200], curves: [] }),
      });

      await client.getPowerCurves('2025-12-01', '2025-12-22', 'Ride', [5, 7200]);

      const callUrl = mockFetch.mock.calls[0][0] as string;
      // URL encodes comma as %2C
      expect(callUrl).toContain('secs=5%2C7200');
    });
  });

  describe('getPaceCurves', () => {
    const mockPaceCurvesResponse = {
      distances: [400, 1000, 1609, 5000, 10000],
      gap: false,
      curves: [
        {
          id: 'i113367711',
          start_date_local: '2025-12-22T07:00:00',
          weight: 73.5,
          secs: [72, 195, 320, 1020, 2100], // Time to cover each distance
        },
      ],
    };

    it('should fetch and transform pace curves', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPaceCurvesResponse),
      });

      const result = await client.getPaceCurves(
        '2025-12-01',
        '2025-12-22',
        'Run',
        [400, 1000, 1609, 5000, 10000]
      );

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('/activity-pace-curves');
      expect(callUrl).toContain('type=Run');
      // URL encodes comma as %2C
      expect(callUrl).toContain('distances=400%2C1000%2C1609%2C5000%2C10000');

      expect(result.distances).toEqual([400, 1000, 1609, 5000, 10000]);
      expect(result.gap_adjusted).toBe(false);
      expect(result.activities).toHaveLength(1);
    });

    it('should format running pace correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPaceCurvesResponse),
      });

      const result = await client.getPaceCurves(
        '2025-12-01',
        '2025-12-22',
        'Run',
        [400, 1000, 1609, 5000, 10000]
      );

      const firstActivity = result.activities[0];
      expect(firstActivity.curve[0].distance_meters).toBe(400);
      expect(firstActivity.curve[0].distance_label).toBe('400m');
      expect(firstActivity.curve[0].time_seconds).toBe(72);
      // 72 seconds for 400m = 3:00/km pace
      expect(firstActivity.curve[0].pace).toBe('3:00/km');
    });

    it('should format swimming pace correctly', async () => {
      const mockSwimCurves = {
        distances: [100, 200, 400],
        gap: false,
        curves: [
          {
            id: 'swim1',
            start_date_local: '2025-12-22T07:00:00',
            weight: 73.5,
            secs: [90, 195, 420], // Time in seconds
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSwimCurves),
      });

      const result = await client.getPaceCurves(
        '2025-12-01',
        '2025-12-22',
        'Swim',
        [100, 200, 400]
      );

      const firstPoint = result.activities[0].curve[0];
      expect(firstPoint.distance_meters).toBe(100);
      expect(firstPoint.distance_label).toBe('100m');
      // 90 seconds for 100m = 1:30/100m pace
      expect(firstPoint.pace).toBe('1:30/100m');
    });

    it('should pass GAP parameter when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ distances: [], gap: true, curves: [] }),
      });

      await client.getPaceCurves('2025-12-01', '2025-12-22', 'Run', [1000], true);

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('gap=true');
    });
  });

  describe('getHRCurves', () => {
    const mockHRCurvesResponse = {
      secs: [5, 30, 60, 300, 1200, 3600],
      curves: [
        {
          id: 'i113367711',
          start_date_local: '2025-12-22T16:54:12',
          weight: 73.5,
          bpm: [185, 178, 172, 165, 158, 150],
        },
        {
          id: 'i113367712',
          start_date_local: '2025-12-20T14:30:00',
          weight: 73.5,
          bpm: [182, 175, 170, 162, 155, 148],
        },
      ],
    };

    it('should fetch and transform HR curves', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHRCurvesResponse),
      });

      const result = await client.getHRCurves('2025-12-01', '2025-12-22');

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('/activity-hr-curves');
      expect(callUrl).toContain('oldest=2025-12-01');
      expect(callUrl).toContain('newest=2025-12-22');

      expect(result.durations).toEqual([5, 30, 60, 300, 1200, 3600]);
      expect(result.activities).toHaveLength(2);
    });

    it('should include activity HR data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHRCurvesResponse),
      });

      const result = await client.getHRCurves('2025-12-01', '2025-12-22');

      const firstActivity = result.activities[0];
      expect(firstActivity.activity_id).toBe('i113367711');
      expect(firstActivity.date).toBe('2025-12-22T16:54:12');
      expect(firstActivity.curve).toHaveLength(6);
      expect(firstActivity.curve[0].bpm).toBe(185);
    });

    it('should format duration labels correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHRCurvesResponse),
      });

      const result = await client.getHRCurves('2025-12-01', '2025-12-22');

      const labels = result.activities[0].curve.map((p) => p.duration_label);
      expect(labels).toEqual(['5s', '30s', '1min', '5min', '20min', '1hr']);
    });

    it('should filter by sport type when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHRCurvesResponse),
      });

      await client.getHRCurves('2025-12-01', '2025-12-22', 'Ride');

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('type=Ride');
    });

    it('should pass custom durations when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ secs: [5, 60], curves: [] }),
      });

      await client.getHRCurves('2025-12-01', '2025-12-22', undefined, [5, 60]);

      const callUrl = mockFetch.mock.calls[0][0] as string;
      // URL encodes comma as %2C
      expect(callUrl).toContain('secs=5%2C60');
    });
  });

  // ============================================
  // Athlete Profile & Unit Preferences
  // ============================================

  describe('getAthleteProfile', () => {
    it('should fetch athlete profile with unit preferences', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'i12345',
          name: 'Test Athlete',
          city: 'Boston',
          state: 'MA',
          country: 'USA',
          timezone: 'America/New_York',
          sex: 'M',
          measurement_preference: 'meters',
          weight_pref_lb: false,
          fahrenheit: false,
        }),
      });

      const result = await client.getAthleteProfile();

      expect(result.id).toBe('i12345');
      expect(result.name).toBe('Test Athlete');
      expect(result.unit_preferences).toEqual({
        system: 'metric',
        weight: 'kg',
        temperature: 'celsius',
      });
    });

    it('should handle imperial system with overrides', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'i12345',
          measurement_preference: 'feet',
          weight_pref_lb: true,
          fahrenheit: true,
        }),
      });

      const result = await client.getAthleteProfile();

      expect(result.unit_preferences).toEqual({
        system: 'imperial',
        weight: 'lb',
        temperature: 'fahrenheit',
      });
    });

    it('should handle metric system with lb/fahrenheit overrides', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'i12345',
          measurement_preference: 'meters',
          weight_pref_lb: true,
          fahrenheit: true,
        }),
      });

      const result = await client.getAthleteProfile();

      expect(result.unit_preferences).toEqual({
        system: 'metric',
        weight: 'lb',
        temperature: 'fahrenheit',
      });
    });

    it('should include date of birth and age when set', async () => {
      // Mock a date of birth that will give a predictable age
      const dob = '1990-06-15';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'i12345',
          icu_date_of_birth: dob,
          measurement_preference: 'meters',
        }),
      });

      const result = await client.getAthleteProfile();

      expect(result.date_of_birth).toBe(dob);
      expect(result.age).toBeDefined();
      expect(typeof result.age).toBe('number');
      expect(result.age).toBeGreaterThan(30);
    });

    it('should not include date of birth or age when not set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'i12345',
          measurement_preference: 'meters',
        }),
      });

      const result = await client.getAthleteProfile();

      expect(result.date_of_birth).toBeUndefined();
      expect(result.age).toBeUndefined();
    });

    it('should default to metric when measurement_preference is not set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'i12345',
        }),
      });

      const result = await client.getAthleteProfile();

      expect(result.unit_preferences).toEqual({
        system: 'metric',
        weight: 'kg',
        temperature: 'celsius',
      });
    });
  });

  describe('getUnitPreferences', () => {
    it('should cache unit preferences after first fetch', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'i12345',
          measurement_preference: 'meters',
          weight_pref_lb: false,
          fahrenheit: false,
        }),
      });

      // First call
      const result1 = await client.getUnitPreferences();
      // Second call
      const result2 = await client.getUnitPreferences();

      expect(result1).toEqual(result2);
      // Should only fetch once due to caching
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSportSettingsForSport', () => {
    it('should return cycling settings', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'i12345',
            measurement_preference: 'meters',
          }),
        });

      const result = await client.getSportSettingsForSport('cycling');

      expect(result).toBeDefined();
      expect(result?.sport).toBe('cycling');
      expect(result?.types).toContain('Ride');
      expect(result?.settings).toBeDefined();
      expect(result?.unit_preferences).toBeDefined();
    });

    it('should return running settings', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'i12345',
            measurement_preference: 'meters',
          }),
        });

      const result = await client.getSportSettingsForSport('running');

      expect(result).toBeDefined();
      expect(result?.sport).toBe('running');
      expect(result?.types).toContain('Run');
    });

    it('should return null for sport with no settings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await client.getSportSettingsForSport('swimming');

      expect(result).toBeNull();
    });

    it('should include FTP in cycling settings', async () => {
      const cyclingSettings = [{
        id: 1,
        athlete_id: 'i12345',
        types: ['Ride', 'VirtualRide'],
        ftp: 280,
        indoor_ftp: 290,
        lthr: 165,
        max_hr: 190,
        hr_zone_names: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'],
        hr_zones: [130, 145, 160, 175, 190],
        power_zone_names: ['Active Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2Max'],
        power_zones: [55, 75, 90, 105, 120],
      }];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(cyclingSettings),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'i12345',
            measurement_preference: 'meters',
          }),
        });

      const result = await client.getSportSettingsForSport('cycling');

      expect(result?.settings.ftp).toBe(280);
      expect(result?.settings.indoor_ftp).toBe(290);
      expect(result?.settings.lthr).toBe(165);
      expect(result?.settings.max_hr).toBe(190);
      expect(result?.settings.hr_zones).toBeDefined();
      expect(result?.settings.power_zones).toBeDefined();
    });
  });

  describe('getActivityHeatZones', () => {
    it('should return heat zones when data is available', async () => {
      const mockStreams = [
        {
          type: 'time',
          data: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        },
        {
          type: 'heat_strain_index',
          data: [0.5, 0.8, 1.5, 2.0, 3.5, 5.0, 6.0, 7.5, 8.0, 9.0],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStreams),
      });

      const result = await client.getActivityHeatZones('i113367711');

      expect(result).not.toBeNull();
      expect(result).toHaveLength(4);
      expect(result?.[0].name).toBe('Zone 1: No Heat Strain');
      expect(result?.[0].low_heat_strain_index).toBe(0);
      expect(result?.[0].high_heat_strain_index).toBe(0.9);
      expect(result?.[1].name).toBe('Zone 2: Moderate Heat Strain');
      expect(result?.[2].name).toBe('Zone 3: High Heat Strain');
      expect(result?.[3].name).toBe('Zone 4: Extremely High Heat Strain');
      expect(result?.[3].high_heat_strain_index).toBe(null);
    });

    it('should return null when heat strain data is not available', async () => {
      const mockStreams = [
        {
          type: 'time',
          data: [0, 1, 2, 3, 4],
        },
        {
          type: 'power',
          data: [100, 200, 150, 180, 220],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStreams),
      });

      const result = await client.getActivityHeatZones('i113367711');

      expect(result).toBeNull();
    });

    it('should return null when API call fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await client.getActivityHeatZones('i113367711');

      expect(result).toBeNull();
    });

    it('should use correct API endpoint', async () => {
      const mockStreams = [
        {
          type: 'time',
          data: [0, 1],
        },
        {
          type: 'heat_strain_index',
          data: [0.5, 1.5],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStreams),
      });

      await client.getActivityHeatZones('i113367711');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://intervals.icu/api/v1/activity/i113367711/streams?types=heat_strain_index&types=time',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Basic'),
          }),
        })
      );
    });
  });
});
