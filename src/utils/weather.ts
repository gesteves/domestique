import { formatInTimeZone } from 'date-fns-tz';
import { formatTemperature, formatPercent, formatSpeed, formatLength, withUnit } from './format-units.js';
import type {
  WeatherKitWeatherResponse,
  WeatherKitCurrentWeather,
  WeatherKitDayPart,
  WeatherKitHour,
  WeatherKitAlert,
} from '../clients/weatherkit.js';
import type {
  CurrentWeather,
  RestOfDayForecast,
  HourlyForecast,
  WeatherAlert,
  LocationForecast,
} from '../types/index.js';

/**
 * Extract an ISO Alpha-2 country code from an Intervals.icu weather-config
 * `location` string.
 *
 * Intervals.icu stores locations as comma-separated tokens — typically
 * "City,State,US" or "City,Country" — with the trailing token holding the
 * country. Country names are kept as-is when they appear (Apple's WeatherKit
 * accepts both codes and full names), but if the trailing token is already a
 * 2-letter code we surface it uppercased.
 *
 * Returns null only when the input is empty or has no trailing token.
 */
export function extractCountryCode(location: string): string | null {
  if (!location) return null;
  const tokens = location
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  const last = tokens[tokens.length - 1];
  if (/^[A-Za-z]{2}$/.test(last)) return last.toUpperCase();
  return last;
}

/**
 * Format a 0–1 fraction from WeatherKit as a percentage string ("82%").
 * WeatherKit uses 0–1 for cloudCover, humidity, precipitationChance, etc.
 */
function formatFraction(value: number | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  return formatPercent(value * 100);
}

function formatOptional<T>(
  value: number | undefined,
  formatter: (n: number) => T
): T | undefined {
  if (value === undefined || value === null) return undefined;
  return formatter(value);
}

function formatPressure(hpa: number | undefined): string | undefined {
  if (hpa === undefined || hpa === null) return undefined;
  return withUnit(hpa, 'mb', 1);
}

function formatPrecipAmount(mm: number | undefined): string | undefined {
  if (mm === undefined || mm === null) return undefined;
  return withUnit(mm, 'mm', 2);
}

function formatPrecipIntensity(mmh: number | undefined): string | undefined {
  if (mmh === undefined || mmh === null) return undefined;
  return withUnit(mmh, 'mm/h', 2);
}

function formatSnowAmount(cm: number | undefined): string | undefined {
  if (cm === undefined || cm === null) return undefined;
  return withUnit(cm, 'cm', 2);
}

function formatSnowIntensity(cmh: number | undefined): string | undefined {
  if (cmh === undefined || cmh === null) return undefined;
  return withUnit(cmh, 'cm/h', 2);
}

/**
 * Map a compass bearing in degrees to an abbreviated cardinal direction.
 * Boundaries follow the conventional 22.5° / 45° wedges; 0° = N.
 */
function cardinalFromDegrees(deg: number): string | undefined {
  if (Number.isNaN(deg)) return undefined;
  // Normalize into [0, 360) so callers can pass any signed angle.
  const d = ((deg % 360) + 360) % 360;
  if (d < 22.5 || d >= 337.5) return 'N';
  if (d < 67.5) return 'NE';
  if (d < 112.5) return 'E';
  if (d < 157.5) return 'SE';
  if (d < 202.5) return 'S';
  if (d < 247.5) return 'SW';
  if (d < 292.5) return 'W';
  if (d < 337.5) return 'NW';
  return undefined;
}

function formatBearing(deg: number | undefined): string | undefined {
  if (deg === undefined || deg === null) return undefined;
  const cardinal = cardinalFromDegrees(deg);
  // No space before the degree symbol — bearings read more naturally as
  // "226°" than "226 °", and the cardinal already provides a separator.
  const base = `${Math.round(deg)}°`;
  return cardinal ? `${base} ${cardinal}` : base;
}

