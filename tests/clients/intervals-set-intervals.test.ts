import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntervalsClient } from '../../src/clients/intervals.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// updateActivityIntervals first GETs the activity's `time` stream. These
// tests cover the PUT itself, so serve an activity without a time stream
// (seconds map 1:1 to indices).
function mockNoTimeStream() {
  mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });
}

function mockTimeStream(time: number[]) {
  mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([{ type: 'time', data: time }]) });
}

describe('IntervalsClient updateActivityIntervals', () => {
  let client: IntervalsClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new IntervalsClient({ apiKey: 'test-key', athleteId: 'i12345' });
  });

  describe('updateActivityIntervals', () => {
    it('should update activity intervals successfully', async () => {
      mockNoTimeStream();
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

      // API uses start_index/end_index instead of start_time/end_time
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/activity/i12345_activity123/intervals'),
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('"start_index":0'),
        })
      );
    });

    it('should include all=true query parameter by default', async () => {
      mockNoTimeStream();
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
      mockNoTimeStream();
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
      mockNoTimeStream();
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
      mockNoTimeStream();
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

      const callArgs = mockFetch.mock.calls[1]; // [0] is the time-stream GET
      const body = JSON.parse(callArgs[1].body);

      expect(body).toHaveLength(5);
      // API uses start_index/end_index instead of start_time/end_time
      expect(body[0]).toEqual({
        start_index: 0,
        end_index: 300,
        type: 'RECOVERY',
        label: 'Warmup',
      });
      expect(body[1].type).toBe('WORK');
    });

    it('should handle intervals without labels', async () => {
      mockNoTimeStream();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const intervals = [
        { start_time: 0, end_time: 300, type: 'WORK' as const },
        { start_time: 300, end_time: 360, type: 'RECOVERY' as const },
      ];

      await client.updateActivityIntervals('activity789', intervals);

      const callArgs = mockFetch.mock.calls[1]; // [0] is the time-stream GET
      const body = JSON.parse(callArgs[1].body);

      // API uses start_index/end_index
      expect(body[0].start_index).toBe(0);
      expect(body[0].end_index).toBe(300);
      expect(body[0].label).toBeUndefined();
    });

    it('should throw error on API error (404)', async () => {
      mockNoTimeStream();
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
      mockNoTimeStream();
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
      mockNoTimeStream();
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
      mockNoTimeStream();
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        client.updateActivityIntervals('activity123', [
          { start_time: 0, end_time: 300, type: 'WORK' as const },
        ])
      ).rejects.toThrow('Network error');
    });
  });

  describe('seconds → sample index mapping', () => {
    const putBody = () => {
      const put = mockFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
      return JSON.parse((put![1] as RequestInit).body as string) as Array<{ start_index: number; end_index: number }>;
    };

    it('maps elapsed seconds through the time stream when recording is not 1 Hz', async () => {
      // Smart recording: one sample every 2 s, with a 60 s auto-pause after t=100.
      const time = [...Array.from({ length: 51 }, (_, i) => i * 2), ...Array.from({ length: 100 }, (_, i) => 160 + i * 2)];
      mockTimeStream(time);
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await client.updateActivityIntervals('i1', [
        { start_time: 40, end_time: 100, type: 'WORK' },
        { start_time: 200, end_time: 300, type: 'RECOVERY' },
      ]);

      expect(putBody()).toEqual([
        expect.objectContaining({ start_index: 20, end_index: 50 }),
        // 200 s is sample 51 + (200-160)/2 = 71; 300 s is 51 + 70 = 121
        expect.objectContaining({ start_index: 71, end_index: 121 }),
      ]);
    });

    it('clamps boundaries past the end of the recording to the last sample', async () => {
      mockTimeStream([0, 1, 2, 3, 4]);
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

      await client.updateActivityIntervals('i1', [{ start_time: 2, end_time: 999, type: 'WORK' }]);

      expect(putBody()).toEqual([expect.objectContaining({ start_index: 2, end_index: 4 })]);
    });

    it('does not PUT anything when the time stream fetch fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.resolve('busy') });

      await expect(
        client.updateActivityIntervals('i1', [{ start_time: 0, end_time: 60, type: 'WORK' }])
      ).rejects.toThrow();
      expect(mockFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false);
    });
  });
});
