import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntervalsClient } from '../../src/clients/intervals.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function jsonOk(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data) };
}

describe('IntervalsClient location updates', () => {
  let client: IntervalsClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new IntervalsClient({ apiKey: 'test-key', athleteId: 'i12345' });
  });

  it('updateAthleteProfile PUTs the profile fields to /athlete/{id}', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({}));

    await client.updateAthleteProfile({
      city: 'Jackson Hole',
      state: 'Wyoming',
      country: 'United States',
      timezone: 'America/Denver',
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/athlete/i12345');
    expect(url).not.toContain('/weather-config');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({
      city: 'Jackson Hole',
      state: 'Wyoming',
      country: 'United States',
      timezone: 'America/Denver',
    });
  });

  it('updateWeatherConfig PUTs { forecasts } to /weather-config', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    const forecasts = [
      {
        id: 0,
        provider: 'OPEN_WEATHER',
        location: 'Jackson Hole, Wyoming, United States',
        label: 'Jackson Hole, Wyoming',
        lat: 43.48,
        lon: -110.76,
        enabled: true,
      },
    ];

    await client.updateWeatherConfig(forecasts);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/v1/athlete/i12345/weather-config');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).toEqual({ forecasts });
  });

  it('getWeatherForecastsRaw bypasses the session cache', async () => {
    const forecasts = [{ id: 1, label: 'A', lat: 1, lon: 2, location: 'A', enabled: true }];
    mockFetch.mockResolvedValue(jsonOk({ forecasts }));

    expect(await client.getWeatherForecastsRaw()).toEqual(forecasts);
    expect(await client.getWeatherForecastsRaw()).toEqual(forecasts);
    expect(mockFetch).toHaveBeenCalledTimes(2); // not memoized
  });

  it('invalidateAthleteCaches drops the memoized timezone so it refetches', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ athlete: { timezone: 'America/Denver' } }));
    expect(await client.getAthleteTimezone()).toBe('America/Denver');
    // Cached: a second call should not hit the network.
    expect(await client.getAthleteTimezone()).toBe('America/Denver');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    client.invalidateAthleteCaches();

    mockFetch.mockResolvedValueOnce(jsonOk({ athlete: { timezone: 'America/New_York' } }));
    expect(await client.getAthleteTimezone()).toBe('America/New_York');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
