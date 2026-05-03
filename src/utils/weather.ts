import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { formatTemperature, formatPercent, formatLength, withUnit } from './format-units.js';
import { getCurrentUnitPreferences } from './unit-context.js';
import { formatDateTimeHumanReadable } from './date-formatting.js';
import { addDaysToYMD } from './tz.js';
import type {
  GoogleCurrentConditionsResponse,
  GoogleDailyForecastResponse,
  GoogleForecastDay,
  GoogleForecastDayPeriod,
  GoogleForecastHour,
  GoogleHourlyForecastResponse,
  GoogleSpeed,
  GoogleTemperature,
  GoogleVisibility,
  GoogleWeatherAlert,
  GoogleWeatherAlertsResponse,
  GoogleWind,
} from '../clients/google-weather.js';
import type {
  GoogleAirQualityHourlyEntry,
  GoogleAirQualityHourlyResponse,
  GoogleAirQualityIndex,
  GoogleCurrentAirQualityResponse,
} from '../clients/google-air-quality.js';
import type {
  GooglePollenDailyInfo,
  GooglePollenForecastResponse,
} from '../clients/google-pollen.js';
import type { GoogleElevationResponse } from '../clients/google-elevation.js';
import type {
  AirQuality,
  CurrentWeather,
  DailyForecastSummary,
  HourlyForecast,
  MoonEvents,
  Pollen,
  PollenIndexLevel,
  SunEvents,
  WeatherAlert,
  LocationForecast,
} from '../types/index.js';

/**
 * Format a temperature value-with-unit object from Google. The API returns
 * Celsius when called with `unitsSystem=METRIC`; if a Fahrenheit response slips
 * through (defensive only), we convert before formatting so the output unit
 * stays consistent with everything else in the response.
 */
function formatGoogleTemperature(temp: GoogleTemperature | undefined): string | undefined {
  if (!temp || temp.degrees === undefined || temp.degrees === null) return undefined;
  if ((temp.unit ?? 'CELSIUS').toUpperCase() === 'FAHRENHEIT') {
    return formatTemperature((temp.degrees - 32) * (5 / 9));
  }
  return formatTemperature(temp.degrees);
}

// Speed conversion helpers — every Google response unit is normalized to m/s
// first, then projected to the athlete's preferred wind unit.
const SPEED_TO_MPS: Record<string, number> = {
  KILOMETERS_PER_HOUR: 1 / 3.6,
  MILES_PER_HOUR: 0.44704,
  METERS_PER_SECOND: 1,
  KNOTS: 0.514444,
};

// Beaufort scale upper bounds (m/s) for forces 0–11; anything ≥ 32.7 m/s is 12.
// Source: WMO. Each entry is the *upper* bound of that force.
const BEAUFORT_UPPER_MPS = [
  0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7,
];

function metersPerSecondToBeaufort(mps: number): number {
  for (let i = 0; i < BEAUFORT_UPPER_MPS.length; i++) {
    if (mps < BEAUFORT_UPPER_MPS[i]) return i;
  }
  return 12;
}

/**
 * Format a value-with-unit speed object (e.g., wind speed/gust). Normalizes
 * Google's reported unit to m/s and then renders in the athlete's preferred
 * wind unit (km/h, mph, m/s, knots, or Beaufort).
 */
function formatGoogleSpeed(speed: GoogleSpeed | undefined): string | undefined {
  if (!speed || speed.value === undefined || speed.value === null) return undefined;
  const unit = (speed.unit ?? 'KILOMETERS_PER_HOUR').toUpperCase();
  const factor = SPEED_TO_MPS[unit];
  if (factor === undefined) {
    // Unknown source unit — keep what the API gave us rather than guess.
    return `${speed.value.toFixed(1)} ${speed.unit ?? ''}`.trim();
  }
  const mps = speed.value * factor;
  switch (getCurrentUnitPreferences().wind) {
    case 'kmh':
      return withUnit(mps * 3.6, 'km/h', 1);
    case 'mph':
      return withUnit(mps / 0.44704, 'mph', 1);
    case 'mps':
      return withUnit(mps, 'm/s', 1);
    case 'knots':
      return withUnit(mps / 0.514444, 'kn', 1);
    case 'bft':
      return `${metersPerSecondToBeaufort(mps)} Bft`;
  }
}

