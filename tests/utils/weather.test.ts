import { describe, it, expect } from 'vitest';
import {
  extractCountryCode,
  transformCurrentWeather,
  transformRestOfDay,
  transformHour,
  filterHourlyToRestOfDay,
  sortAlertsByPrecedence,
  assembleLocationForecast,
} from '../../src/utils/weather.js';
import type { WeatherKitWeatherResponse } from '../../src/clients/weatherkit.js';

describe('extractCountryCode', () => {
  it('returns the trailing token uppercased when it looks like an ISO Alpha-2 code', () => {
    expect(extractCountryCode('San Francisco,California,US')).toBe('US');
    expect(extractCountryCode('Paris,Île-de-France,fr')).toBe('FR');
  });

  it('returns the trailing token verbatim when it is not a 2-letter code', () => {
    expect(extractCountryCode('Munich,Bavaria,Germany')).toBe('Germany');
  });

  it('handles whitespace around tokens', () => {
    expect(extractCountryCode('Boise , Idaho , US ')).toBe('US');
  });

  it("returns null for an empty or all-whitespace input", () => {
    expect(extractCountryCode('')).toBe(null);
    expect(extractCountryCode('   ')).toBe(null);
    expect(extractCountryCode(',,,')).toBe(null);
  });
});

describe('transformCurrentWeather', () => {
  it('strips metadata and applies units', () => {
    const result = transformCurrentWeather({
      metadata: { latitude: 1, longitude: 2 },
      asOf: '2026-04-28T14:49:34Z',
      cloudCover: 0.18,
      conditionCode: 'MostlyClear',
      daylight: true,
      humidity: 0.58,
      precipitationIntensity: 0,
      pressure: 1021.47,
      pressureTrend: 'rising',
      temperature: 4.07,
      temperatureApparent: 3.48,
      temperatureDewPoint: -3.46,
      uvIndex: 2,
      visibility: 28833.47,
      windDirection: 226,
      windGust: 19.09,
      windSpeed: 12.12,
    });
    expect(result).toEqual({
      as_of: '2026-04-28T14:49:34Z',
      condition_code: 'MostlyClear',
      daylight: true,
      cloud_cover: '18%',
      humidity: '58%',
      temperature: '4.1 °C',
      temperature_apparent: '3.5 °C',
      temperature_dew_point: '-3.5 °C',
      pressure: '1021.5 mb',
      pressure_trend: 'rising',
      precipitation_intensity: '0.00 mm/h',
      uv_index: 2,
      visibility: '28833 m',
      wind_direction: '226° SW',
      wind_speed: '12.1 km/h',
      wind_gust: '19.1 km/h',
    });
  });

  it('returns null when input is undefined', () => {
    expect(transformCurrentWeather(undefined)).toBe(null);
  });

  it('renders the cardinal direction matching each compass wedge', () => {
    const cases: [number, string][] = [
      [0, '0° N'],
      [10, '10° N'],
      [22.5, '23° NE'],
      [45, '45° NE'],
      [67.5, '68° E'],
      [90, '90° E'],
      [112.5, '113° SE'],
      [157.5, '158° S'],
      [202.5, '203° SW'],
      [247.5, '248° W'],
      [292.5, '293° NW'],
      [337.5, '338° N'],
      [359, '359° N'],
    ];
    for (const [degrees, expected] of cases) {
      const result = transformCurrentWeather({ windDirection: degrees });
      expect(result?.wind_direction).toBe(expected);
    }
  });
});

describe('transformRestOfDay', () => {
  it('formats temperatures, precipitation, and wind', () => {
    const result = transformRestOfDay({
      forecastStart: '2026-04-28T14:49:34Z',
      forecastEnd: '2026-04-29T06:00:00Z',
      cloudCover: 0.33,
      conditionCode: 'MostlyClear',
      humidity: 0.36,
      precipitationAmount: 0,
      precipitationChance: 0,
      precipitationType: 'clear',
      snowfallAmount: 0,
      temperatureMax: 13.56,
      temperatureMin: 4.07,
      windDirection: 247,
      windGustSpeedMax: 25.57,
      windSpeed: 12.73,
      windSpeedMax: 15.22,
    });
    expect(result).toEqual({
      forecast_start: '2026-04-28T14:49:34Z',
      forecast_end: '2026-04-29T06:00:00Z',
      condition_code: 'MostlyClear',
      cloud_cover: '33%',
      humidity: '36%',
      precipitation_amount: '0.00 mm',
      precipitation_chance: '0%',
      precipitation_type: 'clear',
      snowfall_amount: '0.00 cm',
      temperature_max: '13.6 °C',
      temperature_min: '4.1 °C',
      wind_direction: '247° SW',
      wind_speed: '12.7 km/h',
      wind_speed_max: '15.2 km/h',
      wind_gust_speed_max: '25.6 km/h',
    });
  });
});

