import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyLocation } from '../../src/services/location-sync.js';
import type { IntervalsClient } from '../../src/clients/intervals.js';

function makeIntervals(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getAthleteProfile: vi.fn().mockResolvedValue({}),
    getWeatherForecastsRaw: vi.fn().mockResolvedValue([]),
    updateAthleteProfile: vi.fn().mockResolvedValue(undefined),
    updateWeatherConfig: vi.fn().mockResolvedValue(undefined),
    invalidateAthleteCaches: vi.fn(),
    ...overrides,
  };
}

const JACKSON_COMPONENTS = [
  { long_name: 'Wilson', short_name: 'Wilson', types: ['locality'] },
  { long_name: 'Teton County', short_name: 'Teton County', types: ['administrative_area_level_2'] },
  { long_name: 'Wyoming', short_name: 'WY', types: ['administrative_area_level_1'] },
  { long_name: 'United States', short_name: 'US', types: ['country'] },
];

function makeDeps(intervals: ReturnType<typeof makeIntervals>) {
  return {
    intervals: intervals as unknown as IntervalsClient,
    geocoding: {
      reverseGeocode: vi.fn().mockResolvedValue({
        address_components: JACKSON_COMPONENTS,
        formatted_address: 'Wilson, WY 83014, USA',
      }),
    },
    timezone: { getTimezone: vi.fn().mockResolvedValue('America/Denver') },
  } as never;
}

describe('applyLocation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates both profile and weather config when nothing matches', async () => {
    const intervals = makeIntervals();
    const result = await applyLocation(43.48, -110.76, makeDeps(intervals));

    expect(intervals.updateAthleteProfile).toHaveBeenCalledWith({
      city: 'Jackson Hole',
      state: 'Wyoming',
      country: 'United States',
      timezone: 'America/Denver',
    });
    expect(intervals.updateWeatherConfig).toHaveBeenCalledWith([
      {
        id: 0,
        provider: 'OPEN_WEATHER',
        location: 'Jackson Hole, Wyoming, United States',
        label: 'Jackson Hole, Wyoming',
        lat: 43.48,
        lon: -110.76,
        enabled: true,
      },
    ]);
    expect(intervals.invalidateAthleteCaches).toHaveBeenCalledTimes(1);
    expect(result.profileUpdated).toBe(true);
    expect(result.weatherConfigUpdated).toBe(true);
    expect(result.location).toBe('Jackson Hole, Wyoming, United States');
  });

  it('is a no-op when Intervals.icu already matches', async () => {
    const intervals = makeIntervals({
      getAthleteProfile: vi.fn().mockResolvedValue({
        city: 'Jackson Hole',
        state: 'Wyoming',
        country: 'United States',
        timezone: 'America/Denver',
      }),
      getWeatherForecastsRaw: vi.fn().mockResolvedValue([
        {
          id: 0,
          provider: 'OPEN_WEATHER',
          location: 'Jackson Hole, Wyoming, United States',
          label: 'Jackson Hole, Wyoming',
          lat: 43.48,
          lon: -110.76,
          enabled: true,
        },
      ]),
    });

    const result = await applyLocation(43.48, -110.76, makeDeps(intervals));

    expect(intervals.updateAthleteProfile).not.toHaveBeenCalled();
    expect(intervals.updateWeatherConfig).not.toHaveBeenCalled();
    expect(intervals.invalidateAthleteCaches).not.toHaveBeenCalled();
    expect(result.profileUpdated).toBe(false);
    expect(result.weatherConfigUpdated).toBe(false);
  });

  it('updates only the weather config when the profile already matches', async () => {
    const intervals = makeIntervals({
      getAthleteProfile: vi.fn().mockResolvedValue({
        city: 'Jackson Hole',
        state: 'Wyoming',
        country: 'United States',
        timezone: 'America/Denver',
      }),
    });

    const result = await applyLocation(43.48, -110.76, makeDeps(intervals));

    expect(intervals.updateAthleteProfile).not.toHaveBeenCalled();
    expect(intervals.updateWeatherConfig).toHaveBeenCalledTimes(1);
    expect(intervals.invalidateAthleteCaches).toHaveBeenCalledTimes(1);
    expect(result.profileUpdated).toBe(false);
    expect(result.weatherConfigUpdated).toBe(true);
  });
});