function formatGoogleVisibility(vis: GoogleVisibility | undefined): string | undefined {
  if (!vis || vis.distance === undefined || vis.distance === null) return undefined;
  const unit = (vis.unit ?? 'KILOMETERS').toUpperCase();
  // Normalize to kilometers first.
  let km: number;
  switch (unit) {
    case 'KILOMETERS':
      km = vis.distance;
      break;
    case 'MILES':
      km = vis.distance * 1.609344;
      break;
    case 'METERS':
      km = vis.distance / 1000;
      break;
    default:
      return `${vis.distance} ${vis.unit ?? ''}`.trim();
  }
  if (getCurrentUnitPreferences().system === 'imperial') {
    return withUnit(km / 1.609344, 'mi', 1);
  }
  return withUnit(km, 'km', 1);
}

function formatPressure(hpa: number | undefined): string | undefined {
  if (hpa === undefined || hpa === null) return undefined;
  return withUnit(hpa, 'mb', 1);
}

/**
 * Format a Google enum value ("RAIN_AND_SNOW", "EXTREME", "URGENCY_IMMEDIATE")
 * as sentence case ("Rain and snow", "Extreme", "Urgency immediate"). Returns
 * undefined for missing/empty input and for `*_UNKNOWN` sentinels (e.g.,
 * `SEVERITY_UNKNOWN`, `URGENCY_UNKNOWN`) — those carry no information and just
 * add noise. Unknown values still pass through normalized, so anything Google
 * adds in the future renders sensibly without a code change.
 */
function formatEnumLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const upper = value.trim().toUpperCase();
  if (!upper || upper === 'UNKNOWN' || upper.endsWith('_UNKNOWN')) return undefined;
  const normalized = upper.replace(/_/g, ' ').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatPrecipitationType(type: string | undefined): string | undefined {
  return formatEnumLabel(type);
}

function formatPrecipitationAmount(qpf: { quantity?: number; unit?: string } | undefined): string | undefined {
  if (!qpf || qpf.quantity === undefined || qpf.quantity === null) return undefined;
  const unit = (qpf.unit ?? 'MILLIMETERS').toUpperCase();
  // Normalize source quantity to millimeters.
  let mm: number;
  switch (unit) {
    case 'MILLIMETERS':
      mm = qpf.quantity;
      break;
    case 'CENTIMETERS':
      mm = qpf.quantity * 10;
      break;
    case 'INCHES':
      mm = qpf.quantity * 25.4;
      break;
    default:
      return `${qpf.quantity} ${qpf.unit ?? ''}`.trim();
  }
  if (getCurrentUnitPreferences().precipitation === 'inches') {
    return withUnit(mm / 25.4, 'in', 2);
  }
  return withUnit(mm, 'mm', 2);
}

const CARDINAL_ABBREVIATIONS: Record<string, string> = {
  NORTH: 'N',
  NORTH_NORTHEAST: 'NNE',
  NORTHEAST: 'NE',
  EAST_NORTHEAST: 'ENE',
  EAST: 'E',
  EAST_SOUTHEAST: 'ESE',
  SOUTHEAST: 'SE',
  SOUTH_SOUTHEAST: 'SSE',
  SOUTH: 'S',
  SOUTH_SOUTHWEST: 'SSW',
  SOUTHWEST: 'SW',
  WEST_SOUTHWEST: 'WSW',
  WEST: 'W',
  WEST_NORTHWEST: 'WNW',
  NORTHWEST: 'NW',
  NORTH_NORTHWEST: 'NNW',
};

/**
 * Map Google's enum-style cardinal names ("NORTH_NORTHWEST") to compass
 * abbreviations ("NNW"). Falls back to deriving the abbreviation from the
 * degrees if the enum value is missing or unrecognized.
 */
function abbreviateCardinal(cardinal: string | undefined, degrees?: number): string | undefined {
  if (cardinal) {
    const normalized = cardinal.toUpperCase().replace(/[\s-]/g, '_');
    if (CARDINAL_ABBREVIATIONS[normalized]) {
      return CARDINAL_ABBREVIATIONS[normalized];
    }
  }
  if (degrees === undefined || degrees === null || Number.isNaN(degrees)) return undefined;
  const d = ((degrees % 360) + 360) % 360;
  if (d < 11.25 || d >= 348.75) return 'N';
  if (d < 33.75) return 'NNE';
  if (d < 56.25) return 'NE';
  if (d < 78.75) return 'ENE';
  if (d < 101.25) return 'E';
  if (d < 123.75) return 'ESE';
  if (d < 146.25) return 'SE';
  if (d < 168.75) return 'SSE';
  if (d < 191.25) return 'S';
  if (d < 213.75) return 'SSW';
  if (d < 236.25) return 'SW';
  if (d < 258.75) return 'WSW';
  if (d < 281.25) return 'W';
  if (d < 303.75) return 'WNW';
  if (d < 326.25) return 'NW';
  if (d < 348.75) return 'NNW';
  return undefined;
}

