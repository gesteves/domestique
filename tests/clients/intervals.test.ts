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
    const mockActivities = [
      {
        id: 'act1',
        start_date_local: '2024-12-15T10:00:00',
        type: 'Ride',
        name: 'Morning Ride',
        moving_time: 3600,
        distance: 45000,
        icu_training_load: 85,
        weighted_avg_watts: 220,
        average_heartrate: 150,
      },
      {
        id: 'act2',
        start_date_local: '2024-12-14T08:00:00',
        type: 'Run',
        name: 'Easy Run',
        moving_time: 2400,
        distance: 8000,
        icu_training_load: 45,
        average_heartrate: 140,
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
      expect(result[0].id).toBe('act1');
      expect(result[0].activity_type).toBe('Cycling');
      expect(result[0].duration_seconds).toBe(3600);
      expect(result[0].distance_km).toBe(45);
      expect(result[0].source).toBe('intervals.icu');
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
      id: 'act1',
      start_date_local: '2024-12-15T10:00:00',
      type: 'Ride',
      name: 'Morning Ride',
      moving_time: 3600,
      distance: 45000,
      icu_training_load: 85,
    };

    it('should fetch single activity by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockActivity),
      });

      const result = await client.getActivity('act1');

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain('/activities/act1');
      expect(result.id).toBe('act1');
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
