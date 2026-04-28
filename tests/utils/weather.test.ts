import { describe, it, expect } from 'vitest';
import {
  transformCurrentConditions,
  transformForecastHour,
  filterHourlyToRestOfDay,
  assembleLocationForecast,
} from '../../src/utils/weather.js';
import type {
  GoogleCurrentConditionsResponse,
  GoogleForecastHour,
  GoogleHourlyForecastResponse,
  GoogleWeatherAlertsResponse,
} from '../../src/clients/google-weather.js';

describe('transformCurrentConditions', () => {
  it('formats every value-with-unit field from Google into our flat shape', () => {
    const result = transformCurrentConditions({
      currentTime: '2025-01-28T22:04:12.025273178Z',
      isDaytime: true,
      weatherCondition: {
        description: { text: 'Sunny', languageCode: 'en' },
        type: 'CLEAR',
      },
      temperature: { degrees: 13.7, unit: 'CELSIUS' },
      feelsLikeTemperature: { degrees: 13.1, unit: 'CELSIUS' },
      dewPoint: { degrees: 1.1, unit: 'CELSIUS' },
      heatIndex: { degrees: 13.7, unit: 'CELSIUS' },
      windChill: { degrees: 13.1, unit: 'CELSIUS' },
      relativeHumidity: 42,
      uvIndex: 1,
      precipitation: {
        probability: { percent: 0, type: 'RAIN' },
        qpf: { quantity: 0, unit: 'MILLIMETERS' },
      },
      thunderstormProbability: 0,
      airPressure: { meanSeaLevelMillibars: 1019.16 },
      wind: {
        direction: { degrees: 335, cardinal: 'NORTH_NORTHWEST' },
        speed: { value: 8, unit: 'KILOMETERS_PER_HOUR' },
        gust: { value: 18, unit: 'KILOMETERS_PER_HOUR' },
      },
      visibility: { distance: 16, unit: 'KILOMETERS' },
      cloudCover: 0,
    });

    expect(result).toEqual({
      as_of: '2025-01-28T22:04:12.025273178Z',
      condition: 'Sunny',
      daylight: true,
      cloud_cover: '0%',
      humidity: '42%',
      temperature: '13.7 °C',
      temperature_apparent: '13.1 °C',
      temperature_dew_point: '1.1 °C',
      temperature_heat_index: '13.7 °C',
      temperature_wind_chill: '13.1 °C',
      pressure: '1019.2 mb',
      precipitation_amount: '0.00 mm',
      precipitation_chance: '0%',
      precipitation_type: 'RAIN',
      thunderstorm_probability: '0%',
      uv_index: 1,
      visibility: '16.0 km',
      wind_direction: '335° NNW',
      wind_speed: '8.0 km/h',
      wind_gust: '18.0 km/h',
    });
  });

  it('returns null when input is undefined', () => {
    expect(transformCurrentConditions(undefined)).toBe(null);
  });

  it('derives the cardinal abbreviation from degrees when Google omits the cardinal', () => {
    const cases: [number, string][] = [
      [0, '0° N'],
      [10, '10° N'],
      [22, '22° NNE'],
      [45, '45° NE'],
      [90, '90° E'],
      [135, '135° SE'],
      [180, '180° S'],
      [225, '225° SW'],
      [270, '270° W'],
      [315, '315° NW'],
      [359, '359° N'],
    ];
    for (const [degrees, expected] of cases) {
      const result = transformCurrentConditions({
        wind: { direction: { degrees } },
      });
      expect(result?.wind_direction).toBe(expected);
    }
  });

  it('converts Fahrenheit responses to Celsius before formatting', () => {
    const result = transformCurrentConditions({
      temperature: { degrees: 50, unit: 'FAHRENHEIT' },
    });
    expect(result?.temperature).toBe('10.0 °C');
  });

  it('omits unit-bearing fields when their inputs are missing', () => {
    const result = transformCurrentConditions({
      currentTime: '2025-01-28T22:04:12Z',
      weatherCondition: { description: { text: 'Sunny' } },
    });
    expect(result?.condition).toBe('Sunny');
    expect(result?.temperature).toBeUndefined();
    expect(result?.wind_speed).toBeUndefined();
    expect(result?.wind_direction).toBeUndefined();
  });
});