/**
 * Format wind direction as `"226° SW"`. No space before the degree symbol so
 * the bearing reads naturally; the cardinal abbreviation provides separation.
 */
function formatWindDirection(wind: GoogleWind | undefined): string | undefined {
  const direction = wind?.direction;
  if (!direction || direction.degrees === undefined || direction.degrees === null) return undefined;
  const cardinal = abbreviateCardinal(direction.cardinal, direction.degrees);
  const base = `${Math.round(direction.degrees)}°`;
  return cardinal ? `${base} ${cardinal}` : base;
}

function getConditionText(weatherCondition: { description?: { text?: string } } | undefined): string | undefined {
  return weatherCondition?.description?.text || undefined;
}

/**
 * Build our slimmed AirQuality block from a Google AQI index entry. Returns
 * undefined when the index is missing an aqi value.
 */
function buildAirQuality(index: GoogleAirQualityIndex | undefined): AirQuality | undefined {
  if (!index || index.aqi === undefined || index.aqi === null) return undefined;
  return {
    aqi: index.aqi,
    category: index.category,
    dominant_pollutant: index.dominantPollutant,
    index_display_name: index.displayName,
  };
}

/**
 * Pick the best AQI index from the response, preferring the more responsive
 * scale when available.
 *
 * `aqi` is not normalized — each index uses its own scale (US EPA: 0–500,
 * higher = worse; Universal AQI: 0–100, higher = better; etc.) — so the
 * `index_display_name` we surface alongside the value is what tells the
 * consumer which scale they're reading.
 *
 * Priority:
 *   1. `usa_epa_nowcast` — the NowCast variant we explicitly request via
 *      `customLocalAqis` for US locations; tracks current conditions much
 *      better than the 24h-averaged default.
 *   2. Any other non-UAQI local index (e.g., `usa_epa`, `gbr_defra`,
 *      `fra_atmo`) — the regional default for non-US locations.
 *   3. UAQI — Google's universal index. Different scale (0–100, inverted),
 *      but better than nothing for regions Google has no local index for.
 */
function pickAqiIndex(indexes: GoogleAirQualityIndex[] | undefined): GoogleAirQualityIndex | undefined {
  if (!indexes || indexes.length === 0) return undefined;
  return (
    indexes.find((i) => i.code === 'usa_epa_nowcast') ??
    indexes.find((i) => i.code !== 'uaqi' && i.code !== 'usa_epa_nowcast') ??
    indexes.find((i) => i.code === 'uaqi')
  );
}

function airQualityFromCurrent(
  airQuality: GoogleCurrentAirQualityResponse | undefined
): AirQuality | undefined {
  if (!airQuality) return undefined;
  return buildAirQuality(pickAqiIndex(airQuality.indexes));
}

function airQualityFromHourly(entry: GoogleAirQualityHourlyEntry | undefined): AirQuality | undefined {
  if (!entry) return undefined;
  return buildAirQuality(pickAqiIndex(entry.indexes));
}

/**
 * Format the {year, month, day} object Google returns into a YYYY-MM-DD
 * string for direct comparison with the athlete's local "today".
 */
function formatPollenDate(date: GooglePollenDailyInfo['date']): string | undefined {
  if (!date || date.year === undefined || date.month === undefined || date.day === undefined) {
    return undefined;
  }
  const m = String(date.month).padStart(2, '0');
  const d = String(date.day).padStart(2, '0');
  return `${date.year}-${m}-${d}`;
}

/**
 * Bucket pollen entries for a given date by UPI value.
 *
 * Google emits one entry per pollen type (grass/tree/weed) and one per plant,
 * each with an `indexInfo.value`. We collapse those into UPI levels so the
 * model gets a single "what's elevated" view instead of N near-identical
 * blocks. Per-entry metadata we drop: `code` (enum string, redundant with
 * display name), `color` (presentation only), and `inSeason` (training
 * decisions hinge on the pollen value, not the calendar — if it's elevated,
 * that's what matters).
 *
 * Levels are sorted in descending order by UPI value so the worst conditions
 * surface first.
 *
 * Returns `undefined` if no entry matches the date, or if every entry has a
 * UPI value of 0 (no signal worth surfacing).
 */