describe('transformHour', () => {
  it('formats an hour entry with all unit-bearing fields', () => {
    const result = transformHour({
      forecastStart: '2026-04-28T15:00:00Z',
      cloudCover: 0,
      conditionCode: 'Clear',
      daylight: true,
      humidity: 0.57,
      precipitationAmount: 0,
      precipitationIntensity: 0,
      precipitationChance: 0,
      precipitationType: 'clear',
      pressure: 1021.57,
      pressureTrend: 'rising',
      snowfallIntensity: 0,
      snowfallAmount: 0,
      temperature: 4.48,
      temperatureApparent: 4.74,
      temperatureDewPoint: -3.31,
      uvIndex: 2,
      visibility: 29115,
      windDirection: 231,
      windGust: 19.88,
      windSpeed: 12.26,
    });
    expect(result.condition_code).toBe('Clear');
    expect(result.temperature).toBe('4.5 °C');
    expect(result.humidity).toBe('57%');
    expect(result.wind_speed).toBe('12.3 km/h');
    expect(result.wind_gust).toBe('19.9 km/h');
    expect(result.pressure).toBe('1021.6 mb');
    expect(result.uv_index).toBe(2);
  });
});

describe('filterHourlyToRestOfDay', () => {
  // Athlete is in Boise (UTC-6 during DST). 2026-04-28T14:49:34Z is 08:49 local.
  const tz = 'America/Boise';
  const now = new Date('2026-04-28T14:49:34Z');

  const hours = [
    { forecastStart: '2026-04-28T04:00:00Z' }, // 22:00 prev day local — past
    { forecastStart: '2026-04-28T13:00:00Z' }, // 07:00 local — past
    { forecastStart: '2026-04-28T14:00:00Z' }, // 08:00 local — currently in progress, keep
    { forecastStart: '2026-04-28T15:00:00Z' }, // 09:00 local — future today, keep
    { forecastStart: '2026-04-28T23:00:00Z' }, // 17:00 local — future today, keep
    { forecastStart: '2026-04-29T05:00:00Z' }, // 23:00 local same day, keep
    { forecastStart: '2026-04-29T06:00:00Z' }, // 00:00 next day local — drop
    { forecastStart: '2026-04-29T13:00:00Z' }, // next day — drop
  ];

  it('keeps only hours in the local "today" that are not fully in the past', () => {
    const result = filterHourlyToRestOfDay(hours, tz, now);
    const starts = result.map((h) => h.forecastStart);
    expect(starts).toEqual([
      '2026-04-28T14:00:00Z', // in-progress hour
      '2026-04-28T15:00:00Z',
      '2026-04-28T23:00:00Z',
      '2026-04-29T05:00:00Z',
    ]);
  });

  it('returns [] when given undefined hours', () => {
    expect(filterHourlyToRestOfDay(undefined, tz, now)).toEqual([]);
  });

  it('drops hours explicitly marked daylight=false', () => {
    const dayHours = [
      { forecastStart: '2026-04-28T15:00:00Z', daylight: true },
      { forecastStart: '2026-04-28T23:00:00Z', daylight: true },
      { forecastStart: '2026-04-29T03:00:00Z', daylight: false }, // 21:00 local — drop
      { forecastStart: '2026-04-29T05:00:00Z', daylight: false }, // 23:00 local — drop
    ];
    const result = filterHourlyToRestOfDay(dayHours, tz, now);
    expect(result.map((h) => h.forecastStart)).toEqual([
      '2026-04-28T15:00:00Z',
      '2026-04-28T23:00:00Z',
    ]);
  });

  it('keeps hours with no daylight flag set', () => {
    const result = filterHourlyToRestOfDay(
      [{ forecastStart: '2026-04-28T15:00:00Z' }],
      tz,
      now
    );
    expect(result).toHaveLength(1);
  });
});

