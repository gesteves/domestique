import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WhoopClient } from '../../src/clients/whoop.js';

// Mock the redis module
vi.mock('../../src/utils/redis.js', () => ({
  getWhoopAccessToken: vi.fn().mockResolvedValue(null),
  getWhoopRefreshToken: vi.fn().mockResolvedValue(null),
  storeWhoopTokens: vi.fn().mockResolvedValue(true),
}));

import { getWhoopAccessToken, getWhoopRefreshToken, storeWhoopTokens } from '../../src/utils/redis.js';

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
    vi.mocked(storeWhoopTokens).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  describe('getRecoveries', () => {
    const mockRecoveries = {
      records: [
        {
          cycle_id: 1,
          sleep_id: 101,
          user_id: 1,
          created_at: '2024-12-15T08:00:00Z',
          updated_at: '2024-12-15T08:00:00Z',
          score_state: 'SCORED',
          score: {
            user_calibrating: false,
            recovery_score: 85,
            resting_heart_rate: 55,
            hrv_rmssd_milli: 65,
          },
        },
      ],
    };

    const mockSleeps = {
      records: [
        {
          id: 101,
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
            sleep_performance_percentage: 95,
          },
        },
      ],
    };

    it('should fetch and transform recovery data', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockRecoveries),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSleeps),
        });

      const result = await client.getRecoveries('2024-12-15', '2024-12-15');

      expect(result).toHaveLength(1);
      expect(result[0].recovery_score).toBe(85);
      expect(result[0].hrv_rmssd).toBe(65);
      expect(result[0].resting_heart_rate).toBe(55);
      expect(result[0].sleep_performance_percentage).toBe(95);
      expect(result[0].sleep_duration_hours).toBeCloseTo(7.5, 1); // (10800000 + 7200000 + 9000000) / 3600000
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
        });

      await client.getRecoveries('2024-12-15', '2024-12-15');

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      const auth = (callOptions.headers as Record<string, string>).Authorization;
      expect(auth).toBe('Bearer test-access-token');
    });

    it('should filter out unscored recoveries', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            records: [
              { ...mockRecoveries.records[0], score_state: 'PENDING' },
              mockRecoveries.records[0],
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSleeps),
        });

      const result = await client.getRecoveries('2024-12-15', '2024-12-15');

      expect(result).toHaveLength(1);
    });
  });

  describe('getTodayRecovery', () => {
    it('should return today\'s recovery', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            records: [{
              cycle_id: 1,
              sleep_id: 101,
              user_id: 1,
              created_at: new Date().toISOString().split('T')[0] + 'T08:00:00Z',
              score_state: 'SCORED',
              score: {
                recovery_score: 75,
                resting_heart_rate: 52,
                hrv_rmssd_milli: 70,
              },
            }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        });

      const result = await client.getTodayRecovery();

      expect(result?.recovery_score).toBe(75);
    });

    it('should return null when no recovery data', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ records: [] }),
        });

      const result = await client.getTodayRecovery();

      expect(result).toBeNull();
    });
  });

  describe('getStrainData', () => {
    const mockCycles = {
      records: [
        {
          id: 1,
          user_id: 1,
          created_at: '2024-12-15T00:00:00Z',
          updated_at: '2024-12-15T23:59:59Z',
          start: '2024-12-15T00:00:00Z',
          end: '2024-12-15T23:59:59Z',
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
          sport_id: 1, // Cycling
          score_state: 'SCORED',
          score: {
            strain: 12.5,
            average_heart_rate: 155,
            max_heart_rate: 180,
            kilojoule: 2500,
            percent_recorded: 100,
          },
        },
      ],
    };

    it('should fetch and transform strain data', async () => {
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
          sport_id: 0, // Running
          score_state: 'SCORED',
          score: {
            strain: 10.2,
            average_heart_rate: 145,
            max_heart_rate: 165,
            kilojoule: 1800,
            percent_recorded: 100,
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
      vi.mocked(getWhoopRefreshToken).mockResolvedValue('stored-refresh-token');

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
      });

      await expect(client.getRecoveries('2024-12-15', '2024-12-15'))
        .rejects.toThrow('Whoop token refresh failed');
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
        .rejects.toThrow('500 Internal Server Error');
    });
  });
});