function buildPollenForDate(
  pollen: GooglePollenForecastResponse | undefined,
  targetDate: string
): Pollen | undefined {
  if (!pollen?.dailyInfo || pollen.dailyInfo.length === 0) return undefined;
  const match = pollen.dailyInfo.find((info) => formatPollenDate(info.date) === targetDate);
  if (!match) return undefined;

  type Bucket = {
    category?: string;
    description?: string;
    pollen_types: string[];
    plants: string[];
  };
  const byValue = new Map<number, Bucket>();
  const ensureBucket = (value: number): Bucket => {
    let bucket = byValue.get(value);
    if (!bucket) {
      bucket = { pollen_types: [], plants: [] };
      byValue.set(value, bucket);
    }
    return bucket;
  };

  for (const t of match.pollenTypeInfo ?? []) {
    const v = t.indexInfo?.value;
    if (v === undefined || v <= 0 || !t.displayName) continue;
    const bucket = ensureBucket(v);
    bucket.category ??= t.indexInfo?.category;
    bucket.description ??= t.indexInfo?.indexDescription;
    bucket.pollen_types.push(t.displayName);
  }
  for (const p of match.plantInfo ?? []) {
    const v = p.indexInfo?.value;
    if (v === undefined || v <= 0 || !p.displayName) continue;
    const bucket = ensureBucket(v);
    bucket.category ??= p.indexInfo?.category;
    bucket.description ??= p.indexInfo?.indexDescription;
    bucket.plants.push(p.displayName);
  }

  if (byValue.size === 0) return undefined;

  const universal_pollen_index: PollenIndexLevel[] = [...byValue.entries()]
    .sort(([a], [b]) => b - a)
    .map(([value, bucket]) => ({
      value,
      category: bucket.category,
      description: bucket.description,
      pollen_types: bucket.pollen_types.length > 0 ? bucket.pollen_types : undefined,
      plants: bucket.plants.length > 0 ? bucket.plants : undefined,
    }));

  return {
    date: targetDate,
    universal_pollen_index,
  };
}

/**
 * Index hourly air-quality entries by their `dateTime` so each weather hour
 * can find a matching entry by `interval.startTime` in O(1). Both APIs emit
 * top-of-hour ISO timestamps, so direct string equality is reliable.
 */
function indexHourlyAirQuality(
  hourly: GoogleAirQualityHourlyResponse | undefined
): Map<string, GoogleAirQualityHourlyEntry> {
  const map = new Map<string, GoogleAirQualityHourlyEntry>();
  if (!hourly?.hourlyForecasts) return map;
  for (const entry of hourly.hourlyForecasts) {
    if (entry.dateTime) map.set(entry.dateTime, entry);
  }
  return map;
}

/** Pre-format an ISO datetime in the location's tz to a human-readable string,
 * skipping the recursive response formatter (which only knows the athlete's tz).
 * Returns undefined for missing/invalid input. */
function formatLocalDateTime(iso: string | undefined, locationTimezone: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return formatDateTimeHumanReadable(date, locationTimezone);
}

/**
 * Strip metadata and format the Google currentConditions response.
 * Returns null if the input is missing entirely. The optional
 * `airQuality` argument attaches the local AQI block under `air_quality`.
 */
export function transformCurrentConditions(
  current: GoogleCurrentConditionsResponse | undefined,
  locationTimezone: string,
  airQuality?: GoogleCurrentAirQualityResponse
): CurrentWeather | null {
  if (!current) return null;

  const precip = current.precipitation;
  return {
    as_of: formatLocalDateTime(current.currentTime, locationTimezone),
    condition: getConditionText(current.weatherCondition),
    daylight: current.isDaytime,
    cloud_cover: current.cloudCover !== undefined ? formatPercent(current.cloudCover) : undefined,
    humidity: current.relativeHumidity !== undefined ? formatPercent(current.relativeHumidity) : undefined,
    temperature: formatGoogleTemperature(current.temperature),
    temperature_apparent: formatGoogleTemperature(current.feelsLikeTemperature),
    temperature_dew_point: formatGoogleTemperature(current.dewPoint),
    temperature_heat_index: formatGoogleTemperature(current.heatIndex),
    temperature_wind_chill: formatGoogleTemperature(current.windChill),
    pressure: formatPressure(current.airPressure?.meanSeaLevelMillibars),
    precipitation_amount: formatPrecipitationAmount(precip?.qpf),
    precipitation_chance:
      precip?.probability?.percent !== undefined ? formatPercent(precip.probability.percent) : undefined,
    precipitation_type: formatPrecipitationType(precip?.probability?.type),
    thunderstorm_probability:
      current.thunderstormProbability !== undefined ? formatPercent(current.thunderstormProbability) : undefined,
    uv_index: current.uvIndex,
    visibility: formatGoogleVisibility(current.visibility),
    wind_direction: formatWindDirection(current.wind),
    wind_speed: formatGoogleSpeed(current.wind?.speed),
    wind_gust: formatGoogleSpeed(current.wind?.gust),
    air_quality: airQualityFromCurrent(airQuality),
  };
}

