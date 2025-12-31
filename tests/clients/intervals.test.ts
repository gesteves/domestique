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

    it('should include start_time in ISO 8601 format', async () => {
      const singleActivity = [mockActivities[0]]; // Test with just one activity for simplicity
      const mockProfile = { athlete: { id: 'i12345', timezone: 'UTC' } };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(singleActivity),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]), // messages
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockProfile),
        });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      // Should have start_time in ISO 8601 format (with timezone offset or Z suffix)
      expect(result).toHaveLength(1);
      expect(result[0].start_time).toBeDefined();
      // Accept both +/-HH:MM offset format and Z suffix for UTC
      expect(result[0].start_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/);
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

    it('should include intervals.icu URL for all activities', async () => {
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

      expect(result[0].intervals_icu_url).toBe('https://intervals.icu/activities/i113367711');
      expect(result[1].intervals_icu_url).toBe('https://intervals.icu/activities/act2');
    });

    it('should include Garmin Connect URL when source is GARMIN_CONNECT and external_id exists', async () => {
      const garminActivity = [{
        id: 'garmin1',
        start_date_local: '2024-12-14T08:00:00',
        start_date: '2024-12-14T15:00:00Z',
        type: 'Ride',
        name: 'Morning Ride',
        moving_time: 3600,
        distance: 30000,
        source: 'GARMIN_CONNECT',
        external_id: '123456789',
      }];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(garminActivity),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].garmin_connect_url).toBe('https://connect.garmin.com/modern/activity/123456789');
    });

    it('should not include Garmin Connect URL when source is not GARMIN_CONNECT', async () => {
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

      expect(result[0].garmin_connect_url).toBeUndefined();
    });

    it('should include Zwift URL when source is ZWIFT and external_id exists', async () => {
      const zwiftActivity = [{
        id: 'zwift1',
        start_date_local: '2024-12-14T08:00:00',
        start_date: '2024-12-14T15:00:00Z',
        type: 'Ride',
        name: 'Zwift Ride',
        moving_time: 3600,
        distance: 30000,
        source: 'ZWIFT',
        external_id: 'abc123def456',
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

      expect(result[0].zwift_url).toBe('https://www.zwift.com/activity/abc123def456');
    });

    it('should not include Zwift URL when source is not ZWIFT', async () => {
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

      expect(result[0].zwift_url).toBeUndefined();
    });

    it('should include Strava URL when strava_id exists', async () => {
      const stravaActivity = [{
        id: 'activity1',
        start_date_local: '2024-12-14T08:00:00',
        start_date: '2024-12-14T15:00:00Z',
        type: 'Ride',
        name: 'Morning Ride',
        moving_time: 3600,
        distance: 30000,
        strava_id: '987654321',
      }];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(stravaActivity),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].strava_url).toBe('https://www.strava.com/activities/987654321');
    });

    it('should not include Strava URL when strava_id does not exist', async () => {
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

      expect(result[0].strava_url).toBeUndefined();
    });

    it('should include multiple URLs when activity has multiple external IDs', async () => {
      const multiUrlActivity = [{
        id: 'multi1',
        start_date_local: '2024-12-14T08:00:00',
        start_date: '2024-12-14T15:00:00Z',
        type: 'Ride',
        name: 'Synced Ride',
        moving_time: 3600,
        distance: 30000,
        source: 'GARMIN_CONNECT',
        external_id: '111222333',
        strava_id: '444555666',
      }];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(multiUrlActivity),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result[0].intervals_icu_url).toBe('https://intervals.icu/activities/multi1');
      expect(result[0].garmin_connect_url).toBe('https://connect.garmin.com/modern/activity/111222333');
      expect(result[0].strava_url).toBe('https://www.strava.com/activities/444555666');
      expect(result[0].zwift_url).toBeUndefined();
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
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
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
        .rejects.toThrow('Authentication failed with Intervals.icu');
    });

    it('should handle empty response', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        });

      const result = await client.getActivities('2024-12-14', '2024-12-15');

      expect(result).toHaveLength(0);
    });

    it('should handle Strava-only workouts with minimal data', async () => {
      const stravaOnlyActivity = [{
        id: '8195815503',
        icu_athlete_id: 'i26807',
        start_date_local: '2022-12-01T16:23:47',
        start_date: '2022-12-01T23:23:47Z',
        type: 'Run',
        name: 'Morning Run',
        source: 'STRAVA',
        _note: 'STRAVA activities are not available via the API',
      }];

      const mockProfile = { athlete: { id: 'i12345', timezone: 'UTC' } };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(stravaOnlyActivity),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockProfile),
        });

      const result = await client.getActivities('2022-12-01', '2022-12-01');

      expect(result).toHaveLength(1);

      // Only minimal fields should be present
      expect(result[0].id).toBe('8195815503');
      expect(result[0].start_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/);
      expect(result[0].source).toBe('strava');
      expect(result[0].unavailable).toBe(true);
      expect(result[0].unavailable_reason).toBe('STRAVA activities are not available via the API');

      // All other fields should be undefined
      expect(result[0].activity_type).toBeUndefined();
      expect(result[0].name).toBeUndefined();
      expect(result[0].duration).toBeUndefined();
      expect(result[0].tss).toBeUndefined();
      expect(result[0].distance).toBeUndefined();
      expect(result[0].average_power).toBeUndefined();
      expect(result[0].average_heart_rate).toBeUndefined();
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
      const mockProfile = { athlete: { id: 'i12345', timezone: 'UTC' } };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockActivity),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSportSettings),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockProfile),
        });

      const result = await client.getActivity('i113367711');

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('/activities/i113367711');
      expect(result.id).toBe('i113367711');
      expect(result.is_indoor).toBe(true);
      expect(result.start_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/);
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
        uid: 'event-2',
        start_date_local: '2024-12-17T10:00:00',
        name: 'Recovery Ride',
        category: 'WORKOUT',
        type: 'Ride',
        icu_training_load: 30,
      },
    ];

    it('should fetch and transform planned workouts (not races)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEvents),
      });

      const result = await client.getPlannedEvents('2024-12-16', '2024-12-17');

      // Verify the API call fetches only WORKOUT category (not races)
      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('/athlete/i12345/events');
      expect(callUrl).toContain('oldest=2024-12-16');
      expect(callUrl).toContain('newest=2024-12-17');
      expect(callUrl).toContain('category=WORKOUT');
      // Should NOT include race categories
      expect(callUrl).not.toContain('RACE_A');
      expect(callUrl).not.toContain('RACE_B');
      expect(callUrl).not.toContain('RACE_C');

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

    it('should return null when only weight exists but is null', async () => {
      const mockProfile = { athlete: { id: 'test', timezone: 'America/Denver' } };
      const mockWellness = { id: '2024-12-15', weight: null }; // Null weight, no other fields

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWellness),
      });

      const result = await client.getTodayWellness();

      // When no wellness fields have data, return null
      expect(result).toBeNull();
    });

    it('should return wellness with other fields when weight is null', async () => {
      const mockProfile = { athlete: { id: 'test', timezone: 'America/Denver' } };
      const mockWellness = {
        id: '2024-12-15',
        weight: null,
        restingHR: 52,
        hrv: 38.5,
        sleepSecs: 28800,
        sleepQuality: 1,
        soreness: 2,
        fatigue: 2,
      };

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
      expect(result?.resting_hr).toBe(52);
      expect(result?.hrv).toBe(38.5);
      expect(result?.sleep_duration).toBe('8h');
      expect(result?.sleep_quality).toBe(1);
      expect(result?.soreness).toBe(2);
      expect(result?.fatigue).toBe(2);
    });

    it('should return complete wellness data with all fields', async () => {
      const mockProfile = { athlete: { id: 'test', timezone: 'America/Denver' } };
      const mockWellness = {
        id: '2024-12-15',
        weight: 74.5,
        restingHR: 51,
        hrv: 35.47,
        hrvSDNN: 45.2,
        sleepSecs: 29400,
        sleepScore: 87,
        sleepQuality: 1,
        avgSleepingHR: 48,
        soreness: 1,
        fatigue: 2,
        stress: 1,
        mood: 2,
        motivation: 2,
        injury: 1,
        hydration: 2,
        spO2: 98,
        systolic: 120,
        diastolic: 80,
        hydrationVolume: 2500,
        respiration: 16.73,
        readiness: 60,
        vo2max: 54,
        steps: 8500,
        comments: 'Feeling good today',
      };

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
      expect(result?.weight).toBe('74.5 kg');
      expect(result?.resting_hr).toBe(51);
      expect(result?.hrv).toBe(35.47);
      expect(result?.hrv_sdnn).toBe(45.2);
      expect(result?.sleep_duration).toBe('8h 10m');
      expect(result?.sleep_score).toBe(87);
      expect(result?.sleep_quality).toBe(1);
      expect(result?.avg_sleeping_hr).toBe(48);
      expect(result?.soreness).toBe(1);
      expect(result?.fatigue).toBe(2);
      expect(result?.stress).toBe(1);
      expect(result?.mood).toBe(2);
      expect(result?.motivation).toBe(2);
      expect(result?.injury).toBe(1);
      expect(result?.hydration).toBe(2);
      expect(result?.spo2).toBe(98);
      expect(result?.blood_pressure).toEqual({ systolic: 120, diastolic: 80 });
      expect(result?.hydration_volume).toBe(2500);
      expect(result?.respiration).toBe(16.73);
      expect(result?.readiness).toBe(60);
      expect(result?.vo2max).toBe(54);
      expect(result?.steps).toBe(8500);
      expect(result?.comments).toBe('Feeling good today');
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

    it('should return wellness trends with all fields', async () => {
      const mockWellness = [
        {
          id: '2024-12-13',
          weight: 74.5,
          restingHR: 52,
          hrv: 38.5,
          sleepSecs: 27000,
          sleepScore: 85,
          sleepQuality: 1,
          soreness: 2,
          fatigue: 2,
          readiness: 70,
        },
        {
          id: '2024-12-15',
          weight: 74.8,
          restingHR: 50,
          hrv: 42.1,
          sleepSecs: 29700,
          sleepScore: 92,
          sleepQuality: 1,
          soreness: 1,
          fatigue: 1,
          readiness: 85,
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWellness),
      });

      const result = await client.getWellnessTrends('2024-12-13', '2024-12-15');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].date).toBe('2024-12-13');
      expect(result.data[0].weight).toBe('74.5 kg');
      expect(result.data[0].resting_hr).toBe(52);
      expect(result.data[0].hrv).toBe(38.5);
      expect(result.data[0].sleep_duration).toBe('7h 30m');
      expect(result.data[0].sleep_score).toBe(85);
      expect(result.data[0].sleep_quality).toBe(1);
      expect(result.data[0].soreness).toBe(2);
      expect(result.data[0].fatigue).toBe(2);
      expect(result.data[0].readiness).toBe(70);
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

    it('should filter out entries with no wellness data', async () => {
      const mockWellness = [
        { id: '2024-12-13', weight: 74.5 },
        { id: '2024-12-14', weight: null }, // No wellness data, should be filtered out
        { id: '2024-12-15', weight: 74.8 },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWellness),
      });

      const result = await client.getWellnessTrends('2024-12-13', '2024-12-15');

      // Only entries with wellness data should be included
      expect(result.data).toHaveLength(2);
      expect(result.data[0].date).toBe('2024-12-13');
      expect(result.data[0].weight).toBe('74.5 kg');
      expect(result.data[1].date).toBe('2024-12-15');
      expect(result.data[1].weight).toBe('74.8 kg');
    });

    it('should include entries with non-weight wellness data', async () => {
      const mockWellness = [
        { id: '2024-12-13', weight: 74.5 },
        { id: '2024-12-14', weight: null, restingHR: 52, hrv: 40.2 }, // No weight but has other data
        { id: '2024-12-15', weight: null }, // No data at all
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWellness),
      });

      const result = await client.getWellnessTrends('2024-12-13', '2024-12-15');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].date).toBe('2024-12-13');
      expect(result.data[0].weight).toBe('74.5 kg');
      expect(result.data[1].date).toBe('2024-12-14');
      expect(result.data[1].weight).toBeUndefined();
      expect(result.data[1].resting_hr).toBe(52);
      expect(result.data[1].hrv).toBe(40.2);
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
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSportSettings),
      });

      const result = await client.getSportSettingsForSport('cycling');

      expect(result).toBeDefined();
      expect(result?.sport).toBe('cycling');
      expect(result?.types).toContain('Ride');
      expect(result?.settings).toBeDefined();
    });

    it('should return running settings', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSportSettings),
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(cyclingSettings),
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

  describe('getActivityHeatMetrics', () => {
    it('should return comprehensive heat metrics when data is available', async () => {
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

      const result = await client.getActivityHeatMetrics('i113367711');

      expect(result).not.toBeNull();
      expect(result?.zones).toHaveLength(4);
      expect(result?.zones[0].name).toBe('Zone 1: No Heat Strain');
      expect(result?.max_heat_strain_index).toBe(9.0);
      expect(result?.median_heat_strain_index).toBeGreaterThan(0);
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

      const result = await client.getActivityHeatMetrics('i113367711');

      expect(result).toBeNull();
    });

    it('should return null when API call fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await client.getActivityHeatMetrics('i113367711');

      expect(result).toBeNull();
    });
  });

  describe('getActivityTemperatureMetrics', () => {
    it('should return comprehensive temperature metrics when data is available', async () => {
      const mockStreams = [
        {
          type: 'time',
          data: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        },
        {
          type: 'temp',
          data: [18.5, 19.0, 19.5, 20.0, 20.5, 21.0, 21.5, 22.0, 22.5, 23.0],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStreams),
      });

      const result = await client.getActivityTemperatureMetrics('i113367711');

      expect(result).not.toBeNull();
      expect(result?.min_ambient_temperature).toBe(18.5);
      expect(result?.max_ambient_temperature).toBe(23.0);
      expect(result?.start_ambient_temperature).toBe(18.5);
      expect(result?.end_ambient_temperature).toBe(23.0);
      expect(result?.median_ambient_temperature).toBeGreaterThan(18);
      expect(result?.median_ambient_temperature).toBeLessThan(24);
    });

    it('should return null when temperature data is not available', async () => {
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

      const result = await client.getActivityTemperatureMetrics('i113367711');

      expect(result).toBeNull();
    });

    it('should return null when API call fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await client.getActivityTemperatureMetrics('i113367711');

      expect(result).toBeNull();
    });

    it('should handle negative temperatures (cold water swimming)', async () => {
      const mockStreams = [
        {
          type: 'time',
          data: [0, 1, 2, 3, 4],
        },
        {
          type: 'temp',
          data: [-2.5, -1.0, 0.0, 1.5, 3.0],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStreams),
      });

      const result = await client.getActivityTemperatureMetrics('i113367711');

      expect(result).not.toBeNull();
      expect(result?.min_ambient_temperature).toBe(-2.5);
      expect(result?.max_ambient_temperature).toBe(3.0);
      expect(result?.start_ambient_temperature).toBe(-2.5);
      expect(result?.end_ambient_temperature).toBe(3.0);
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
      expect(result?.[0].high_heat_strain_index).toBe(1);
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

  });

  describe('getActivityIntervals with heat metrics', () => {
    it('should include heat metrics in intervals when heat data is available', async () => {
      const mockIntervalsResponse = {
        icu_intervals: [
          {
            id: 1,
            type: 'WORK',
            label: 'Interval 1',
            start_time: 100,
            end_time: 200,
            moving_time: 100,
            distance: 1000,
            average_watts: 250,
            max_watts: 300,
          },
          {
            id: 2,
            type: 'RECOVERY',
            label: 'Recovery 1',
            start_time: 200,
            end_time: 300,
            moving_time: 100,
            distance: 500,
            average_watts: 100,
            max_watts: 150,
          },
        ],
        icu_groups: [],
      };

      const mockStreams = [
        {
          type: 'time',
          data: [0, 50, 100, 120, 150, 180, 200, 250, 300],
        },
        {
          type: 'heat_strain_index',
          data: [0, 1.0, 2.0, 3.0, 4.0, 5.0, 2.5, 1.5, 0.5],
        },
      ];

      // First call: getActivityIntervals endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockIntervalsResponse),
      });

      // Second call: heat strain streams endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStreams),
      });

      const result = await client.getActivityIntervals('i113367711');

      expect(result.intervals).toHaveLength(2);

      // First interval (100-200 seconds) should have heat metrics
      // Data points at times 100, 120, 150, 180, 200 with HSI values 2.0, 3.0, 4.0, 5.0, 2.5
      const interval1 = result.intervals[0];
      expect(interval1.min_heat_strain_index).toBe(2.0);
      expect(interval1.max_heat_strain_index).toBe(5.0);
      // Median of [2.0, 3.0, 4.0, 5.0, 2.5] sorted = [2.0, 2.5, 3.0, 4.0, 5.0] = 3.0
      expect(interval1.median_heat_strain_index).toBe(3.0);
      expect(interval1.start_heat_strain_index).toBe(2.0);
      expect(interval1.end_heat_strain_index).toBe(2.5);

      // Second interval (200-300 seconds) should have heat metrics
      // Data points at times 200, 250, 300 with HSI values 2.5, 1.5, 0.5
      const interval2 = result.intervals[1];
      expect(interval2.min_heat_strain_index).toBe(0.5);
      expect(interval2.max_heat_strain_index).toBe(2.5);
      // Median of [2.5, 1.5, 0.5] sorted = [0.5, 1.5, 2.5] = 1.5
      expect(interval2.median_heat_strain_index).toBe(1.5);
      expect(interval2.start_heat_strain_index).toBe(2.5);
      expect(interval2.end_heat_strain_index).toBe(0.5);
    });

    it('should not include heat metrics when heat data is unavailable', async () => {
      const mockIntervalsResponse = {
        icu_intervals: [
          {
            id: 1,
            type: 'WORK',
            label: 'Interval 1',
            start_time: 100,
            end_time: 200,
            moving_time: 100,
            distance: 1000,
            average_watts: 250,
          },
        ],
        icu_groups: [],
      };

      const mockStreams = [
        {
          type: 'time',
          data: [0, 50, 100, 150, 200],
        },
        {
          type: 'power',
          data: [100, 200, 250, 300, 200],
        },
      ];

      // First call: getActivityIntervals endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockIntervalsResponse),
      });

      // Second call: streams endpoint (no heat strain data)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStreams),
      });

      const result = await client.getActivityIntervals('i113367711');

      expect(result.intervals).toHaveLength(1);
      const interval = result.intervals[0];
      expect(interval.min_heat_strain_index).toBeUndefined();
      expect(interval.max_heat_strain_index).toBeUndefined();
      expect(interval.median_heat_strain_index).toBeUndefined();
      expect(interval.start_heat_strain_index).toBeUndefined();
      expect(interval.end_heat_strain_index).toBeUndefined();
    });

    it('should handle intervals with no matching heat data points', async () => {
      const mockIntervalsResponse = {
        icu_intervals: [
          {
            id: 1,
            type: 'WORK',
            start_time: 500, // No heat data in this time range
            end_time: 600,
            moving_time: 100,
            distance: 1000,
          },
        ],
        icu_groups: [],
      };

      const mockStreams = [
        {
          type: 'time',
          data: [0, 50, 100, 150, 200],
        },
        {
          type: 'heat_strain_index',
          data: [1.0, 2.0, 3.0, 4.0, 5.0],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockIntervalsResponse),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStreams),
      });

      const result = await client.getActivityIntervals('i113367711');

      const interval = result.intervals[0];
      expect(interval.min_heat_strain_index).toBeUndefined();
      expect(interval.max_heat_strain_index).toBeUndefined();
      expect(interval.median_heat_strain_index).toBeUndefined();
    });

    it('should handle heat stream fetch failure gracefully', async () => {
      const mockIntervalsResponse = {
        icu_intervals: [
          {
            id: 1,
            type: 'WORK',
            start_time: 100,
            end_time: 200,
            moving_time: 100,
            distance: 1000,
          },
        ],
        icu_groups: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockIntervalsResponse),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await client.getActivityIntervals('i113367711');

      expect(result.intervals).toHaveLength(1);
      const interval = result.intervals[0];
      expect(interval.min_heat_strain_index).toBeUndefined();
    });
  });

  describe('stream_types optimization', () => {
    const mockProfile = { athlete: { id: 'i12345', timezone: 'UTC' } };

    it('should fetch heat metrics when heat_strain_index is in stream_types', async () => {
      const mockActivity = {
        id: 'i113367711',
        start_date_local: '2025-12-22T16:54:12',
        start_date: '2025-12-22T23:54:12Z',
        type: 'VirtualRide',
        name: 'Test Ride',
        moving_time: 3600,
        distance: 30000,
        stream_types: ['time', 'watts', 'heartrate', 'heat_strain_index'],
      };

      const mockHeatStreams = [
        { type: 'time', data: [0, 1, 2, 3, 4] },
        { type: 'heat_strain_index', data: [1.0, 2.0, 3.0, 4.0, 5.0] },
      ];

      // First call: get activity
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivity),
      });

      // Second call: sport settings
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSportSettings),
      });

      // Third call: heat metrics streams (should be called because stream_types includes heat_strain_index)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHeatStreams),
      });

      // Fourth call: notes
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // Fifth call: profile (for timezone)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      });

      const result = await client.getActivity('i113367711');

      // Heat metrics should be present
      expect(result.max_heat_strain_index).toBeDefined();
      expect(result.median_heat_strain_index).toBeDefined();

      // Should have made 5 fetch calls (activity + sport-settings + heat streams + notes + profile)
      expect(mockFetch).toHaveBeenCalledTimes(5);
      const heatStreamUrl = mockFetch.mock.calls[2][0] as string;
      expect(heatStreamUrl).toContain('/streams');
      expect(heatStreamUrl).toContain('heat_strain_index');
    });

    it('should skip heat metrics fetch when heat_strain_index is not in stream_types', async () => {
      const mockActivity = {
        id: 'i113367711',
        start_date_local: '2025-12-22T16:54:12',
        start_date: '2025-12-22T23:54:12Z',
        type: 'VirtualRide',
        name: 'Test Ride',
        moving_time: 3600,
        distance: 30000,
        stream_types: ['time', 'watts', 'heartrate'], // No heat_strain_index
      };

      // First call: get activity
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivity),
      });

      // Second call: sport settings
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSportSettings),
      });

      // Third call: notes (no heat streams because no heat_strain_index in stream_types)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // Fourth call: profile (for timezone)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      });

      const result = await client.getActivity('i113367711');

      // Heat metrics should be undefined
      expect(result.max_heat_strain_index).toBeUndefined();
      expect(result.median_heat_strain_index).toBeUndefined();

      // Should only have made 4 fetch calls (activity + sport-settings + notes + profile, no heat streams)
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should fetch temperature metrics when temp is in stream_types', async () => {
      const mockActivity = {
        id: 'i113367711',
        start_date_local: '2025-12-22T16:54:12',
        start_date: '2025-12-22T23:54:12Z',
        type: 'Run',
        name: 'Test Run',
        moving_time: 3600,
        distance: 10000,
        stream_types: ['time', 'heartrate', 'temp'],
      };

      const mockTempStreams = [
        { type: 'time', data: [0, 1, 2, 3, 4] },
        { type: 'temp', data: [18.0, 19.0, 20.0, 21.0, 22.0] },
      ];

      // First call: get activity
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivity),
      });

      // Second call: sport settings
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSportSettings),
      });

      // Third call: temperature metrics streams (should be called because stream_types includes temp)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTempStreams),
      });

      // Fourth call: notes
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // Fifth call: profile (for timezone)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      });

      const result = await client.getActivity('i113367711');

      // Temperature metrics should be present
      expect(result.min_ambient_temperature).toBeDefined();
      expect(result.max_ambient_temperature).toBeDefined();
      expect(result.median_ambient_temperature).toBeDefined();
      expect(result.start_ambient_temperature).toBeDefined();
      expect(result.end_ambient_temperature).toBeDefined();

      // Should have made 5 fetch calls (activity + sport-settings + temp streams + notes + profile)
      expect(mockFetch).toHaveBeenCalledTimes(5);
      const tempStreamUrl = mockFetch.mock.calls[2][0] as string;
      expect(tempStreamUrl).toContain('/streams');
      expect(tempStreamUrl).toContain('temp');
    });

    it('should skip temperature metrics fetch when temp is not in stream_types', async () => {
      const mockActivity = {
        id: 'i113367711',
        start_date_local: '2025-12-22T16:54:12',
        start_date: '2025-12-22T23:54:12Z',
        type: 'VirtualRide',
        name: 'Test Ride',
        moving_time: 3600,
        distance: 30000,
        trainer: true, // Indoor activity
        stream_types: ['time', 'watts', 'heartrate'], // No temp
      };

      // First call: get activity
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivity),
      });

      // Second call: sport settings
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSportSettings),
      });

      // Third call: notes (no temp streams because no temp in stream_types)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // Fourth call: profile (for timezone)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      });

      const result = await client.getActivity('i113367711');

      // Temperature metrics should be undefined
      expect(result.min_ambient_temperature).toBeUndefined();
      expect(result.max_ambient_temperature).toBeUndefined();
      expect(result.median_ambient_temperature).toBeUndefined();
      expect(result.start_ambient_temperature).toBeUndefined();
      expect(result.end_ambient_temperature).toBeUndefined();

      // Should only have made 4 fetch calls (activity + sport-settings + notes + profile, no temp streams)
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should fetch both heat and temp when both are in stream_types', async () => {
      const mockActivity = {
        id: 'i113367711',
        start_date_local: '2025-12-22T16:54:12',
        start_date: '2025-12-22T23:54:12Z',
        type: 'Run',
        name: 'Test Run',
        moving_time: 3600,
        distance: 10000,
        stream_types: ['time', 'heartrate', 'temp', 'heat_strain_index'],
      };

      const mockHeatStreams = [
        { type: 'time', data: [0, 1, 2] },
        { type: 'heat_strain_index', data: [1.0, 2.0, 3.0] },
      ];

      const mockTempStreams = [
        { type: 'time', data: [0, 1, 2] },
        { type: 'temp', data: [20.0, 21.0, 22.0] },
      ];

      // First call: get activity
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivity),
      });

      // Second call: sport settings
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSportSettings),
      });

      // Third call: heat metrics streams
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHeatStreams),
      });

      // Fourth call: temperature metrics streams
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTempStreams),
      });

      // Fifth call: notes
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // Sixth call: profile (for timezone)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      });

      const result = await client.getActivity('i113367711');

      // Both heat and temperature metrics should be present
      expect(result.max_heat_strain_index).toBeDefined();
      expect(result.min_ambient_temperature).toBeDefined();

      // Should have made 6 fetch calls (activity + sport-settings + heat streams + temp streams + notes + profile)
      expect(mockFetch).toHaveBeenCalledTimes(6);
    });

    it('should handle missing stream_types field gracefully', async () => {
      const mockActivity = {
        id: 'i113367711',
        start_date_local: '2025-12-22T16:54:12',
        start_date: '2025-12-22T23:54:12Z',
        type: 'VirtualRide',
        name: 'Test Ride',
        moving_time: 3600,
        distance: 30000,
        // stream_types field is missing
      };

      // First call: get activity
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivity),
      });

      // Second call: sport settings
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSportSettings),
      });

      // Third call: notes (no streams because stream_types is missing)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      // Fourth call: profile (for timezone)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProfile),
      });

      const result = await client.getActivity('i113367711');

      // Metrics should be undefined when stream_types is missing
      expect(result.max_heat_strain_index).toBeUndefined();
      expect(result.min_ambient_temperature).toBeUndefined();

      // Should only have made 4 fetch calls (activity + sport-settings + notes + profile, no streams)
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('getActivityIntervals with temperature metrics', () => {
    it('should include temperature metrics in intervals when temperature data is available', async () => {
      const mockIntervalsResponse = {
        icu_intervals: [
          {
            id: 1,
            type: 'WORK',
            label: 'Interval 1',
            start_time: 100,
            end_time: 200,
            moving_time: 100,
            distance: 1000,
            average_watts: 250,
            max_watts: 300,
          },
          {
            id: 2,
            type: 'RECOVERY',
            label: 'Recovery 1',
            start_time: 200,
            end_time: 300,
            moving_time: 100,
            distance: 500,
            average_watts: 100,
            max_watts: 150,
          },
        ],
        icu_groups: [],
      };

      const mockStreams = [
        {
          type: 'time',
          data: [0, 50, 100, 120, 150, 180, 200, 250, 300],
        },
        {
          type: 'temp',
          data: [18.0, 18.5, 19.0, 20.0, 21.0, 22.0, 23.0, 22.5, 22.0],
        },
      ];

      // First call: getActivityIntervals endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockIntervalsResponse),
      });

      // Second call: streams endpoint (includes temp data)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStreams),
      });

      const result = await client.getActivityIntervals('i113367711');

      expect(result.intervals).toHaveLength(2);

      // First interval (100-200 seconds) should have temperature metrics
      // Data points at times 100, 120, 150, 180, 200 with temps 19.0, 20.0, 21.0, 22.0, 23.0
      const interval1 = result.intervals[0];
      expect(interval1.min_ambient_temperature).toBe(19.0);
      expect(interval1.max_ambient_temperature).toBe(23.0);
      expect(interval1.median_ambient_temperature).toBe(21.0); // Median of [19, 20, 21, 22, 23] = 21.0
      expect(interval1.start_ambient_temperature).toBe(19.0);
      expect(interval1.end_ambient_temperature).toBe(23.0);

      // Second interval (200-300 seconds) should have temperature metrics
      // Data points at times 200, 250, 300 with temps 23.0, 22.5, 22.0
      const interval2 = result.intervals[1];
      expect(interval2.min_ambient_temperature).toBe(22.0);
      expect(interval2.max_ambient_temperature).toBe(23.0);
      expect(interval2.median_ambient_temperature).toBe(22.5); // Median of [23.0, 22.5, 22.0] sorted = [22.0, 22.5, 23.0] = 22.5
      expect(interval2.start_ambient_temperature).toBe(23.0);
      expect(interval2.end_ambient_temperature).toBe(22.0);
    });

    it('should not include temperature metrics when temperature data is unavailable', async () => {
      const mockIntervalsResponse = {
        icu_intervals: [
          {
            id: 1,
            type: 'WORK',
            label: 'Interval 1',
            start_time: 100,
            end_time: 200,
            moving_time: 100,
            distance: 1000,
            average_watts: 250,
          },
        ],
        icu_groups: [],
      };

      const mockStreams = [
        {
          type: 'time',
          data: [0, 50, 100, 150, 200],
        },
        {
          type: 'power',
          data: [100, 200, 250, 300, 200],
        },
      ];

      // First call: getActivityIntervals endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockIntervalsResponse),
      });

      // Second call: streams endpoint (no temperature data)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStreams),
      });

      const result = await client.getActivityIntervals('i113367711');

      expect(result.intervals).toHaveLength(1);
      const interval = result.intervals[0];
      expect(interval.min_ambient_temperature).toBeUndefined();
      expect(interval.max_ambient_temperature).toBeUndefined();
      expect(interval.median_ambient_temperature).toBeUndefined();
      expect(interval.start_ambient_temperature).toBeUndefined();
      expect(interval.end_ambient_temperature).toBeUndefined();
    });

    it('should handle intervals with no matching temperature data points', async () => {
      const mockIntervalsResponse = {
        icu_intervals: [
          {
            id: 1,
            type: 'WORK',
            start_time: 500, // No temperature data in this time range
            end_time: 600,
            moving_time: 100,
            distance: 1000,
          },
        ],
        icu_groups: [],
      };

      const mockStreams = [
        {
          type: 'time',
          data: [0, 50, 100, 150, 200],
        },
        {
          type: 'temp',
          data: [18.0, 19.0, 20.0, 21.0, 22.0],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockIntervalsResponse),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStreams),
      });

      const result = await client.getActivityIntervals('i113367711');

      const interval = result.intervals[0];
      expect(interval.min_ambient_temperature).toBeUndefined();
      expect(interval.max_ambient_temperature).toBeUndefined();
      expect(interval.median_ambient_temperature).toBeUndefined();
    });

    it('should handle temperature stream with negative values (cold water)', async () => {
      const mockIntervalsResponse = {
        icu_intervals: [
          {
            id: 1,
            type: 'WORK',
            start_time: 100,
            end_time: 200,
            moving_time: 100,
            distance: 1000,
          },
        ],
        icu_groups: [],
      };

      const mockStreams = [
        {
          type: 'time',
          data: [0, 50, 100, 150, 200],
        },
        {
          type: 'temp',
          data: [0.0, -1.0, -2.0, -1.5, -1.0],
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockIntervalsResponse),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStreams),
      });

      const result = await client.getActivityIntervals('i113367711');

      const interval = result.intervals[0];
      expect(interval.min_ambient_temperature).toBe(-2.0);
      expect(interval.max_ambient_temperature).toBe(-1.0);
      expect(interval.start_ambient_temperature).toBe(-2.0);
      expect(interval.end_ambient_temperature).toBe(-1.0);
    });
  });
});
