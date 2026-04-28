import { formatInTimeZone } from 'date-fns-tz';
import { formatTemperature, formatPercent, withUnit } from './format-units.js';
import type {
  GoogleCurrentConditionsResponse,
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
  CurrentWeather,
  HourlyForecast,
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

/**
 * Format a value-with-unit speed object (e.g., wind speed/gust). Google emits
 * "KILOMETERS_PER_HOUR" / "MILES_PER_HOUR" enum strings; we surface the unit
 * as the conventional "km/h" or "mph" abbreviation. Unknown units pass through
 * verbatim — better to be honest than silently mis-label.
 */
function formatGoogleSpeed(speed: GoogleSpeed | undefined): string | undefined {
  if (!speed || speed.value === undefined || speed.value === null) return undefined;
  const unit = (speed.unit ?? 'KILOMETERS_PER_HOUR').toUpperCase();
  switch (unit) {
    case 'KILOMETERS_PER_HOUR':
      return withUnit(speed.value, 'km/h', 1);
    case 'MILES_PER_HOUR':
      return withUnit(speed.value, 'mph', 1);
    case 'METERS_PER_SECOND':
      return withUnit(speed.value, 'm/s', 1);
    case 'KNOTS':
      return withUnit(speed.value, 'kn', 1);
    default:
      return `${speed.value.toFixed(1)} ${speed.unit ?? ''}`.trim();
  }
}

function formatGoogleVisibility(vis: GoogleVisibility | undefined): string | undefined {
  if (!vis || vis.distance === undefined || vis.distance === null) return undefined;
  const unit = (vis.unit ?? 'KILOMETERS').toUpperCase();
  switch (unit) {
    case 'KILOMETERS':
      return withUnit(vis.distance, 'km', 1);
    case 'MILES':
      return withUnit(vis.distance, 'mi', 1);
    case 'METERS':
      return withUnit(vis.distance, 'm', 0);
    default:
      return `${vis.distance} ${vis.unit ?? ''}`.trim();
  }
}

function formatPressure(hpa: number | undefined): string | undefined {
  if (hpa === undefined || hpa === null) return undefined;
  return withUnit(hpa, 'mb', 1);
}

function formatPrecipitationAmount(qpf: { quantity?: number; unit?: string } | undefined): string | undefined {
  if (!qpf || qpf.quantity === undefined || qpf.quantity === null) return undefined;
  const unit = (qpf.unit ?? 'MILLIMETERS').toUpperCase();
  switch (unit) {
    case 'MILLIMETERS':
      return withUnit(qpf.quantity, 'mm', 2);
    case 'CENTIMETERS':
      return withUnit(qpf.quantity, 'cm', 2);
    case 'INCHES':
      return withUnit(qpf.quantity, 'in', 2);
    default:
      return `${qpf.quantity} ${qpf.unit ?? ''}`.trim();
  }
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
 * Strip metadata and format the Google currentConditions response.
 * Returns null if the input is missing entirely.
 */
export function transformCurrentConditions(
  current: GoogleCurrentConditionsResponse | undefined
): CurrentWeather | null {
  if (!current) return null;

  const precip = current.precipitation;
  return {
    as_of: current.currentTime,
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
    precipitation_type: precip?.probability?.type,
    thunderstorm_probability:
      current.thunderstormProbability !== undefined ? formatPercent(current.thunderstormProbability) : undefined,
    uv_index: current.uvIndex,
    visibility: formatGoogleVisibility(current.visibility),
    wind_direction: formatWindDirection(current.wind),
    wind_speed: formatGoogleSpeed(current.wind?.speed),
    wind_gust: formatGoogleSpeed(current.wind?.gust),
  };
}

/**
 * Format one hour of Google's hourly forecast.
 */
export function transformForecastHour(hour: GoogleForecastHour): HourlyForecast {
  const precip = hour.precipitation;
  return {
    forecast_start: hour.interval?.startTime,
    forecast_end: hour.interval?.endTime,
    condition: getConditionText(hour.weatherCondition),
    daylight: hour.isDaytime,
    cloud_cover: hour.cloudCover !== undefined ? formatPercent(hour.cloudCover) : undefined,
    humidity: hour.relativeHumidity !== undefined ? formatPercent(hour.relativeHumidity) : undefined,
    precipitation_amount: formatPrecipitationAmount(precip?.qpf),
    precipitation_chance:
      precip?.probability?.percent !== undefined ? formatPercent(precip.probability.percent) : undefined,
    precipitation_type: precip?.probability?.type,
    thunderstorm_probability:
      hour.thunderstormProbability !== undefined ? formatPercent(hour.thunderstormProbability) : undefined,
    pressure: formatPressure(hour.airPressure?.meanSeaLevelMillibars),
    temperature: formatGoogleTemperature(hour.temperature),
    temperature_apparent: formatGoogleTemperature(hour.feelsLikeTemperature),
    temperature_dew_point: formatGoogleTemperature(hour.dewPoint),
    temperature_heat_index: formatGoogleTemperature(hour.heatIndex),
    temperature_wind_chill: formatGoogleTemperature(hour.windChill),
    uv_index: hour.uvIndex,
    visibility: formatGoogleVisibility(hour.visibility),
    wind_direction: formatWindDirection(hour.wind),
    wind_speed: formatGoogleSpeed(hour.wind?.speed),
    wind_gust: formatGoogleSpeed(hour.wind?.gust),
  };
}

/**
 * Filter the hourly forecast to "the rest of today" in the athlete's timezone:
 * keep hours that fall on today's local date and whose 1-hour window has not
 * fully elapsed (i.e. the in-progress hour and every later hour today).
 *
 * Drops any hour explicitly marked `isDaytime: false` — for outdoor training
 * the dark hours of the evening aren't useful and just inflate the payload.
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
    if (h.isDaytime === false) return false;
    const startMs = new Date(startTime).getTime();
    if (Number.isNaN(startMs)) return false;
    if (startMs <= cutoffMs) return false;
    const localDate = formatInTimeZone(new Date(startMs), timezone, 'yyyy-MM-dd');
    return localDate === today;
  });
}

function transformAlert(alert: GoogleWeatherAlert): WeatherAlert {
  return {
    title: alert.alertTitle?.text,
    description: alert.description,
    severity: alert.severity,
    start_time: alert.startTime,
    expiration_time: alert.expirationTime,
    source: alert.dataSource?.name,
  };
}

/**
 * Build a per-location forecast from the three Google Weather API responses.
 *
 * `location` is the full location string from the athlete's Intervals.icu
 * weather config (e.g., "Moose,Wyoming,US") — preferred over the shorter label
 * because it conveys region/country context to the model.
 */
export function assembleLocationForecast(
  location: string,
  latitude: number,
  longitude: number,
  current: GoogleCurrentConditionsResponse | undefined,
  hourly: GoogleHourlyForecastResponse | undefined,
  alerts: GoogleWeatherAlertsResponse | undefined,
  timezone: string,
  now: Date = new Date()
): LocationForecast {
  const filteredHours = filterHourlyToRestOfDay(hourly?.forecastHours, timezone, now);
  return {
    location,
    latitude,
    longitude,
    current_weather: transformCurrentConditions(current),
    hourly_forecast: filteredHours.map(transformForecastHour),
    alerts: (alerts?.weatherAlerts ?? []).map(transformAlert),
  };
}