/**
 * Format one hour of Google's hourly forecast. Pass an optional matching
 * air-quality entry to attach the AQI block under `air_quality`. Datetime
 * fields are pre-formatted in the location's tz so the response-level
 * recursive formatter (which uses the athlete's tz) leaves them alone.
 */
export function transformForecastHour(
  hour: GoogleForecastHour,
  locationTimezone: string,
  airQualityEntry?: GoogleAirQualityHourlyEntry
): HourlyForecast {
  const precip = hour.precipitation;
  return {
    forecast_start: formatLocalDateTime(hour.interval?.startTime, locationTimezone),
    forecast_end: formatLocalDateTime(hour.interval?.endTime, locationTimezone),
    condition: getConditionText(hour.weatherCondition),
    daylight: hour.isDaytime,
    cloud_cover: hour.cloudCover !== undefined ? formatPercent(hour.cloudCover) : undefined,
    humidity: hour.relativeHumidity !== undefined ? formatPercent(hour.relativeHumidity) : undefined,
    precipitation_amount: formatPrecipitationAmount(precip?.qpf),
    precipitation_chance:
      precip?.probability?.percent !== undefined ? formatPercent(precip.probability.percent) : undefined,
    precipitation_type: formatPrecipitationType(precip?.probability?.type),
    thunderstorm_probability:
      hour.thunderstormProbability !== undefined ? formatPercent(hour.thunderstormProbability) : undefined,
    pressure: formatPressure(hour.airPressure?.meanSeaLevelMillibars),
    temperature: formatGoogleTemperature(hour.temperature),
    temperature_apparent: formatGoogleTemperature(hour.feelsLikeTemperature),
    temperature_dew_point: formatGoogleTemperature(hour.dewPoint),
    temperature_heat_index: formatGoogleTemperature(hour.heatIndex),
    temperature_wind_chill: formatGoogleTemperature(hour.windChill),
    temperature_wet_bulb: formatGoogleTemperature(hour.wetBulbTemperature),
    uv_index: hour.uvIndex,
    visibility: formatGoogleVisibility(hour.visibility),
    wind_direction: formatWindDirection(hour.wind),
    wind_speed: formatGoogleSpeed(hour.wind?.speed),
    wind_gust: formatGoogleSpeed(hour.wind?.gust),
    air_quality: airQualityFromHourly(airQualityEntry),
  };
}

/**
 * Filter the hourly forecast to "the rest of today" in the athlete's timezone:
 * keep hours that fall on today's local date and whose 1-hour window has not
 * fully elapsed (i.e. the in-progress hour and every later hour today).
 *
 * No daylight filter: nighttime hours of the same local day are kept too,
 * because plenty of training (early-morning runs, indoor trainer sessions,
 * post-sunset rides) cares about overnight conditions.
 */
export function filterHourlyToRestOfDay(
  hours: GoogleForecastHour[] | undefined,
  timezone: string,
  now: Date = new Date()
): GoogleForecastHour[] {
  if (!hours || hours.length === 0) return [];
  const today = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const cutoffMs = now.getTime() - 60 * 60 * 1000; // include the currently in-progress hour
  return hours.filter((h) => {
    const startTime = h.interval?.startTime;
    if (!startTime) return false;
    const startMs = new Date(startTime).getTime();
    if (Number.isNaN(startMs)) return false;
    if (startMs <= cutoffMs) return false;
    const localDate = formatInTimeZone(new Date(startMs), timezone, 'yyyy-MM-dd');
    return localDate === today;
  });
}

/**
 * Filter the hourly forecast to all hours that fall on a specific local date
 * in the athlete's timezone. Used for future-date forecasts where the full
 * 24-hour day is relevant (no "remaining hours" cutoff).
 */
export function filterHourlyToDate(
  hours: GoogleForecastHour[] | undefined,
  timezone: string,
  targetDate: string
): GoogleForecastHour[] {
  if (!hours || hours.length === 0) return [];
  return hours.filter((h) => {
    const startTime = h.interval?.startTime;
    if (!startTime) return false;
    const startMs = new Date(startTime).getTime();
    if (Number.isNaN(startMs)) return false;
    const localDate = formatInTimeZone(new Date(startMs), timezone, 'yyyy-MM-dd');
    return localDate === targetDate;
  });
}

/**
 * Format the {year, month, day} object Google emits on `displayDate` into a
 * YYYY-MM-DD string for direct comparison with the athlete's local "today".
 */
