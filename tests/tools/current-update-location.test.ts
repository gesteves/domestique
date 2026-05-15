import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CurrentTools } from '../../src/tools/current.js';
import type { IntervalsClient } from '../../src/clients/intervals.js';
import type { GoogleGeocodingClient } from '../../src/clients/google-geocoding.js';
import type { GoogleTimezoneClient } from '../../src/clients/google-timezone.js';

const COMPONENTS = [
  { long_name: 'Boulder', short_name: 'Boulder', types: ['locality'] },
  { long_name: 'Colorado', short_name: 'CO', types: ['administrative_area_level_1'] },
  { long_name: 'United States', short_name: 'US', types: ['country'] },
];

function makeIntervals() {
  return {
    getAthleteProfile: vi.fn().mockResolvedValue({}),
    getWeatherForecastsRaw: vi.fn().mockResolvedValue([]),
    updateAthleteProfile: vi.fn().mockResolvedValue(undefined),
    updateWeatherConfig: vi.fn().mockResolvedValue(undefined),
    invalidateAthleteCaches: vi.fn(),
  };
}

describe('CurrentTools.updateLocation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies coordinates and returns a snake_case result', async () => {
    const intervals = makeIntervals();
    const geocoding = {
      geocode: vi.fn(),
      reverseGeocode: vi.fn().mockResolvedValue({
        address_components: COMPONENTS,
        formatted_address: 'Boulder, CO, USA',
      }),
    };
    const timezone = { getTimezone: vi.fn().mockResolvedValue('America/Denver') };

    const tools = new CurrentTools(
      intervals as unknown as IntervalsClient,
      null,
      null,
      null,
      null,
      null,
      null,
      geocoding as unknown as GoogleGeocodingClient,
      timezone as unknown as GoogleTimezoneClient
    );

    const result = await tools.updateLocation({ latitude: 40.015, longitude: -105.27 });

    expect(result).toMatchObject({
      location: 'Boulder, Colorado, United States',
      timezone: 'America/Denver',
      city: 'Boulder',
      profile_updated: true,
      weather_config_updated: true,
    });
    expect(geocoding.geocode).not.toHaveBeenCalled();
  });

  it('forward-geocodes a free-text location when no coordinates are given', async () => {
    const intervals = makeIntervals();
    const geocoding = {
      geocode: vi.fn().mockResolvedValue({
        formattedAddress: 'Boulder, CO, USA',
        latitude: 40.015,
        longitude: -105.27,
      }),
      reverseGeocode: vi.fn().mockResolvedValue({
        address_components: COMPONENTS,
        formatted_address: 'Boulder, CO, USA',
      }),
    };
    const timezone = { getTimezone: vi.fn().mockResolvedValue('America/Denver') };

    const tools = new CurrentTools(
      intervals as unknown as IntervalsClient,
      null,
      null,
      null,
      null,
      null,
      null,
      geocoding as unknown as GoogleGeocodingClient,
      timezone as unknown as GoogleTimezoneClient
    );

    const result = await tools.updateLocation({ location: 'Boulder, CO' });

    expect(geocoding.geocode).toHaveBeenCalledWith('Boulder, CO');
    expect(geocoding.reverseGeocode).toHaveBeenCalledWith(40.015, -105.27);
    expect(result.city).toBe('Boulder');
  });

  it('throws when neither coordinates nor a resolvable location are given', async () => {
    const tools = new CurrentTools(
      makeIntervals() as unknown as IntervalsClient,
      null,
      null,
      null,
      null,
      null,
      null,
      { geocode: vi.fn(), reverseGeocode: vi.fn() } as unknown as GoogleGeocodingClient,
      { getTimezone: vi.fn() } as unknown as GoogleTimezoneClient
    );

    await expect(tools.updateLocation({})).rejects.toThrow(/valid latitude/i);
  });
});