describe('transformForecastHour', () => {
  it('formats an hour entry with all unit-bearing fields', () => {
    const hour: GoogleForecastHour = {
      interval: {
        startTime: '2025-02-05T23:00:00Z',
        endTime: '2025-02-06T00:00:00Z',
      },
      isDaytime: true,
      weatherCondition: { description: { text: 'Sunny' } },
      temperature: { degrees: 12.7, unit: 'CELSIUS' },
      feelsLikeTemperature: { degrees: 12, unit: 'CELSIUS' },
      dewPoint: { degrees: 2.7, unit: 'CELSIUS' },
      heatIndex: { degrees: 12.7, unit: 'CELSIUS' },
      windChill: { degrees: 12, unit: 'CELSIUS' },
      relativeHumidity: 51,
      uvIndex: 1,
      precipitation: {
        probability: { percent: 0, type: 'RAIN' },
        qpf: { quantity: 0, unit: 'MILLIMETERS' },
      },
      thunderstormProbability: 5,
      airPressure: { meanSeaLevelMillibars: 1019.13 },
      wind: {
        direction: { degrees: 335, cardinal: 'NORTH_NORTHWEST' },
        speed: { value: 10, unit: 'KILOMETERS_PER_HOUR' },
        gust: { value: 19, unit: 'KILOMETERS_PER_HOUR' },
      },
      visibility: { distance: 16, unit: 'KILOMETERS' },
      cloudCover: 0,
    };
    const result = transformForecastHour(hour);
    expect(result.forecast_start).toBe('2025-02-05T23:00:00Z');
    expect(result.forecast_end).toBe('2025-02-06T00:00:00Z');
    expect(result.condition).toBe('Sunny');
    expect(result.daylight).toBe(true);
    expect(result.temperature).toBe('12.7 °C');
    expect(result.humidity).toBe('51%');
    expect(result.wind_speed).toBe('10.0 km/h');
    expect(result.wind_gust).toBe('19.0 km/h');
    expect(result.pressure).toBe('1019.1 mb');
    expect(result.thunderstorm_probability).toBe('5%');
    expect(result.precipitation_chance).toBe('0%');
    expect(result.precipitation_type).toBe('RAIN');
    expect(result.uv_index).toBe(1);
  });
});