function formatDisplayDate(date: GoogleForecastDay['displayDate']): string | undefined {
  if (!date || date.year === undefined || date.month === undefined || date.day === undefined) {
    return undefined;
  }
  const m = String(date.month).padStart(2, '0');
  const d = String(date.day).padStart(2, '0');
  return `${date.year}-${m}-${d}`;
}

/**
 * Pick the daily-forecast entry whose `displayDate` matches `targetDate` in
 * the athlete's timezone. Google returns one entry per local day in
 * `forecastDays[]`. Returns undefined when nothing matches.
 */
function findDailyForecastForDate(
  daily: GoogleDailyForecastResponse | undefined,
  targetDate: string
): GoogleForecastDay | undefined {
  if (!daily?.forecastDays || daily.forecastDays.length === 0) return undefined;
  return daily.forecastDays.find((d) => formatDisplayDate(d.displayDate) === targetDate);
}

/**
 * Build the {sunrise, sunset} object from a matched daily-forecast entry.
 * Pre-formats both in the location's tz. Returns undefined when neither value
 * is present so the parent object can omit the field rather than emit `{}`.
 */
function buildSunEvents(
  day: GoogleForecastDay | undefined,
  locationTimezone: string
): SunEvents | undefined {
  const sunrise = formatLocalDateTime(day?.sunEvents?.sunriseTime, locationTimezone);
  const sunset = formatLocalDateTime(day?.sunEvents?.sunsetTime, locationTimezone);
  if (!sunrise && !sunset) return undefined;
  return { sunrise, sunset };
}

/**
 * Build the moon-events object from a matched daily-forecast entry. Picks the
 * first entry from `moonriseTimes` / `moonsetTimes` (typically a single value;
 * polar regions occasionally return multiples) and sentence-cases the lunar
 * phase via {@link formatEnumLabel}. Returns undefined when nothing usable.
 */
function buildMoonEvents(
  day: GoogleForecastDay | undefined,
  locationTimezone: string
): MoonEvents | undefined {
  const me = day?.moonEvents;
  if (!me) return undefined;
  const moon_phase = formatEnumLabel(me.moonPhase);
  const moonrise = formatLocalDateTime(me.moonriseTimes?.[0], locationTimezone);
  const moonset = formatLocalDateTime(me.moonsetTimes?.[0], locationTimezone);
  if (!moon_phase && !moonrise && !moonset) return undefined;
  return { moon_phase, moonrise, moonset };
}

/**
 * Assemble the daytime-period summary for a daily-forecast entry. The daytime
 * half is the relevant one for outdoor training decisions; whole-day fields
 * (max/min temperature, peak heat index, sun/moon events) come from the day
 * root, half-day fields (humidity, wind, condition, etc.) come from
 * `daytimeForecast`. Returns undefined if neither set carries any signal.
 */
function buildDailySummary(
  day: GoogleForecastDay | undefined,
  locationTimezone: string
): DailyForecastSummary | undefined {
  if (!day) return undefined;
  const dayPart: GoogleForecastDayPeriod | undefined = day.daytimeForecast;
  const precip = dayPart?.precipitation;
  const summary: DailyForecastSummary = {
    condition: getConditionText(dayPart?.weatherCondition),
    temperature_max: formatGoogleTemperature(day.maxTemperature),
    temperature_min: formatGoogleTemperature(day.minTemperature),
    temperature_max_apparent: formatGoogleTemperature(day.feelsLikeMaxTemperature),
    temperature_min_apparent: formatGoogleTemperature(day.feelsLikeMinTemperature),
    temperature_heat_index_max: formatGoogleTemperature(day.maxHeatIndex),
    cloud_cover: dayPart?.cloudCover !== undefined ? formatPercent(dayPart.cloudCover) : undefined,
    humidity:
      dayPart?.relativeHumidity !== undefined ? formatPercent(dayPart.relativeHumidity) : undefined,
    precipitation_amount: formatPrecipitationAmount(precip?.qpf),
    precipitation_chance:
      precip?.probability?.percent !== undefined
        ? formatPercent(precip.probability.percent)
        : undefined,
    precipitation_type: formatPrecipitationType(precip?.probability?.type),
    thunderstorm_probability:
      dayPart?.thunderstormProbability !== undefined
        ? formatPercent(dayPart.thunderstormProbability)
        : undefined,
    uv_index: dayPart?.uvIndex,
    wind_direction: formatWindDirection(dayPart?.wind),
    wind_speed: formatGoogleSpeed(dayPart?.wind?.speed),
    wind_gust: formatGoogleSpeed(dayPart?.wind?.gust),
    sun_events: buildSunEvents(day, locationTimezone),
    moon_events: buildMoonEvents(day, locationTimezone),
  };
  // Drop entirely if every field is undefined — nothing useful to surface.
  const hasAny = Object.values(summary).some((v) => v !== undefined);
  return hasAny ? summary : undefined;
}

