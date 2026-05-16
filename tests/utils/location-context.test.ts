import { describe, it, expect, vi } from 'vitest';
import {
  formatLocation,
  parseCoordinates,
  resolveLocationContext,
} from '../../src/utils/location-context.js';
import type { GoogleAddressComponent } from '../../src/clients/google-geocoding.js';

type C = GoogleAddressComponent;

function comp(long_name: string, types: string[]): C {
  return { long_name, short_name: long_name, types };
}

describe('parseCoordinates', () => {
  it('returns the typed pair for valid coordinates', () => {
    expect(parseCoordinates(43.48, -110.76)).toEqual({ latitude: 43.48, longitude: -110.76 });
    expect(parseCoordinates(0, 0)).toEqual({ latitude: 0, longitude: 0 });
    expect(parseCoordinates(-90, 180)).toEqual({ latitude: -90, longitude: 180 });
  });

  it('returns null for out-of-range, non-finite, and non-numeric values', () => {
    expect(parseCoordinates(91, 0)).toBeNull();
    expect(parseCoordinates(0, 181)).toBeNull();
    expect(parseCoordinates(-91, 0)).toBeNull();
    expect(parseCoordinates(0, -181)).toBeNull();
    expect(parseCoordinates(NaN, 0)).toBeNull();
    expect(parseCoordinates(Infinity, 0)).toBeNull();
    expect(parseCoordinates('43', '-110')).toBeNull();
    expect(parseCoordinates(undefined, undefined)).toBeNull();
  });
});

describe('formatLocation', () => {
  it('returns empty string for no components', () => {
    expect(formatLocation([])).toBe('');
  });

  it('special-cases Jackson Hole (Teton County, Wyoming)', () => {
    expect(
      formatLocation([
        comp('Teton County', ['administrative_area_level_2']),
        comp('Wyoming', ['administrative_area_level_1']),
        comp('United States', ['country']),
      ])
    ).toBe('Jackson Hole, Wyoming');
  });

  it('special-cases New York City', () => {
    expect(
      formatLocation([
        comp('New York', ['locality']),
        comp('New York', ['administrative_area_level_1']),
        comp('United States', ['country']),
      ])
    ).toBe('New York City');
  });

  it('special-cases Washington, DC', () => {
    expect(
      formatLocation([
        comp('Washington', ['locality']),
        comp('District of Columbia', ['administrative_area_level_1']),
        comp('United States', ['country']),
      ])
    ).toBe('Washington, DC');
  });

  it('special-cases Mexico City', () => {
    expect(
      formatLocation([
        comp('Ciudad de México', ['locality']),
        comp('Mexico', ['country']),
      ])
    ).toBe('Mexico City, Mexico');
  });

  it('US: city, state', () => {
    expect(
      formatLocation([
        comp('San Francisco', ['locality']),
        comp('California', ['administrative_area_level_1']),
        comp('United States', ['country']),
      ])
    ).toBe('San Francisco, California');
  });

  it('US: falls back to county when no locality', () => {
    expect(
      formatLocation([
        comp('Fairfax County', ['administrative_area_level_2']),
        comp('Virginia', ['administrative_area_level_1']),
        comp('United States', ['country']),
      ])
    ).toBe('Fairfax County, Virginia');
  });

  it('UK and Canada: city, region', () => {
    expect(
      formatLocation([
        comp('Edinburgh', ['locality']),
        comp('Scotland', ['administrative_area_level_1']),
        comp('United Kingdom', ['country']),
      ])
    ).toBe('Edinburgh, Scotland');
    expect(
      formatLocation([
        comp('Vancouver', ['locality']),
        comp('British Columbia', ['administrative_area_level_1']),
        comp('Canada', ['country']),
      ])
    ).toBe('Vancouver, British Columbia');
  });

  it('other countries: city, country', () => {
    expect(
      formatLocation([
        comp('Caracas', ['locality']),
        comp('Venezuela', ['country']),
      ])
    ).toBe('Caracas, Venezuela');
  });

  it('replaces straight apostrophes with a curly one', () => {
    expect(
      formatLocation([
        comp("Coeur d'Alene", ['locality']),
        comp('Idaho', ['administrative_area_level_1']),
        comp('United States', ['country']),
      ])
    ).toBe('Coeur d’Alene, Idaho');
  });
});

describe('resolveLocationContext', () => {
  const makeDeps = (
    components: C[],
    formattedAddress?: string,
    timezone = 'America/Denver'
  ) => ({
    geocoding: {
      reverseGeocode: vi.fn().mockResolvedValue(
        components.length || formattedAddress
          ? { address_components: components, formatted_address: formattedAddress }
          : null
      ),
    },
    timezone: { getTimezone: vi.fn().mockResolvedValue(timezone) },
  });

  it('overrides the city to "Jackson Hole" for Teton County, Wyoming', async () => {
    const deps = makeDeps([
      comp('Wilson', ['locality']),
      comp('Teton County', ['administrative_area_level_2']),
      comp('Wyoming', ['administrative_area_level_1']),
      comp('United States', ['country']),
    ]);

    const ctx = await resolveLocationContext(43.48, -110.76, deps as never);

    expect(ctx.city).toBe('Jackson Hole');
    expect(ctx.state).toBe('Wyoming');
    expect(ctx.country).toBe('United States');
    expect(ctx.label).toBe('Jackson Hole, Wyoming');
    expect(ctx.location).toBe('Jackson Hole, Wyoming, United States');
    expect(ctx.timezone).toBe('America/Denver');
    expect(ctx.lat).toBe(43.48);
    expect(ctx.lon).toBe(-110.76);
    expect(deps.timezone.getTimezone).toHaveBeenCalledWith(43.48, -110.76);
  });

  it('falls back to formatted address for the label when components are unusable', async () => {
    const deps = makeDeps([], 'Somewhere, Earth');
    const ctx = await resolveLocationContext(1, 2, deps as never);
    expect(ctx.label).toBe('Somewhere, Earth');
    expect(ctx.location).toBe('Somewhere, Earth');
  });

  it('uses "Current location" when geocoding returns nothing', async () => {
    const deps = makeDeps([]);
    const ctx = await resolveLocationContext(1, 2, deps as never);
    expect(ctx.label).toBe('Current location');
    expect(ctx.location).toBe('Current location');
    expect(ctx.city).toBeUndefined();
  });
});