describe('sortAlertsByPrecedence', () => {
  it('sorts by ascending precedence with undefined precedence last', () => {
    const sorted = sortAlertsByPrecedence([
      { id: 'b', precedence: 1 },
      { id: 'd' }, // no precedence
      { id: 'a', precedence: 0 },
      { id: 'c', precedence: 2 },
    ]);
    expect(sorted.map((a) => a.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns [] for undefined input', () => {
    expect(sortAlertsByPrecedence(undefined)).toEqual([]);
  });
});

describe('assembleLocationForecast', () => {
  const tz = 'America/Boise';
  const now = new Date('2026-04-28T14:49:34Z');

  const sampleResponse: WeatherKitWeatherResponse = {
    currentWeather: {
      metadata: { latitude: 42.87, longitude: -112.58 },
      asOf: '2026-04-28T14:49:34Z',
      conditionCode: 'MostlyClear',
      temperature: 4.07,
      humidity: 0.58,
      windSpeed: 12.12,
    },
    forecastDaily: {
      metadata: {},
      days: [
        {
          forecastStart: '2026-04-28T06:00:00Z',
          forecastEnd: '2026-04-29T06:00:00Z',
          conditionCode: 'MostlyClear',
          restOfDayForecast: {
            forecastStart: '2026-04-28T14:49:34Z',
            forecastEnd: '2026-04-29T06:00:00Z',
            cloudCover: 0.33,
            conditionCode: 'MostlyClear',
            humidity: 0.36,
            temperatureMax: 13.56,
            temperatureMin: 4.07,
          },
        },
      ],
    },
    forecastHourly: {
      metadata: {},
      hours: [
        { forecastStart: '2026-04-28T13:00:00Z', temperature: -0.47 }, // past — drop
        { forecastStart: '2026-04-28T14:00:00Z', temperature: 1.98 }, // current
        { forecastStart: '2026-04-28T20:00:00Z', temperature: 12.01 }, // future today
        { forecastStart: '2026-04-29T13:00:00Z', temperature: 1.28 }, // tomorrow — drop
      ],
    },
    weatherAlerts: {
      detailsUrl: 'https://example.com/alerts',
      alerts: [
        { id: 'watch', precedence: 0, description: 'Freeze Watch' },
        { id: 'warning', precedence: 1, description: 'Freeze Warning' },
      ],
    },
  };

  it('produces a slimmed, formatted forecast for the location', () => {
    const result = assembleLocationForecast(
      'Pocatello,Idaho,US',
      42.87,
      -112.58,
      sampleResponse,
      tz,
      now
    );

    expect(result.location).toBe('Pocatello,Idaho,US');
    expect(result.latitude).toBe(42.87);
    expect(result.longitude).toBe(-112.58);

    expect(result.current_weather).toMatchObject({
      condition_code: 'MostlyClear',
      temperature: '4.1 °C',
      humidity: '58%',
      wind_speed: '12.1 km/h',
    });
    // metadata stripped
    expect(result.current_weather).not.toHaveProperty('metadata');

    expect(result.rest_of_day_forecast).toMatchObject({
      condition_code: 'MostlyClear',
      temperature_max: '13.6 °C',
      temperature_min: '4.1 °C',
    });

    expect(result.hourly_forecast.map((h) => h.forecast_start)).toEqual([
      '2026-04-28T14:00:00Z', // in-progress hour
      '2026-04-28T20:00:00Z',
    ]);

    // Alerts kept and sorted by precedence (watch precedence=0 wins over warning precedence=1)
    expect(result.alerts.map((a) => a.id)).toEqual(['watch', 'warning']);
    expect(result.alerts[0].description).toBe('Freeze Watch');
  });

  it('handles missing datasets gracefully', () => {
    const result = assembleLocationForecast('X,Y,US', 0, 0, {}, tz, now);
    expect(result).toEqual({
      location: 'X,Y,US',
      latitude: 0,
      longitude: 0,
      current_weather: null,
      rest_of_day_forecast: null,
      hourly_forecast: [],
      alerts: [],
    });
  });
});