function transformAlert(alert: GoogleWeatherAlert, locationTimezone: string): WeatherAlert {
  return {
    title: alert.alertTitle?.text,
    description: alert.description,
    event_type: formatEnumLabel(alert.eventType),
    area_name: alert.areaName,
    severity: formatEnumLabel(alert.severity),
    urgency: formatEnumLabel(alert.urgency),
    certainty: formatEnumLabel(alert.certainty),
    start_time: formatLocalDateTime(alert.startTime, locationTimezone),
    expiration_time: formatLocalDateTime(alert.expirationTime, locationTimezone),
    source: alert.dataSource?.name,
  };
}

// Higher number = more severe. Used to sort alerts EXTREME → MINOR.
const SEVERITY_RANK: Record<string, number> = {
  EXTREME: 4,
  SEVERE: 3,
  MODERATE: 2,
  MINOR: 1,
};

function severityRank(severity: string | undefined): number {
  if (!severity) return 0;
  return SEVERITY_RANK[severity.trim().toUpperCase()] ?? 0;
}

/**
 * Build the alert list for a forecast date in the location's timezone.
 *
 * - Drops alerts whose urgency is `PAST` (no action needed).
 * - Keeps only alerts whose `[startTime, expirationTime]` window intersects
 *   the target local day. For today this matches what most active alerts cover
 *   anyway; for future dates this is the gating that lets a Heat Advisory
 *   issued today for tomorrow show up on tomorrow's forecast.
 * - Sorts by severity descending so the most severe alert reads first.
 */
function selectAlerts(
  alerts: GoogleWeatherAlertsResponse | undefined,
  targetDate: string,
  locationTimezone: string
): WeatherAlert[] {
  const raw = alerts?.weatherAlerts ?? [];
  if (raw.length === 0) return [];

  // Local-day boundaries as UTC instants. `targetDate` is a YYYY-MM-DD in
  // `locationTimezone`; the day starts at 00:00 local on that date and ends at
  // 00:00 local on the following date. Computing both endpoints via
  // `fromZonedTime` handles DST (a local day can span 23 or 25 hours).
  const dayStartUtc = localDayStartToUtcMs(targetDate, locationTimezone);
  const dayEndUtc = localDayStartToUtcMs(addDaysToYMD(targetDate, 1), locationTimezone);

  const filtered = raw.filter((a) => {
    if (a.urgency && a.urgency.trim().toUpperCase() === 'PAST') return false;
    const startMs = a.startTime ? Date.parse(a.startTime) : Number.NEGATIVE_INFINITY;
    const endMs = a.expirationTime ? Date.parse(a.expirationTime) : Number.POSITIVE_INFINITY;
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return true;
    // Overlap: alert window and target day must intersect.
    return startMs < dayEndUtc && endMs > dayStartUtc;
  });

  filtered.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  return filtered.map((a) => transformAlert(a, locationTimezone));
}

/**
 * UTC millisecond instant of 00:00 local on `targetDate` in `timezone`.
 * Handles DST correctly via date-fns-tz's `fromZonedTime`.
 */
function localDayStartToUtcMs(targetDate: string, timezone: string): number {
  return fromZonedTime(`${targetDate}T00:00:00`, timezone).getTime();
}

/**
 * Build a per-location forecast from Google Weather + Air Quality + Pollen +
 * Elevation responses.
 *
 * `location` is the human-readable label from the athlete's Intervals.icu
 * weather config (e.g., "Home", "Moose"). The longer "City,Region,Country"
 * string is intentionally not surfaced — the label is what the athlete
 * recognizes when reading back a multi-location forecast.
 *
 * Air-quality, pollen, and elevation data are optional: if any of those
 * arguments are omitted (or come back with a non-OK status), the matching
 * field is just omitted on the output. Hourly AQ entries are matched to
 * weather hours by ISO timestamp (top-of-hour boundaries on both APIs), so a
 * missing entry for a given hour is silently skipped. The pollen response is
 * filtered to the entry whose date matches today in the athlete's timezone
 * (and to non-zero index values to keep the payload tight) — if nothing
 * remains, pollen is omitted from the location forecast.
 */