/**
 * Strip metadata/name and format the WeatherKit currentWeather block.
 */
export function transformCurrentWeather(
  current: WeatherKitCurrentWeather | undefined
): CurrentWeather | null {
  if (!current) return null;
  return {
    as_of: current.asOf,
    condition_code: current.conditionCode,
    daylight: current.daylight,
    cloud_cover: formatFraction(current.cloudCover),
    humidity: formatFraction(current.humidity),
    temperature: formatOptional(current.temperature, formatTemperature),
    temperature_apparent: formatOptional(current.temperatureApparent, formatTemperature),
    temperature_dew_point: formatOptional(current.temperatureDewPoint, formatTemperature),
    pressure: formatPressure(current.pressure),
    pressure_trend: current.pressureTrend,
    precipitation_intensity: formatPrecipIntensity(current.precipitationIntensity),
    uv_index: current.uvIndex,
    visibility: formatOptional(current.visibility, formatLength),
    wind_direction: formatBearing(current.windDirection),
    wind_speed: formatOptional(current.windSpeed, formatSpeed),
    wind_gust: formatOptional(current.windGust, formatSpeed),
  };
}

/**
 * Strip metadata/name and format the daily restOfDayForecast block.
 */
export function transformRestOfDay(
  part: WeatherKitDayPart | undefined
): RestOfDayForecast | null {
  if (!part) return null;
  return {
    forecast_start: part.forecastStart,
    forecast_end: part.forecastEnd,
    condition_code: part.conditionCode,
    cloud_cover: formatFraction(part.cloudCover),
    humidity: formatFraction(part.humidity),
    precipitation_amount: formatPrecipAmount(part.precipitationAmount),
    precipitation_chance: formatFraction(part.precipitationChance),
    precipitation_type: part.precipitationType,
    snowfall_amount: formatSnowAmount(part.snowfallAmount),
    temperature_max: formatOptional(part.temperatureMax, formatTemperature),
    temperature_min: formatOptional(part.temperatureMin, formatTemperature),
    wind_direction: formatBearing(part.windDirection),
    wind_speed: formatOptional(part.windSpeed, formatSpeed),
    wind_speed_max: formatOptional(part.windSpeedMax, formatSpeed),
    wind_gust_speed_max: formatOptional(part.windGustSpeedMax, formatSpeed),
  };
}

/**
 * Format one hour of WeatherKit's hourly forecast.
 */
export function transformHour(hour: WeatherKitHour): HourlyForecast {
  return {
    forecast_start: hour.forecastStart,
    condition_code: hour.conditionCode,
    daylight: hour.daylight,
    cloud_cover: formatFraction(hour.cloudCover),
    humidity: formatFraction(hour.humidity),
    precipitation_amount: formatPrecipAmount(hour.precipitationAmount),
    precipitation_intensity: formatPrecipIntensity(hour.precipitationIntensity),
    precipitation_chance: formatFraction(hour.precipitationChance),
    precipitation_type: hour.precipitationType,
    pressure: formatPressure(hour.pressure),
    pressure_trend: hour.pressureTrend,
    snowfall_amount: formatSnowAmount(hour.snowfallAmount),
    snowfall_intensity: formatSnowIntensity(hour.snowfallIntensity),
    temperature: formatOptional(hour.temperature, formatTemperature),
    temperature_apparent: formatOptional(hour.temperatureApparent, formatTemperature),
    temperature_dew_point: formatOptional(hour.temperatureDewPoint, formatTemperature),
    uv_index: hour.uvIndex,
    visibility: formatOptional(hour.visibility, formatLength),
    wind_direction: formatBearing(hour.windDirection),
    wind_speed: formatOptional(hour.windSpeed, formatSpeed),
    wind_gust: formatOptional(hour.windGust, formatSpeed),
  };
}

