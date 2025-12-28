import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhoopClient } from '../../src/clients/whoop.js';

// Mock the redis module
vi.mock('../../src/utils/redis.js', () => ({
  getWhoopAccessToken: vi.fn().mockResolvedValue(null),
  getWhoopRefreshToken: vi.fn().mockResolvedValue(null),
  storeWhoopTokens: vi.fn().mockResolvedValue({ success: true, version: 1 }),
  acquireRefreshLock: vi.fn().mockResolvedValue(true),
  releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
  invalidateWhoopAccessToken: vi.fn().mockResolvedValue(true),
  getRefreshTokenVersion: vi.fn().mockResolvedValue(0),
}));

import {
  getWhoopAccessToken,
  getWhoopRefreshToken,
  storeWhoopTokens,
  acquireRefreshLock,
  releaseRefreshLock,
  invalidateWhoopAccessToken,
  getRefreshTokenVersion,
} from '../../src/utils/redis.js';

describe('WhoopClient', () => {
  let client: WhoopClient;
  const mockFetch = vi.fn();

  const defaultConfig = {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  };

  beforeEach(() => {
    client = new WhoopClient(defaultConfig);
    // Set token expiry to far in the future to avoid refresh
    (client as any).tokenExpiresAt = Date.now() + 3600000;
    vi.stubGlobal('fetch', mockFetch);

    // Reset redis mocks
    vi.mocked(getWhoopAccessToken).mockResolvedValue(null);
    vi.mocked(getWhoopRefreshToken).mockResolvedValue(null);
    vi.mocked(storeWhoopTokens).mockResolvedValue({ success: true, version: 1 });
    vi.mocked(acquireRefreshLock).mockResolvedValue(true);
    vi.mocked(releaseRefreshLock).mockResolvedValue(undefined);
    vi.mocked(invalidateWhoopAccessToken).mockResolvedValue(true);
    vi.mocked(getRefreshTokenVersion).mockResolvedValue(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  describe('getRecoveries', () => {
    // Whoop data follows: cycle → sleep → recovery chain
    const mockCycles = {
      records: [
        {
          id: 1,
          user_id: 1,
          created_at: '2024-12-15T00:00:00Z',
          updated_at: '2024-12-15T08:00:00Z',
          start: '2024-12-14T20:00:00Z',
          end: '2024-12-15T20:00:00Z',
          timezone_offset: '-05:00',
          score_state: 'SCORED',
          score: {
            strain: 10.5,
            kilojoule: 8000,
            average_heart_rate: 65,
            max_heart_rate: 120,
          },
        },
      ],
    };

    const mockSleeps = {
      records: [
        {
          id: 101,
          cycle_id: 1, // Links to cycle
          user_id: 1,
          created_at: '2024-12-15T06:00:00Z',
          updated_at: '2024-12-15T06:00:00Z',
          start: '2024-12-14T22:00:00Z',
          end: '2024-12-15T06:00:00Z',
          timezone_offset: '-05:00',
          nap: false,
          score_state: 'SCORED',
          score: {
            stage_summary: {
              total_in_bed_time_milli: 28800000,
              total_awake_time_milli: 1800000,
              total_no_data_time_milli: 0,
              total_light_sleep_time_milli: 10800000,
              total_slow_wave_sleep_time_milli: 7200000,
              total_rem_sleep_time_milli: 9000000,
              sleep_cycle_count: 4,
              disturbance_count: 2,
            },
            sleep_needed: {
              baseline_milli: 28800000,
              need_from_sleep_debt_milli: 0,
              need_from_recent_strain_milli: 1800000,
              need_from_recent_nap_milli: 0,
            },
            respiratory_rate: 15.5,
            sleep_performance_percentage: 95,
            sleep_consistency_percentage: 88,
            sleep_efficiency_percentage: 92.3,
          },
        },
      ],
    };

    const mockRecoveries = {
      records: [
        {
          cycle_id: 1,
          sleep_id: 101, // Links to sleep
          user_id: 1,
          created_at: '2024-12-15T08:00:00Z',
          updated_at: '2024-12-15T08:00:00Z',
          score_state: 'SCORED',
          score: {
            user_calibrating: false,
            recovery_score: 85,
            resting_heart_rate: 55,
            hrv_rmssd_milli: 65,
            spo2_percentage: 96.5,
            skin_temp_celsius: 33.2,
          },
        },
      ],
    };

    it('should fetch and transform recovery data following cycle → sleep → recovery chain', async () => {
      // getRecoveries fetches cycles, sleeps, and recoveries in parallel
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockCycles),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSleeps),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockRecoveries),
        });

      const result = await client.getRecoveries('2024-12-15', '2024-12-15');

      expect(result).toHaveLength(1);
      // Date
      expect(result[0].date).toBe('2024-12-15');
      // Recovery metrics (nested under recovery)
      expect(result[0].recovery.recovery_score).toBe(85);
      expect(result[0].recovery.hrv_rmssd).toBe(65);
      expect(result[0].recovery.resting_heart_rate).toBe(55);
      expect(result[0].recovery.spo2_percentage).toBe(96.5);
      expect(result[0].recovery.skin_temp_celsius).toBe(33.2);
      expect(result[0].recovery.recovery_level).toBe('SUFFICIENT');
      // Sleep performance metrics (nested under sleep)
      expect(result[0].sleep.sleep_performance_percentage).toBe(95);
      expect(result[0].sleep.sleep_consistency_percentage).toBe(88);
      expect(result[0].sleep.sleep_efficiency_percentage).toBe(92.3);
      // Sleep summary (nested)
      expect(result[0].sleep.sleep_summary.total_in_bed_time).toBe('8:00:00'); // 28800000 ms
      expect(result[0].sleep.sleep_summary.total_awake_time).toBe('0:30:00'); // 1800000 ms
      expect(result[0].sleep.sleep_summary.total_light_sleep_time).toBe('3:00:00'); // 10800000 ms
      expect(result[0].sleep.sleep_summary.total_slow_wave_sleep_time).toBe('2:00:00'); // 7200000 ms
      expect(result[0].sleep.sleep_summary.total_rem_sleep_time).toBe('2:30:00'); // 9000000 ms
      expect(result[0].sleep.sleep_summary.total_restorative_sleep).toBe('4:30:00'); // 7200000 + 9000000 = 16200000 ms
      expect(result[0].sleep.sleep_summary.sleep_cycle_count).toBe(4);
      expect(result[0].sleep.sleep_summary.disturbance_count).toBe(2);
      // Sleep needed (nested)
      expect(result[0].sleep.sleep_needed.baseline).toBe('8:00:00'); // 28800000 ms
      expect(result[0].sleep.sleep_needed.need_from_recent_strain).toBe('0:30:00'); // 1800000 ms
      expect(result[0].sleep.respiratory_rate).toBe(15.5);
    });

    it('should include authorization header', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        });

      await client.getRecoveries('2024-12-15', '2024-12-15');

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      const auth = (callOptions.headers as Record<string, string>).Authorization;
      expect(auth).toBe('Bearer test-access-token');
    });

    it('should filter out unscored cycles', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            records: [
              { ...mockCycles.records[0], score_state: 'PENDING' },
              mockCycles.records[0],
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSleeps),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockRecoveries),
        });

      const result = await client.getRecoveries('2024-12-15', '2024-12-15');

      expect(result).toHaveLength(1);
    });
  });

  describe('getTodayRecovery', () => {
    it('should return sleep and recovery for most recent scored cycle', async () => {
      // getTodayRecovery fetches cycles, sleeps, recoveries without date filter
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            records: [{
              id: 1,
              user_id: 1,
              created_at: new Date().toISOString(),
              start: new Date().toISOString(),
              score_state: 'SCORED',
              score: { strain: 10, kilojoule: 8000, average_heart_rate: 65, max_heart_rate: 120 },
            }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            records: [{
              id: 101,
              cycle_id: 1,
              user_id: 1,
              nap: false,
              score_state: 'SCORED',
              score: {
                stage_summary: {
                  total_in_bed_time_milli: 28800000,
                  total_awake_time_milli: 0,
                  total_no_data_time_milli: 0,
                  total_light_sleep_time_milli: 10800000,
                  total_slow_wave_sleep_time_milli: 7200000,
                  total_rem_sleep_time_milli: 9000000,
                  sleep_cycle_count: 4,
                  disturbance_count: 2,
                },
                sleep_needed: {
                  baseline_milli: 28800000,
                  need_from_sleep_debt_milli: 0,
                  need_from_recent_strain_milli: 0,
                  need_from_recent_nap_milli: 0,
                },
                sleep_performance_percentage: 95,
              },
            }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            records: [{
              cycle_id: 1,
              sleep_id: 101,
              user_id: 1,
              created_at: new Date().toISOString(),
              score_state: 'SCORED',
              score: {
                recovery_score: 75,
                resting_heart_rate: 52,
                hrv_rmssd_milli: 70,
              },
            }],
          }),
        });

      const result = await client.getTodayRecovery();

      // Returns { sleep, recovery } object
      expect(result.recovery?.recovery_score).toBe(75);
      expect(result.sleep?.sleep_performance_percentage).toBe(95);
      expect(result.sleep?.sleep_summary.total_in_bed_time).toBe('8:00:00');
    });

    it('should return null sleep and recovery when no scored cycle', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        });

      const result = await client.getTodayRecovery();

      expect(result.sleep).toBeNull();
      expect(result.recovery).toBeNull();
    });
  });

  describe('getTodayStrain', () => {
    it('should return strain for current in-progress cycle', async () => {
      const mockCycles = {
        records: [
          {
            id: 1,
            user_id: 1,
            start: '2024-12-15T06:00:00Z',
            // No end = in-progress
            score_state: 'SCORED',
            score: {
              strain: 8.5,
              kilojoule: 6000,
              average_heart_rate: 70,
              max_heart_rate: 150,
            },
          },
        ],
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockCycles),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        });

      const result = await client.getTodayStrain();

      expect(result).not.toBeNull();
      expect(result?.strain_score).toBe(8.5);
    });

    it('should return null when no in-progress cycle', async () => {
      const mockCycles = {
        records: [
          {
            id: 1,
            user_id: 1,
            start: '2024-12-14T06:00:00Z',
            end: '2024-12-15T06:00:00Z', // Has end = completed
            score_state: 'SCORED',
            score: { strain: 10, kilojoule: 8000, average_heart_rate: 70, max_heart_rate: 150 },
          },
        ],
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockCycles),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        });

      const result = await client.getTodayStrain();

      expect(result).toBeNull();
    });

    it('should return null when current cycle not scored yet', async () => {
      const mockCycles = {
        records: [
          {
            id: 1,
            user_id: 1,
            start: '2024-12-15T06:00:00Z',
            // No end = in-progress
            score_state: 'PENDING_SCORE',
            score: { strain: 0, kilojoule: 0, average_heart_rate: 0, max_heart_rate: 0 },
          },
        ],
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockCycles),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        });

      const result = await client.getTodayStrain();

      expect(result).toBeNull();
    });
  });

  describe('getStrainData', () => {
    // Cycle date is determined by END time (when you went to sleep)
    const mockCycles = {
      records: [
        {
          id: 1,
          user_id: 1,
          created_at: '2024-12-15T00:00:00Z',
          updated_at: '2024-12-15T23:59:59Z',
          start: '2024-12-14T14:00:00Z', // Started Dec 14
          end: '2024-12-15T14:00:00Z',   // Ended Dec 15 = cycle date is Dec 15
          timezone_offset: '-05:00',
          score_state: 'SCORED',
          score: {
            strain: 15.5,
            kilojoule: 12000,
            average_heart_rate: 75,
            max_heart_rate: 185,
          },
        },
      ],
    };

    const mockWorkouts = {
      records: [
        {
          id: 1001,
          user_id: 1,
          created_at: '2024-12-15T10:00:00Z',
          updated_at: '2024-12-15T11:00:00Z',
          start: '2024-12-15T10:00:00Z',
          end: '2024-12-15T11:00:00Z',
          timezone_offset: '-05:00',
          sport_name: 'cycling',
          score_state: 'SCORED',
          score: {
            strain: 12.5,
            average_heart_rate: 155,
            max_heart_rate: 180,
            kilojoule: 2500,
            percent_recorded: 100,
            distance_meter: 25000,
            altitude_gain_meter: 150,
            zone_durations: {
              zone_zero_milli: 300000,
              zone_one_milli: 600000,
              zone_two_milli: 1200000,
              zone_three_milli: 900000,
              zone_four_milli: 600000,
              zone_five_milli: 0,
            },
          },
        },
      ],
    };

    it('should fetch and transform strain data using cycle end date', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockCycles),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockWorkouts),
        });

      const result = await client.getStrainData('2024-12-15', '2024-12-15');

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2024-12-15'); // Date from end time
      expect(result[0].strain_score).toBe(15.5);
      expect(result[0].calories).toBeCloseTo(2868, 0); // 12000 / 4.184
      expect(result[0].activities).toHaveLength(1);
      expect(result[0].activities[0].activity_type).toBe('Cycling');
    });

    it('should filter out unscored cycles', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            records: [
              { ...mockCycles.records[0], score_state: 'PENDING' },
              mockCycles.records[0],
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockWorkouts),
        });

      const result = await client.getStrainData('2024-12-15', '2024-12-15');

      expect(result).toHaveLength(1);
    });
  });

  describe('getWorkouts', () => {
    const mockWorkouts = {
      records: [
        {
          id: 1001,
          user_id: 1,
          created_at: '2024-12-15T10:00:00Z',
          updated_at: '2024-12-15T11:00:00Z',
          start: '2024-12-15T10:00:00Z',
          end: '2024-12-15T11:00:00Z',
          timezone_offset: '-05:00',
          sport_name: 'running',
          score_state: 'SCORED',
          score: {
            strain: 10.2,
            average_heart_rate: 145,
            max_heart_rate: 165,
            kilojoule: 1800,
            percent_recorded: 100,
            distance_meter: 8500,
            altitude_gain_meter: 45,
            zone_durations: {
              zone_zero_milli: 60000,
              zone_one_milli: 300000,
              zone_two_milli: 900000,
              zone_three_milli: 1200000,
              zone_four_milli: 600000,
              zone_five_milli: 300000,
            },
          },
        },
      ],
    };

    it('should fetch and transform workouts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockWorkouts),
      });

      const result = await client.getWorkouts('2024-12-15', '2024-12-15');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1001');
      expect(result[0].activity_type).toBe('Running');
      expect(result[0].strain_score).toBe(10.2);
      expect(result[0].average_heart_rate).toBe(145);
      expect(result[0].distance).toBe('8.5 km');
      expect(result[0].elevation_gain).toBe('45 m');
      expect(result[0].zone_durations?.zone_3).toBe('0:20:00'); // 1200000 ms
    });
  });

  describe('token refresh', () => {
    it('should use cached token from Redis', async () => {
      vi.mocked(getWhoopAccessToken).mockResolvedValueOnce({
        token: 'cached-access-token',
        expiresAt: Date.now() + 3600000,
      });

      // Reset token to force checking Redis
      (client as any).tokenExpiresAt = 0;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ records: [] }),
      });

      await client.getWorkouts('2024-12-15', '2024-12-15');

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      const auth = (callOptions.headers as Record<string, string>).Authorization;
      expect(auth).toBe('Bearer cached-access-token');
    });

    it('should refresh token and store in Redis', async () => {
      // Force token expiry
      (client as any).tokenExpiresAt = 0;
      vi.mocked(getWhoopAccessToken).mockResolvedValue(null);
      vi.mocked(getWhoopRefreshToken).mockResolvedValue({
        token: 'stored-refresh-token',
        version: 1,
        updatedAt: Date.now(),
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        });

      await client.getWorkouts('2024-12-15', '2024-12-15');

      expect(storeWhoopTokens).toHaveBeenCalledWith(expect.objectContaining({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      }));
    });

    it('should throw error when token refresh fails', async () => {
      // Force token expiry by setting tokenExpiresAt to past
      (client as any).tokenExpiresAt = 0;
      vi.mocked(getWhoopAccessToken).mockResolvedValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('{"error": "invalid_token"}'),
      });

      await expect(client.getRecoveries('2024-12-15', '2024-12-15'))
        .rejects.toThrow('Whoop is temporarily unavailable');
    });
  });

  describe('API error handling', () => {
    it('should throw error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(client.getWorkouts('2024-12-15', '2024-12-15'))
        .rejects.toThrow('Whoop is temporarily unavailable');
    });
  });

  describe('401 retry behavior', () => {
    it('should retry once on 401 and succeed with fresh token', async () => {
      // First call returns 401
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        })
        // Token refresh succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
        })
        // Retry succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        });

      const result = await client.getWorkouts('2024-12-15', '2024-12-15');

      expect(result).toEqual([]);
      expect(invalidateWhoopAccessToken).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(3); // Original call + refresh + retry
    });

    it('should throw error if still 401 after retry', async () => {
      // Both calls return 401
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        })
        // Token refresh succeeds
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
        })
        // Retry still fails with 401
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
        });

      await expect(client.getWorkouts('2024-12-15', '2024-12-15'))
        .rejects.toThrow('Authentication failed with Whoop');
    });
  });

  describe('distributed locking', () => {
    it('should acquire and release lock during token refresh', async () => {
      // Create a fresh client to avoid interference from other tests
      const freshClient = new WhoopClient(defaultConfig);
      (freshClient as any).tokenExpiresAt = 0;
      
      // Reset mocks
      mockFetch.mockReset();
      vi.mocked(getWhoopAccessToken).mockResolvedValue(null);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        });

      await freshClient.getWorkouts('2024-12-15', '2024-12-15');

      expect(acquireRefreshLock).toHaveBeenCalled();
      expect(releaseRefreshLock).toHaveBeenCalled();
    });

    it('should skip refresh if fresh token appears after acquiring lock', async () => {
      // Create a fresh client to avoid interference from other tests
      const freshClient = new WhoopClient(defaultConfig);
      (freshClient as any).tokenExpiresAt = 0;
      
      // Reset mocks
      mockFetch.mockReset();

      // Lock is acquired, but fresh token appears between lock and refresh
      vi.mocked(getWhoopAccessToken)
        .mockResolvedValueOnce(null) // First check
        .mockResolvedValueOnce({ // After acquiring lock (inside performTokenRefresh)
          token: 'appeared-while-waiting',
          expiresAt: Date.now() + 3600000,
        });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ records: [] }),
      });

      await freshClient.getWorkouts('2024-12-15', '2024-12-15');

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      const auth = (callOptions.headers as Record<string, string>).Authorization;
      expect(auth).toBe('Bearer appeared-while-waiting');
      // Should not have called the OAuth endpoint
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
