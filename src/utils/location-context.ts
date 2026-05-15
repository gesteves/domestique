import type { GoogleGeocodingClient, GoogleAddressComponent } from '../clients/google-geocoding.js';
import type { GoogleTimezoneClient } from '../clients/google-timezone.js';

/**
 * Resolved geographic context for a set of coordinates, ported from the kona
 * app's `location_context` / `format_location` logic. Used to push the
 * athlete's current location, timezone, and weather forecast to Intervals.icu.
 */
export interface LocationContext {
  lat: number;
  lon: number;
  /** Human-readable display label, e.g. "Jackson Hole, Wyoming". */
  label: string;
  /** Comma-joined "city, state, country" (falls back to `label`). */
  location: string;
  city?: string;
  state?: string;
  country?: string;
  /** IANA timezone id from the Google Time Zone API. */
  timezone: string;
}

export interface LocationContextDeps {
  geocoding: GoogleGeocodingClient;
  timezone: GoogleTimezoneClient;
}

/**
 * Validate latitude/longitude. Port of kona's `valid_coordinates?`.
 */
export function isValidCoordinates(
  latitude: unknown,
  longitude: unknown
): latitude is number {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  return true;
}

/** First component whose `types` include `type`, returning its `long_name`. */
function longName(
  components: GoogleAddressComponent[],
  type: string
): string | undefined {
  const match = components.find((c) => c.types?.includes(type));
  const name = match?.long_name;
  return name && name.length > 0 ? name : undefined;
}

/** Replace straight apostrophes with a curly one (e.g. "Coeur d'Alene"). */
function curly(value: string | undefined): string | undefined {
  return value?.replace(/'/g, '’');
}

/**
 * Build a human-readable location label from Google address components.
 * Faithful port of kona's `LocationHelpers#format_location`, including its
 * special cases. Returns an empty string when no usable components exist;
 * the caller is responsible for falling back to the formatted address.
 */
export function formatLocation(components: GoogleAddressComponent[]): string {
  if (components.length === 0) return '';

  const city =
    curly(longName(components, 'locality')) ??
    curly(longName(components, 'sublocality'));
  const region = curly(longName(components, 'administrative_area_level_1'));
  const county = curly(longName(components, 'administrative_area_level_2'));
  const country = curly(longName(components, 'country'));

  // No need to be more specific than this when home.
  if (county === 'Teton County' && region === 'Wyoming') {
    return 'Jackson Hole, Wyoming';
  }
  // "New York, New York" is redundant.
  if (city === 'New York' && region === 'New York') return 'New York City';
  // DC is the only case where the state abbreviation is wanted.
  if (region === 'District of Columbia') return 'Washington, DC';
  // Google doesn't return the translated name here.
  if (city === 'Ciudad de México') return 'Mexico City, Mexico';

  const join = (parts: Array<string | undefined>): string =>
    parts.filter((p): p is string => !!p).join(', ');

  switch (country) {
    case 'United States':
      return join([city ?? county, region]);
    case 'United Kingdom':
    case 'Canada':
      return join([city, region]);
    default:
      return join([city, country]);
  }
}

/**
 * Reverse-geocode coordinates and resolve the full location context (label,
 * city/state/country, timezone). Port of kona's `Intervals#location_context`.
 */
export async function resolveLocationContext(
  latitude: number,
  longitude: number,
  deps: LocationContextDeps
): Promise<LocationContext> {
  const result = await deps.geocoding.reverseGeocode(latitude, longitude);
  const components = result?.address_components ?? [];

  // `location_context` uses a broader city lookup than `format_location`.
  const city =
    longName(components, 'locality') ??
    longName(components, 'sublocality') ??
    longName(components, 'administrative_area_level_3') ??
    longName(components, 'administrative_area_level_2');
  const state = longName(components, 'administrative_area_level_1');
  const country = longName(components, 'country');
  const county = longName(components, 'administrative_area_level_2');

  // Obfuscate exactly where in Teton County we are when synced to Intervals.icu.
  const resolvedCity =
    county === 'Teton County' && state === 'Wyoming' ? 'Jackson Hole' : city;

  const label =
    formatLocation(components) ||
    result?.formatted_address ||
    'Current location';

  const locationString =
    [resolvedCity, state, country].filter(Boolean).join(', ') || label;

  const timezone = await deps.timezone.getTimezone(latitude, longitude);

  return {
    lat: latitude,
    lon: longitude,
    label,
    location: locationString,
    city: resolvedCity,
    state,
    country,
    timezone,
  };
}