/**
 * Filter the hourly forecast to "the rest of today" in the athlete's timezone:
 * keep hours that fall on today's local date and whose 1-hour window has not
 * fully elapsed (i.e. the in-progress hour and every later hour today).
 *
 * Drops any hour explicitly marked `daylight: false` — for outdoor training the
 * dark hours of the evening aren't useful and just inflate the payload.
 */
export function filterHourlyToRestOfDay(
  hours: WeatherKitHour[] | undefined,
  timezone: string,
  now: Date = new Date()
): WeatherKitHour[] {
  if (!hours || hours.length === 0) return [];
  const today = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const cutoffMs = now.getTime() - 60 * 60 * 1000; // include the currently in-progress hour
  return hours.filter((h) => {
    if (!h.forecastStart) return false;
    if (h.daylight === false) return false;
    const startMs = new Date(h.forecastStart).getTime();
    if (Number.isNaN(startMs)) return false;
    if (startMs <= cutoffMs) return false;
    const localDate = formatInTimeZone(new Date(startMs), timezone, 'yyyy-MM-dd');
    return localDate === today;
  });
}

/**
 * Sort alerts by `precedence` (low → high; lower precedence wins per Apple's spec).
 * Alerts without a precedence sink to the end so they don't displace ranked ones.
 */
export function sortAlertsByPrecedence(alerts: WeatherKitAlert[] | undefined): WeatherKitAlert[] {
  if (!alerts) return [];
  const copy = [...alerts];
  copy.sort((a, b) => {
    const ap = a.precedence ?? Number.POSITIVE_INFINITY;
    const bp = b.precedence ?? Number.POSITIVE_INFINITY;
    return ap - bp;
  });
  return copy;
}

function transformAlert(alert: WeatherKitAlert): WeatherAlert {
  return {
    id: alert.id,
    area_id: alert.areaId,
    attribution_url: alert.attributionURL,
    country_code: alert.countryCode,
    description: alert.description,
    token: alert.token,
    effective_time: alert.effectiveTime,
    expire_time: alert.expireTime,
    issued_time: alert.issuedTime,
    event_onset_time: alert.eventOnsetTime,
    event_end_time: alert.eventEndTime,
    details_url: alert.detailsUrl,
    phenomenon: alert.phenomenon,
    precedence: alert.precedence,
    severity: alert.severity,
    significance: alert.significance,
    source: alert.source,
    event_source: alert.eventSource,
    urgency: alert.urgency,
    certainty: alert.certainty,
    importance: alert.importance,
    responses: alert.responses,
  };
}

/**
 * Build a per-location forecast from a raw WeatherKit response.
 *
 * Drops Apple's metadata blocks, slims the payload to current/today/hourly/alerts,
 * filters hourly to the remaining hours of today in `timezone`, and sorts alerts
 * by precedence. ISO time fields are left as-is so formatResponseDates can render
 * them in the athlete's timezone downstream.
 *
 * `location` is the full location string from the athlete's Intervals.icu
 * weather config (e.g., "Moose,Wyoming,US") — preferred over the shorter label
 * because it conveys region/country context to the model.
 */
export function assembleLocationForecast(
  location: string,
  latitude: number,
  longitude: number,
  response: WeatherKitWeatherResponse,
  timezone: string,
  now: Date = new Date()
): LocationForecast {
  const today = response.forecastDaily?.days?.[0];
  const hourlyHours = response.forecastHourly?.hours;
  const alerts = response.weatherAlerts?.alerts;

  const filteredHours = filterHourlyToRestOfDay(hourlyHours, timezone, now);
  const sortedAlerts = sortAlertsByPrecedence(alerts);

  return {
    location,
    latitude,
    longitude,
    current_weather: transformCurrentWeather(response.currentWeather),
    rest_of_day_forecast: transformRestOfDay(today?.restOfDayForecast),
    hourly_forecast: filteredHours.map(transformHour),
    alerts: sortedAlerts.map(transformAlert),
  };
}