describe('filterHourlyToRestOfDay', () => {
  // Athlete is in Boise (UTC-6 during DST). 2026-04-28T14:49:34Z is 08:49 local.
  const tz = 'America/Boise';
  const now = new Date('2026-04-28T14:49:34Z');

  const hours: GoogleForecastHour[] = [
    { interval: { startTime: '2026-04-28T04:00:00Z' } }, // 22:00 prev day local — past
    { interval: { startTime: '2026-04-28T13:00:00Z' } }, // 07:00 local — past
    { interval: { startTime: '2026-04-28T14:00:00Z' } }, // 08:00 local — currently in progress, keep
    { interval: { startTime: '2026-04-28T15:00:00Z' } }, // 09:00 local — future today, keep
    { interval: { startTime: '2026-04-28T23:00:00Z' } }, // 17:00 local — future today, keep
    { interval: { startTime: '2026-04-29T05:00:00Z' } }, // 23:00 local same day, keep
    { interval: { startTime: '2026-04-29T06:00:00Z' } }, // 00:00 next day local — drop
    { interval: { startTime: '2026-04-29T13:00:00Z' } }, // next day — drop
  ];

  it('keeps only hours in the local "today" that are not fully in the past', () => {
    const result = filterHourlyToRestOfDay(hours, tz, now);
    const starts = result.map((h) => h.interval?.startTime);
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

  it('drops hours explicitly marked isDaytime=false', () => {
    const dayHours: GoogleForecastHour[] = [
      { interval: { startTime: '2026-04-28T15:00:00Z' }, isDaytime: true },
      { interval: { startTime: '2026-04-28T23:00:00Z' }, isDaytime: true },
      { interval: { startTime: '2026-04-29T03:00:00Z' }, isDaytime: false }, // 21:00 local — drop
      { interval: { startTime: '2026-04-29T05:00:00Z' }, isDaytime: false }, // 23:00 local — drop
    ];
    const result = filterHourlyToRestOfDay(dayHours, tz, now);
    expect(result.map((h) => h.interval?.startTime)).toEqual([
      '2026-04-28T15:00:00Z',
      '2026-04-28T23:00:00Z',
    ]);
  });

  it('keeps hours with no isDaytime flag set', () => {
    const result = filterHourlyToRestOfDay(
      [{ interval: { startTime: '2026-04-28T15:00:00Z' } }],
      tz,
      now
    );
    expect(result).toHaveLength(1);
  });
});

describe('assembleLocationForecast', () => {
  const tz = 'America/Boise';
  const now = new Date('2026-04-28T14:49:34Z');

  const current: GoogleCurrentConditionsResponse = {
    currentTime: '2026-04-28T14:49:34Z',
    weatherCondition: { description: { text: 'Mostly clear' } },
    temperature: { degrees: 4.07, unit: 'CELSIUS' },
    relativeHumidity: 58,
    wind: {
      direction: { degrees: 226, cardinal: 'SOUTHWEST' },
      speed: { value: 12.12, unit: 'KILOMETERS_PER_HOUR' },
    },
  };

  const hourly: GoogleHourlyForecastResponse = {
    forecastHours: [
      // past — drop
      {
        interval: { startTime: '2026-04-28T13:00:00Z' },
        temperature: { degrees: -0.47, unit: 'CELSIUS' },
      },
      // currently in progress — keep
      {
        interval: { startTime: '2026-04-28T14:00:00Z' },
        temperature: { degrees: 1.98, unit: 'CELSIUS' },
      },
      // future today — keep
      {
        interval: { startTime: '2026-04-28T20:00:00Z' },
        temperature: { degrees: 12.01, unit: 'CELSIUS' },
      },
      // tomorrow — drop
      {
        interval: { startTime: '2026-04-29T13:00:00Z' },
        temperature: { degrees: 1.28, unit: 'CELSIUS' },
      },
    ],
  };

  const alerts: GoogleWeatherAlertsResponse = {
    weatherAlerts: [
      {
        alertTitle: { text: 'Freeze Watch' },
        description: 'Temperatures dropping below freezing tonight.',
        severity: 'MODERATE',
        startTime: '2026-04-29T00:00:00Z',
        expirationTime: '2026-04-29T12:00:00Z',
        dataSource: { name: 'National Weather Service' },
      },
    ],
  };

  it('produces a slimmed, formatted forecast for the location', () => {
    const result = assembleLocationForecast(
      'Pocatello,Idaho,US',
      42.87,
      -112.58,
      current,
      hourly,
      alerts,
      tz,
      now
    );

    expect(result.location).toBe('Pocatello,Idaho,US');
    expect(result.latitude).toBe(42.87);
    expect(result.longitude).toBe(-112.58);

    expect(result.current_weather).toMatchObject({
      condition: 'Mostly clear',
      temperature: '4.1 °C',
      humidity: '58%',
      wind_direction: '226° SW',
      wind_speed: '12.1 km/h',
    });

    expect(result.hourly_forecast.map((h) => h.forecast_start)).toEqual([
      '2026-04-28T14:00:00Z', // in-progress hour
      '2026-04-28T20:00:00Z',
    ]);

    expect(result.alerts).toEqual([
      {
        title: 'Freeze Watch',
        description: 'Temperatures dropping below freezing tonight.',
        severity: 'MODERATE',
        start_time: '2026-04-29T00:00:00Z',
        expiration_time: '2026-04-29T12:00:00Z',
        source: 'National Weather Service',
      },
    ]);
  });

  it('handles missing datasets gracefully', () => {
    const result = assembleLocationForecast('X,Y,US', 0, 0, undefined, undefined, undefined, tz, now);
    expect(result).toEqual({
      location: 'X,Y,US',
      latitude: 0,
      longitude: 0,
      current_weather: null,
      hourly_forecast: [],
      alerts: [],
    });
  });
});
