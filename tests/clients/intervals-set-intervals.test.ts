import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntervalsClient } from '../../src/clients/intervals.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('IntervalsClient updateActivityIntervals', () => {
  let client: IntervalsClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new IntervalsClient({ apiKey: 'test-key', athleteId: 'i12345' });
  });

  describe('updateActivityIntervals', () => {
    it('should update activity intervals successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const intervals = [
        { start_time: 0, end_time: 300, type: 'RECOVERY' as const, label: 'Warmup' },
        { start_time: 300, end_time: 600, type: 'WORK' as const, label: 'Interval 1' },
        { start_time: 600, end_time: 660, type: 'RECOVERY' as const, label: 'Recovery 1' },
      ];

      await expect(
        client.updateActivityIntervals('i12345_activity123', intervals)
      ).resolves.not.toThrow();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/activity/i12345_activity123/intervals'),
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('"start_time":0'),
        })
      );
    });

    it('should include all=true query parameter by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await client.updateActivityIntervals('activity123', [
        { start_time: 0, end_time: 300, type: 'WORK' as const },
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/all=true/),
        expect.any(Object)
      );
    });

    it('should include all=false when replaceAll is false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await client.updateActivityIntervals(
        'activity123',
        [{ start_time: 0, end_time: 300, type: 'WORK' as const }],
        false
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/all=false/),
        expect.any(Object)
      );
    });

    it('should include all=true when replaceAll is explicitly true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await client.updateActivityIntervals(
        'activity123',
        [{ start_time: 0, end_time: 300, type: 'WORK' as const }],
        true
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/all=true/),
        expect.any(Object)
      );
    });

    it('should handle intervals with all fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const intervals = [
        { start_time: 0, end_time: 300, type: 'RECOVERY' as const, label: 'Warmup' },
        { start_time: 300, end_time: 780, type: 'WORK' as const, label: 'Lap 1' },
        { start_time: 780, end_time: 840, type: 'RECOVERY' as const, label: 'Rest 1' },
        { start_time: 840, end_time: 1320, type: 'WORK' as const, label: 'Lap 2' },
        { start_time: 1320, end_time: 1620, type: 'RECOVERY' as const, label: 'Cooldown' },
      ];

      await client.updateActivityIntervals('activity456', intervals);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body).toHaveLength(5);
      expect(body[0]).toEqual({
        start_time: 0,
        end_time: 300,
        type: 'RECOVERY',
        label: 'Warmup',
      });
      expect(body[1].type).toBe('WORK');
    });

    it('should handle intervals without labels', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const intervals = [
        { start_time: 0, end_time: 300, type: 'WORK' as const },
        { start_time: 300, end_time: 360, type: 'RECOVERY' as const },
      ];

      await client.updateActivityIntervals('activity789', intervals);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body[0].label).toBeUndefined();
    });

    it('should throw error on API error (404)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Activity not found'),
      });

      await expect(
        client.updateActivityIntervals('nonexistent', [
          { start_time: 0, end_time: 300, type: 'WORK' as const },
        ])
      ).rejects.toThrow();
    });

    it('should throw error on API error (401)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(
        client.updateActivityIntervals('activity123', [
          { start_time: 0, end_time: 300, type: 'WORK' as const },
        ])
      ).rejects.toThrow();
    });

    it('should throw error on API error (500)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(
        client.updateActivityIntervals('activity123', [
          { start_time: 0, end_time: 300, type: 'WORK' as const },
        ])
      ).rejects.toThrow();
    });

    it('should handle network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        client.updateActivityIntervals('activity123', [
          { start_time: 0, end_time: 300, type: 'WORK' as const },
        ])
      ).rejects.toThrow('Network error');
    });
  });
});