export function assembleLocationForecast(
  location: string,
  latitude: number,
  longitude: number,
  current: GoogleCurrentConditionsResponse | undefined,
  hourly: GoogleHourlyForecastResponse | undefined,
  alerts: GoogleWeatherAlertsResponse | undefined,
  locationTimezone: string,
  now: Date = new Date(),
  currentAirQuality?: GoogleCurrentAirQualityResponse,
  hourlyAirQuality?: GoogleAirQualityHourlyResponse,
  pollen?: GooglePollenForecastResponse,
  daily?: GoogleDailyForecastResponse,
  elevation?: GoogleElevationResponse
): LocationForecast {
  const todayLocal = formatInTimeZone(now, locationTimezone, 'yyyy-MM-dd');
  const filteredHours = filterHourlyToRestOfDay(hourly?.forecastHours, locationTimezone, now);
  const aqByHour = indexHourlyAirQuality(hourlyAirQuality);
  const pollenForToday = buildPollenForDate(pollen, todayLocal);
  const dailyForToday = findDailyForecastForDate(daily, todayLocal);
  const dailySummary = buildDailySummary(dailyForToday, locationTimezone);
  const elevationMeters =
    elevation?.status === 'OK' && typeof elevation.results?.[0]?.elevation === 'number'
      ? elevation.results[0].elevation
      : undefined;
  return {
    location,
    latitude,
    longitude,
    elevation: elevationMeters !== undefined ? formatLength(elevationMeters) : undefined,
    forecast_date: todayLocal,
    current_conditions: transformCurrentConditions(current, locationTimezone, currentAirQuality),
    daily_summary: dailySummary,
    hourly_forecast: filteredHours.map((h) => {
      const startTime = h.interval?.startTime;
      const aqEntry = startTime ? aqByHour.get(startTime) : undefined;
      return transformForecastHour(h, locationTimezone, aqEntry);
    }),
    alerts: selectAlerts(alerts, todayLocal, locationTimezone),
    pollen: pollenForToday,
  };
}

/**
 * Build a per-location forecast for a specific future date.
 *
 * Differences from {@link assembleLocationForecast}:
 * - No `current_conditions` — N/A for future dates.
 * - `alerts` are filtered to those whose effective window intersects the
 *   target local day; advisories issued today for tomorrow show up here.
 * - `hourly_forecast` covers the full 24 hours of the target date in the
 *   athlete's timezone.
 * - `pollen` is included only when the caller passes a response that contains
 *   a matching `dailyInfo` entry (the calling code gates on the Pollen API's
 *   5-day window before bothering to fetch).
 * - `air_quality` on hourly entries is included only for entries the AQ API
 *   actually covers (the calling code gates on the AQ API's 96-hour window
 *   before bothering to fetch).
 *
 * `location` is the human-readable label (Intervals.icu config label or the
 * geocoded `formattedAddress`). Per-API failures are isolated upstream so
 * `daily`, `hourly`, `pollen`, etc. may all be undefined independently.
 */
export function assembleFutureLocationForecast(
  location: string,
  latitude: number,
  longitude: number,
  targetDate: string,
  hourly: GoogleHourlyForecastResponse | undefined,
  daily: GoogleDailyForecastResponse | undefined,
  locationTimezone: string,
  hourlyAirQuality?: GoogleAirQualityHourlyResponse,
  pollen?: GooglePollenForecastResponse,
  elevation?: GoogleElevationResponse,
  alerts?: GoogleWeatherAlertsResponse
): LocationForecast {
  const filteredHours = filterHourlyToDate(hourly?.forecastHours, locationTimezone, targetDate);
  const aqByHour = indexHourlyAirQuality(hourlyAirQuality);
  const pollenForDate = buildPollenForDate(pollen, targetDate);
  const dailyForDate = findDailyForecastForDate(daily, targetDate);
  const dailySummary = buildDailySummary(dailyForDate, locationTimezone);
  const elevationMeters =
    elevation?.status === 'OK' && typeof elevation.results?.[0]?.elevation === 'number'
      ? elevation.results[0].elevation
      : undefined;
  return {
    location,
    latitude,
    longitude,
    elevation: elevationMeters !== undefined ? formatLength(elevationMeters) : undefined,
    forecast_date: targetDate,
    daily_summary: dailySummary,
    hourly_forecast: filteredHours.map((h) => {
      const startTime = h.interval?.startTime;
      const aqEntry = startTime ? aqByHour.get(startTime) : undefined;
      return transformForecastHour(h, locationTimezone, aqEntry);
    }),
    alerts: selectAlerts(alerts, targetDate, locationTimezone),
    pollen: pollenForDate,
  };
}
