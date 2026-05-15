import type {
  IntervalsClient,
  IntervalsWeatherForecastLocation,
} from '../clients/intervals.js';
import {
  resolveLocationContext,
  type LocationContextDeps,
} from '../utils/location-context.js';

export interface LocationSyncDeps extends LocationContextDeps {
  intervals: IntervalsClient;
}

export interface LocationSyncResult {
  location: string;
  label: string;
  timezone: string;
  city?: string;
  state?: string;
  country?: string;
  /** True if the athlete profile was changed (false when already up to date). */
  profileUpdated: boolean;
  /** True if the weather config was changed (false when already up to date). */
  weatherConfigUpdated: boolean;
}

/** Fields compared when deciding whether the weather config needs a write. */
function forecastsEqual(
  existing: IntervalsWeatherForecastLocation[],
  next: IntervalsWeatherForecastLocation[]
): boolean {
  if (existing.length !== next.length) return false;
  const key = (f: IntervalsWeatherForecastLocation): string =>
    JSON.stringify([f.provider, f.location, f.label, f.lat, f.lon, f.enabled]);
  return existing.every((f, i) => key(f) === key(next[i]));
}

/**
 * Resolve coordinates to a location context and push it to Intervals.icu:
 * updates the athlete profile (city/state/country/timezone) and replaces the
 * weather config with a single forecast at the current location. Each write is
 * skipped when the remote value already matches. Ported from kona's
 * `Intervals#update_athlete_profile` / `#update_weather_config`.
 */
export async function applyLocation(
  latitude: number,
  longitude: number,
  deps: LocationSyncDeps
): Promise<LocationSyncResult> {
  const ctx = await resolveLocationContext(latitude, longitude, deps);

  // --- Athlete profile ---
  let profileUpdated = false;
  const profileUpdates: {
    city?: string;
    state?: string;
    country?: string;
    timezone?: string;
  } = {};
  if (ctx.city) profileUpdates.city = ctx.city;
  if (ctx.state) profileUpdates.state = ctx.state;
  if (ctx.country) profileUpdates.country = ctx.country;
  if (ctx.timezone) profileUpdates.timezone = ctx.timezone;

  if (Object.keys(profileUpdates).length > 0) {
    const current = await deps.intervals.getAthleteProfile();
    const unchanged =
      profileUpdates.city === current.city &&
      profileUpdates.state === current.state &&
      profileUpdates.country === current.country &&
      profileUpdates.timezone === current.timezone;
    if (!unchanged) {
      await deps.intervals.updateAthleteProfile(profileUpdates);
      profileUpdated = true;
    }
  }

  // --- Weather config (replace all with a single current-location forecast) ---
  const nextForecasts: IntervalsWeatherForecastLocation[] = [
    {
      id: 0,
      provider: 'OPEN_WEATHER',
      location: ctx.location,
      label: ctx.label,
      lat: ctx.lat,
      lon: ctx.lon,
      enabled: true,
    },
  ];
  let weatherConfigUpdated = false;
  const existingForecasts = await deps.intervals.getWeatherForecastsRaw();
  if (!forecastsEqual(existingForecasts, nextForecasts)) {
    await deps.intervals.updateWeatherConfig(nextForecasts);
    weatherConfigUpdated = true;
  }

  if (profileUpdated || weatherConfigUpdated) {
    deps.intervals.invalidateAthleteCaches();
  }

  return {
    location: ctx.location,
    label: ctx.label,
    timezone: ctx.timezone,
    city: ctx.city,
    state: ctx.state,
    country: ctx.country,
    profileUpdated,
    weatherConfigUpdated,
  };
}
