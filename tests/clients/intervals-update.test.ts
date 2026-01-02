import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntervalsClient } from '../../src/clients/intervals.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('IntervalsClient updateEvent', () => {
  let client: IntervalsClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new IntervalsClient({ apiKey: 'test-key', athleteId: 'i12345' });
  });

  it('should update event with all fields', async () => {
    const mockResponse = {
      id: 123,
      uid: 'event-uid-123',
      name: 'Updated Run',
      start_date_local: '2024-12-20',
      type: 'Run',
      category: 'WORKOUT',
      tags: ['domestique'],
      external_id: 'tr-456',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await client.updateEvent('123', {
      name: 'Updated Run',
      description: 'New description\n- 10m Z2 Pace',
      type: 'Run',
      category: 'WORKOUT',
      start_date_local: '2024-12-20',
      moving_time: 3600,
      icu_training_load: 50,
      tags: ['domestique'],
      external_id: 'tr-456',
    });

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/athlete/i12345/events/123'),
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
        body: expect.stringContaining('"name":"Updated Run"'),
      })
    );
  });

  it('should update event with minimal fields', async () => {
    const mockResponse = {
      id: 124,
      uid: 'event-uid-124',
      name: 'Renamed Event',
      start_date_local: '2024-12-16',
      type: 'Run',
      category: 'WORKOUT',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await client.updateEvent('124', {
      name: 'Renamed Event',
    });

    expect(result.id).toBe(124);
    expect(result.name).toBe('Renamed Event');

    // Verify the body only contains the name
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toEqual({ name: 'Renamed Event' });
  });

  it('should update event with numeric id', async () => {
    const mockResponse = {
      id: 125,
      uid: 'event-uid-125',
      name: 'Test',
      start_date_local: '2024-12-17',
      type: 'Run',
      category: 'WORKOUT',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    await client.updateEvent(125, { name: 'Test' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/events/125'),
      expect.any(Object)
    );
  });

  it('should use PUT method with correct headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 126 }),
    });

    await client.updateEvent('126', { type: 'Ride' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Basic'),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        }),
      })
    );
  });

  it('should throw error on API error (401)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(client.updateEvent('123', { name: 'Test' })).rejects.toThrow();
  });

  it('should throw error on API error (404)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    });

    await expect(client.updateEvent('999', { name: 'Test' })).rejects.toThrow();
  });

  it('should throw error on API error (500)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(client.updateEvent('123', { name: 'Test' })).rejects.toThrow();
  });

  it('should handle network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(client.updateEvent('123', { name: 'Test' })).rejects.toThrow(
      'Network error'
    );
  });

  it('should update only the date field', async () => {
    const mockResponse = {
      id: 127,
      uid: 'event-uid-127',
      name: 'Existing Name',
      start_date_local: '2024-12-25T09:00:00',
      type: 'Run',
      category: 'WORKOUT',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await client.updateEvent('127', {
      start_date_local: '2024-12-25T09:00:00',
    });

    expect(result.start_date_local).toBe('2024-12-25T09:00:00');

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).toEqual({ start_date_local: '2024-12-25T09:00:00' });
  });

  it('should update type field', async () => {
    const mockResponse = {
      id: 128,
      uid: 'event-uid-128',
      name: 'Cross Training',
      start_date_local: '2024-12-18',
      type: 'Ride',
      category: 'WORKOUT',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await client.updateEvent('128', { type: 'Ride' });

    expect(result.type).toBe('Ride');
  });

  it('should preserve tags when updating', async () => {
    const mockResponse = {
      id: 129,
      uid: 'event-uid-129',
      name: 'Updated',
      start_date_local: '2024-12-19',
      type: 'Run',
      category: 'WORKOUT',
      tags: ['domestique', 'easy'],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await client.updateEvent('129', {
      name: 'Updated',
      tags: ['domestique', 'easy'],
    });

    expect(result.tags).toEqual(['domestique', 'easy']);
  });
});
