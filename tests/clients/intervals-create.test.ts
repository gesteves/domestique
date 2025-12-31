import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntervalsClient } from '../../src/clients/intervals.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('IntervalsClient CRUD operations', () => {
  let client: IntervalsClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new IntervalsClient({ apiKey: 'test-key', athleteId: 'i12345' });
  });

  describe('createEvent', () => {
    it('should create event with all fields', async () => {
      const mockResponse = {
        id: 123,
        uid: 'event-uid-123',
        name: 'Test Run',
        start_date_local: '2024-12-15',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique'],
        external_id: 'tr-456',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.createEvent({
        name: 'Test Run',
        description: 'Warmup\n- 10m Z2 Pace',
        type: 'Run',
        category: 'WORKOUT',
        start_date_local: '2024-12-15',
        moving_time: 3600,
        icu_training_load: 50,
        tags: ['domestique'],
        external_id: 'tr-456',
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/athlete/i12345/events'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('"name":"Test Run"'),
        })
      );
    });

    it('should create event with minimal fields', async () => {
      const mockResponse = {
        id: 124,
        uid: 'event-uid-124',
        name: 'Simple Event',
        start_date_local: '2024-12-16',
        type: 'Run',
        category: 'WORKOUT',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.createEvent({
        name: 'Simple Event',
        type: 'Run',
        category: 'WORKOUT',
        start_date_local: '2024-12-16',
      });

      expect(result.id).toBe(124);
      expect(result.name).toBe('Simple Event');
    });

    it('should throw error on API error (401)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(
        client.createEvent({
          name: 'Test',
          type: 'Run',
          category: 'WORKOUT',
          start_date_local: '2024-12-15',
        })
      ).rejects.toThrow(); // Just verify it throws
    });

    it('should throw error on API error (500)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(
        client.createEvent({
          name: 'Test',
          type: 'Run',
          category: 'WORKOUT',
          start_date_local: '2024-12-15',
        })
      ).rejects.toThrow();
    });

    it('should handle network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        client.createEvent({
          name: 'Test',
          type: 'Run',
          category: 'WORKOUT',
          start_date_local: '2024-12-15',
        })
      ).rejects.toThrow('Network error');
    });
  });

  describe('deleteEvent', () => {
    it('should delete event successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await expect(client.deleteEvent('123')).resolves.not.toThrow();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/athlete/i12345/events/123'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should delete event with numeric id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await expect(client.deleteEvent(456)).resolves.not.toThrow();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/events/456'),
        expect.any(Object)
      );
    });

    it('should throw error on event not found (404)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      });

      await expect(client.deleteEvent('999')).rejects.toThrow();
    });

    it('should throw error on permission denied (403)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      });

      await expect(client.deleteEvent('123')).rejects.toThrow();
    });
  });

  describe('getEvent', () => {
    it('should fetch event with all fields', async () => {
      const mockEvent = {
        id: 123,
        uid: 'event-uid-123',
        name: 'Test Run',
        start_date_local: '2024-12-15T09:00:00',
        type: 'Run',
        category: 'WORKOUT',
        tags: ['domestique', 'running'],
        external_id: 'tr-456',
        description: 'Some description',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEvent),
      });

      const result = await client.getEvent('123');

      expect(result).toEqual(mockEvent);
      // Verify the correct endpoint is called
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/events/123'),
        expect.any(Object)
      );
    });

    it('should throw error on event not found (404)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      });

      await expect(client.getEvent('999')).rejects.toThrow();
    });
  });

  describe('getEventsByTag', () => {
    it('should fetch events with matching tag', async () => {
      const mockEvents = [
        {
          id: 1,
          uid: 'uid-1',
          name: 'Run 1',
          tags: ['domestique'],
          external_id: 'tr-1',
        },
        {
          id: 2,
          uid: 'uid-2',
          name: 'Run 2',
          tags: ['domestique'],
          external_id: 'tr-2',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEvents),
      });

      const result = await client.getEventsByTag('domestique', '2024-12-01', '2024-12-31');

      expect(result).toHaveLength(2);
      expect(result[0].tags).toContain('domestique');
    });

    it('should return empty array when no matches', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await client.getEventsByTag('nonexistent', '2024-12-01', '2024-12-31');

      expect(result).toHaveLength(0);
    });

    it('should filter events by date range', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await client.getEventsByTag('domestique', '2024-12-15', '2024-12-22');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/oldest=2024-12-15.*newest=2024-12-22/),
        expect.any(Object)
      );
    });

    it('should filter events client-side by tag', async () => {
      const mockEvents = [
        { id: 1, name: 'Tagged', tags: ['domestique'] },
        { id: 2, name: 'Not Tagged', tags: ['other'] },
        { id: 3, name: 'No Tags' },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockEvents),
      });

      const result = await client.getEventsByTag('domestique', '2024-12-01', '2024-12-31');

      // Should only return events with the tag
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Tagged');
    });
  });
});
