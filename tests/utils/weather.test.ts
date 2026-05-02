import { describe, it, expect } from 'vitest';
import {
  transformCurrentConditions,
  transformForecastHour,
  filterHourlyToRestOfDay,
  assembleLocationForecast,
} from '../../src/utils/weather.js';
import { runWithUnitPreferences } from '../../src/utils/unit-context.js';
import type { UnitPreferences } from '../../src/types/index.js';
import type {
  GoogleCurrentConditionsResponse,
  GoogleDailyForecastResponse,
  GoogleForecastHour,
  GoogleHourlyForecastResponse,
  GoogleWeatherAlertsResponse,
} from '../../src/clients/google-weather.js';
import type {
  GoogleAirQualityHourlyResponse,
  GoogleCurrentAirQualityResponse,
} from '../../src/clients/google-air-quality.js';
import type { GooglePollenForecastResponse } from '../../src/clients/google-pollen.js';
import type { GoogleElevationResponse } from '../../src/clients/google-elevation.js';

describe('transformCurrentConditions', () => {
  const tz = 'America/Boise';

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
    }, tz);

    // `as_of` is pre-formatted in the location's tz so it doesn't get
    // re-formatted (in the wrong tz) by the response-level formatter.
    expect(result?.as_of).toMatch(/at .* MST$/);
    expect(result).toMatchObject({
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
      precipitation_type: 'Rain',
      thunderstorm_probability: '0%',
      uv_index: 1,
      visibility: '16.0 km',
      wind_direction: '335° NNW',
      wind_speed: '8.0 km/h',
      wind_gust: '18.0 km/h',
    });
  });

  it('returns null when input is undefined', () => {
    expect(transformCurrentConditions(undefined, tz)).toBe(null);
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
      }, tz);
      expect(result?.wind_direction).toBe(expected);
    }
  });

  it('converts Fahrenheit responses to Celsius before formatting', () => {
    const result = transformCurrentConditions({
      temperature: { degrees: 50, unit: 'FAHRENHEIT' },
    }, tz);
    expect(result?.temperature).toBe('10.0 °C');
  });

  it('omits unit-bearing fields when their inputs are missing', () => {
    const result = transformCurrentConditions({
      currentTime: '2025-01-28T22:04:12Z',
      weatherCondition: { description: { text: 'Sunny' } },
    }, tz);
    expect(result?.condition).toBe('Sunny');
    expect(result?.temperature).toBeUndefined();
    expect(result?.wind_speed).toBeUndefined();
    expect(result?.wind_direction).toBeUndefined();
  });

  describe('preference-aware unit formatting', () => {
    const tz = 'America/Boise';

    const baseInput = {
      currentTime: '2025-01-28T22:04:12Z',
      temperature: { degrees: 0, unit: 'CELSIUS' as const },
      relativeHumidity: 50,
      precipitation: {
        probability: { percent: 10, type: 'RAIN' as const },
        qpf: { quantity: 25.4, unit: 'MILLIMETERS' as const }, // exactly 1.00 in
      },
      airPressure: { meanSeaLevelMillibars: 1013 },
      wind: {
        direction: { degrees: 90, cardinal: 'EAST' as const },
        // 10 m/s — convenient round value across all wind units
        speed: { value: 36, unit: 'KILOMETERS_PER_HOUR' as const },
      },
      visibility: { distance: 16.09344, unit: 'KILOMETERS' as const }, // ≈ 10 mi
    };

    const prefs = (overrides: Partial<UnitPreferences>): UnitPreferences => ({
      system: 'metric',
      weight: 'kg',
      temperature: 'celsius',
      wind: 'kmh',
      precipitation: 'mm',
      height: 'cm',
      ...overrides,
    });

    it('renders wind in mph, m/s, knots, and Beaufort per preference', () => {
      runWithUnitPreferences(prefs({ wind: 'mph' }), () => {
        expect(transformCurrentConditions(baseInput, tz)?.wind_speed).toBe('22.4 mph');
      });
      runWithUnitPreferences(prefs({ wind: 'mps' }), () => {
        expect(transformCurrentConditions(baseInput, tz)?.wind_speed).toBe('10.0 m/s');
      });
      runWithUnitPreferences(prefs({ wind: 'knots' }), () => {
        expect(transformCurrentConditions(baseInput, tz)?.wind_speed).toBe('19.4 kn');
      });
      runWithUnitPreferences(prefs({ wind: 'bft' }), () => {
        // 10 m/s falls into force 5 (8.0–10.7 m/s)
        expect(transformCurrentConditions(baseInput, tz)?.wind_speed).toBe('5 Bft');
      });
    });

    it('renders precipitation in inches when the user prefers it', () => {
      runWithUnitPreferences(prefs({ precipitation: 'inches' }), () => {
        expect(transformCurrentConditions(baseInput, tz)?.precipitation_amount).toBe('1.00 in');
      });
    });

    it('renders temperature in Fahrenheit when the user prefers it', () => {
      runWithUnitPreferences(prefs({ temperature: 'fahrenheit' }), () => {
        expect(transformCurrentConditions(baseInput, tz)?.temperature).toBe('32.0 °F');
      });
    });

    it('renders visibility in miles when the system is imperial', () => {
      runWithUnitPreferences(prefs({ system: 'imperial' }), () => {
        expect(transformCurrentConditions(baseInput, tz)?.visibility).toBe('10.0 mi');
      });
    });

    it('classifies Beaufort thresholds correctly', () => {
      // Boundary cases: 0.29 m/s → 0, 0.31 → 1, 32.7 → 12, 32.69 → 11
      const speedAt = (mps: number) => ({
        ...baseInput,
        wind: { ...baseInput.wind, speed: { value: mps, unit: 'METERS_PER_SECOND' as const } },
      });
      runWithUnitPreferences(prefs({ wind: 'bft' }), () => {
        expect(transformCurrentConditions(speedAt(0.29), tz)?.wind_speed).toBe('0 Bft');
        expect(transformCurrentConditions(speedAt(0.31), tz)?.wind_speed).toBe('1 Bft');
        expect(transformCurrentConditions(speedAt(32.69), tz)?.wind_speed).toBe('11 Bft');
        expect(transformCurrentConditions(speedAt(32.7), tz)?.wind_speed).toBe('12 Bft');
        expect(transformCurrentConditions(speedAt(50), tz)?.wind_speed).toBe('12 Bft');
      });
    });
  });

  describe('precipitation type formatting', () => {
    const tz = 'America/Boise';
    const withPrecipType = (type: string) => ({
      precipitation: { probability: { percent: 50, type } },
    });

    it('renders Google enum-style precipitation types as sentence case', () => {
      expect(transformCurrentConditions(withPrecipType('RAIN'), tz)?.precipitation_type).toBe('Rain');
      expect(transformCurrentConditions(withPrecipType('SNOW'), tz)?.precipitation_type).toBe('Snow');
      expect(transformCurrentConditions(withPrecipType('RAIN_AND_SNOW'), tz)?.precipitation_type).toBe('Rain and snow');
      expect(transformCurrentConditions(withPrecipType('LIGHT_RAIN'), tz)?.precipitation_type).toBe('Light rain');
    });

    it('returns undefined for missing or empty precipitation type', () => {
      expect(transformCurrentConditions({ precipitation: {} }, tz)?.precipitation_type).toBeUndefined();
      expect(transformCurrentConditions(withPrecipType(''), tz)?.precipitation_type).toBeUndefined();
    });
  });
});

describe('transformForecastHour', () => {
  const tz = 'America/Boise';

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
    const result = transformForecastHour(hour, tz);
    // forecast_start/end are pre-formatted in the location's tz so the
    // response-level formatter (which only knows the athlete's tz) leaves
    // them alone. Expect a human-readable string with the location's tz abbr.
    expect(result.forecast_start).toMatch(/at 4:00 PM MST$/); // 23:00 UTC = 16:00 MST
    expect(result.forecast_end).toMatch(/at 5:00 PM MST$/);
    expect(result.condition).toBe('Sunny');
    expect(result.daylight).toBe(true);
    expect(result.temperature).toBe('12.7 °C');
    expect(result.humidity).toBe('51%');
    expect(result.wind_speed).toBe('10.0 km/h');
    expect(result.wind_gust).toBe('19.0 km/h');
    expect(result.pressure).toBe('1019.1 mb');
    expect(result.thunderstorm_probability).toBe('5%');
    expect(result.precipitation_chance).toBe('0%');
    expect(result.precipitation_type).toBe('Rain');
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

  it('keeps nighttime hours of the same local day', () => {
    // Nighttime hours of the local "today" are retained — early-morning and
    // post-sunset training cares about overnight conditions.
    const dayHours: GoogleForecastHour[] = [
      { interval: { startTime: '2026-04-28T15:00:00Z' }, isDaytime: true },
      { interval: { startTime: '2026-04-28T23:00:00Z' }, isDaytime: true },
      { interval: { startTime: '2026-04-29T03:00:00Z' }, isDaytime: false }, // 21:00 local same day
      { interval: { startTime: '2026-04-29T05:00:00Z' }, isDaytime: false }, // 23:00 local same day
    ];
    const result = filterHourlyToRestOfDay(dayHours, tz, now);
    expect(result.map((h) => h.interval?.startTime)).toEqual([
      '2026-04-28T15:00:00Z',
      '2026-04-28T23:00:00Z',
      '2026-04-29T03:00:00Z',
      '2026-04-29T05:00:00Z',
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

    expect(result.current_conditions).toMatchObject({
      condition: 'Mostly clear',
      temperature: '4.1 °C',
      humidity: '58%',
      wind_direction: '226° SW',
      wind_speed: '12.1 km/h',
    });

    // Hourly entries — forecast_start is pre-formatted in the location's tz
    // (Boise = MDT, UTC-6 in DST). Verify the underlying mapping is right by
    // checking the local-clock hour, not the raw ISO.
    expect(result.hourly_forecast).toHaveLength(2);
    expect(result.hourly_forecast[0].forecast_start).toMatch(/at 8:00 AM MDT$/);  // 14:00 UTC = 08:00 MDT
    expect(result.hourly_forecast[1].forecast_start).toMatch(/at 2:00 PM MDT$/);  // 20:00 UTC = 14:00 MDT

    expect(result.alerts).toEqual([
      {
        title: 'Freeze Watch',
        description: 'Temperatures dropping below freezing tonight.',
        severity: 'MODERATE',
        start_time: 'Tuesday, April 28, 2026 at 6:00 PM MDT', // 2026-04-29T00:00 UTC = 18:00 MDT prior day
        expiration_time: 'Wednesday, April 29, 2026 at 6:00 AM MDT', // 12:00 UTC = 06:00 MDT
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
      elevation: undefined,
      forecast_date: '2026-04-28',
      sunrise: undefined,
      sunset: undefined,
      current_conditions: null,
      daily_summary: undefined,
      hourly_forecast: [],
      alerts: [],
      pollen: undefined,
    });
  });

  describe('air quality integration', () => {
    const currentAq: GoogleCurrentAirQualityResponse = {
      dateTime: '2026-04-28T14:49:34Z',
      regionCode: 'us',
      indexes: [
        {
          code: 'usa_epa',
          displayName: 'AQI (US)',
          aqi: 41,
          category: 'Good air quality',
          dominantPollutant: 'pm25',
        },
      ],
    };

    const hourlyAq: GoogleAirQualityHourlyResponse = {
      hourlyForecasts: [
        // Matches the in-progress weather hour
        {
          dateTime: '2026-04-28T14:00:00Z',
          indexes: [
            {
              code: 'usa_epa',
              displayName: 'AQI (US)',
              aqi: 38,
              category: 'Good air quality',
              dominantPollutant: 'pm25',
            },
          ],
        },
        // Matches the future weather hour
        {
          dateTime: '2026-04-28T20:00:00Z',
          indexes: [
            {
              code: 'usa_epa',
              displayName: 'AQI (US)',
              aqi: 55,
              category: 'Moderate air quality',
              dominantPollutant: 'o3',
            },
          ],
        },
        // Hour with no matching weather hour — should be silently dropped
        {
          dateTime: '2026-04-28T23:00:00Z',
          indexes: [{ code: 'usa_epa', aqi: 60 }],
        },
      ],
    };

    it('attaches AQI to current_conditions and to matching hourly entries', () => {
      const result = assembleLocationForecast(
        'Pocatello,Idaho,US',
        42.87,
        -112.58,
        current,
        hourly,
        alerts,
        tz,
        now,
        currentAq,
        hourlyAq
      );

      expect(result.current_conditions?.air_quality).toEqual({
        aqi: 41,
        category: 'Good air quality',
        dominant_pollutant: 'pm25',
        index_display_name: 'AQI (US)',
      });

      expect(result.hourly_forecast.map((h) => h.air_quality?.aqi)).toEqual([38, 55]);
      expect(result.hourly_forecast[1].air_quality?.dominant_pollutant).toBe('o3');
    });

    it('omits air_quality when no AQI data is provided', () => {
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
      expect(result.current_conditions?.air_quality).toBeUndefined();
      for (const h of result.hourly_forecast) {
        expect(h.air_quality).toBeUndefined();
      }
    });

    it("omits air_quality on hours without a matching AQI entry but keeps the rest", () => {
      // Only an entry for the in-progress hour; the future hour has no match.
      const partial: GoogleAirQualityHourlyResponse = {
        hourlyForecasts: [
          {
            dateTime: '2026-04-28T14:00:00Z',
            indexes: [{ code: 'usa_epa', aqi: 38 }],
          },
        ],
      };
      const result = assembleLocationForecast(
        'Pocatello,Idaho,US',
        42.87,
        -112.58,
        current,
        hourly,
        alerts,
        tz,
        now,
        currentAq,
        partial
      );
      expect(result.hourly_forecast[0].air_quality?.aqi).toBe(38);
      expect(result.hourly_forecast[1].air_quality).toBeUndefined();
    });

    it('prefers the EPA NowCast index when present (priority over default usa_epa and uaqi)', () => {
      // For US locations we explicitly request `customLocalAqis: usa_epa_nowcast`,
      // so the response should include nowcast — and it's the most responsive
      // scale, so we pick it first.
      const mixed: GoogleCurrentAirQualityResponse = {
        indexes: [
          { code: 'uaqi', aqi: 89 },
          { code: 'usa_epa', aqi: 41, displayName: 'AQI (US)' },
          { code: 'usa_epa_nowcast', aqi: 52, displayName: 'AQI (US NowCast)' },
        ],
      };
      const result = assembleLocationForecast(
        'Pocatello,Idaho,US', 42.87, -112.58,
        current, hourly, alerts, tz, now,
        mixed, undefined
      );
      expect(result.current_conditions?.air_quality?.aqi).toBe(52);
      expect(result.current_conditions?.air_quality?.index_display_name).toBe('AQI (US NowCast)');
    });

    it('falls back to a non-uaqi local index when nowcast is absent', () => {
      // Non-US location: response carries the regional default (e.g. DEFRA in
      // the UK) plus uaqi. Pick the local index.
      const mixed: GoogleCurrentAirQualityResponse = {
        indexes: [
          { code: 'uaqi', aqi: 89 },
          { code: 'gbr_defra', aqi: 3, displayName: 'AQI (UK)' },
        ],
      };
      const result = assembleLocationForecast(
        'London,UK', 51.5, -0.13,
        current, hourly, alerts, tz, now,
        mixed, undefined
      );
      expect(result.current_conditions?.air_quality?.aqi).toBe(3);
      expect(result.current_conditions?.air_quality?.index_display_name).toBe('AQI (UK)');
    });

    it('falls back to UAQI as a last resort when no local index is available', () => {
      // Some regions Google has no local AQI scale for. UAQI is on a different
      // scale (0–100, inverted) but we surface it (with its display name) so
      // the consumer has *something* rather than nothing — better than
      // silently omitting air quality data.
      const onlyUaqi: GoogleCurrentAirQualityResponse = {
        indexes: [{ code: 'uaqi', aqi: 89, displayName: 'Universal AQI' }],
      };
      const result = assembleLocationForecast(
        'Somewhere,Unsupported', 0, 0,
        current, hourly, alerts, tz, now,
        onlyUaqi, undefined
      );
      expect(result.current_conditions?.air_quality?.aqi).toBe(89);
      expect(result.current_conditions?.air_quality?.index_display_name).toBe('Universal AQI');
    });
  });

  describe('sun events integration', () => {
    it("attaches today's sunrise/sunset from the daily forecast", () => {
      const daily: GoogleDailyForecastResponse = {
        forecastDays: [
          // Yesterday — should be ignored
          {
            displayDate: { year: 2026, month: 4, day: 27 },
            sunEvents: {
              sunriseTime: '2026-04-27T12:31:00Z',
              sunsetTime: '2026-04-28T02:14:00Z',
            },
          },
          // Today in America/Boise (matches the test's `now`)
          {
            displayDate: { year: 2026, month: 4, day: 28 },
            sunEvents: {
              sunriseTime: '2026-04-28T12:30:00.123Z',
              sunsetTime: '2026-04-29T02:15:00.456Z',
            },
          },
          // Tomorrow — should be ignored
          {
            displayDate: { year: 2026, month: 4, day: 29 },
            sunEvents: {
              sunriseTime: '2026-04-29T12:29:00Z',
              sunsetTime: '2026-04-30T02:16:00Z',
            },
          },
        ],
      };

      const result = assembleLocationForecast(
        'Pocatello,Idaho,US',
        42.87,
        -112.58,
        current,
        hourly,
        alerts,
        tz,
        now,
        undefined,
        undefined,
        undefined,
        daily
      );

      // Pre-formatted in the location's tz (Boise = MDT, UTC-6 in DST).
      // 12:30 UTC = 06:30 MDT; 02:15 UTC next day = 20:15 MDT today.
      expect(result.sunrise).toMatch(/at 6:30 AM MDT$/);
      expect(result.sunset).toMatch(/at 8:15 PM MDT$/);
    });

    it("omits sunrise/sunset when no daily entry matches today in the athlete's timezone", () => {
      const tomorrowOnly: GoogleDailyForecastResponse = {
        forecastDays: [
          {
            displayDate: { year: 2026, month: 4, day: 29 },
            sunEvents: {
              sunriseTime: '2026-04-29T12:29:00Z',
              sunsetTime: '2026-04-30T02:16:00Z',
            },
          },
        ],
      };
      const result = assembleLocationForecast(
        'Pocatello,Idaho,US',
        42.87,
        -112.58,
        current,
        hourly,
        alerts,
        tz,
        now,
        undefined,
        undefined,
        undefined,
        tomorrowOnly
      );
      expect(result.sunrise).toBeUndefined();
      expect(result.sunset).toBeUndefined();
    });

    it('omits sunrise/sunset when no daily forecast is provided', () => {
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
      expect(result.sunrise).toBeUndefined();
      expect(result.sunset).toBeUndefined();
    });

    it('handles a matching day with no sunEvents block', () => {
      const noSunEvents: GoogleDailyForecastResponse = {
        forecastDays: [
          {
            displayDate: { year: 2026, month: 4, day: 28 },
          },
        ],
      };
      const result = assembleLocationForecast(
        'Pocatello,Idaho,US',
        42.87,
        -112.58,
        current,
        hourly,
        alerts,
        tz,
        now,
        undefined,
        undefined,
        undefined,
        noSunEvents
      );
      expect(result.sunrise).toBeUndefined();
      expect(result.sunset).toBeUndefined();
    });
  });

  describe('pollen integration', () => {
    // 2026-04-28T14:49:34Z → 08:49 local on 2026-04-28 in America/Boise
    const todayPollen: GooglePollenForecastResponse = {
      regionCode: 'us',
      dailyInfo: [
        {
          date: { year: 2026, month: 4, day: 28 },
          pollenTypeInfo: [
            {
              code: 'GRASS',
              displayName: 'Grass',
              inSeason: false,
              indexInfo: {
                code: 'UPI',
                displayName: 'Universal Pollen Index',
                value: 1,
                category: 'Very Low',
                indexDescription: 'Sensitive people may have symptoms.',
                color: { green: 0.62, blue: 0.23 },
              },
              healthRecommendations: ["Pollen levels are very low. It's a great day to be outside!"],
            },
            {
              code: 'TREE',
              displayName: 'Tree',
              inSeason: true,
              indexInfo: {
                code: 'UPI',
                displayName: 'Universal Pollen Index',
                value: 3,
                category: 'Moderate',
                indexDescription: 'Moderately allergic people may experience symptoms.',
              },
              healthRecommendations: [
                'Keep windows closed and use AC if possible.',
                'Consider wearing sunglasses to keep pollen out of your eyes.',
              ],
            },
            {
              // value=0 → dropped entirely
              code: 'WEED',
              displayName: 'Weed',
              indexInfo: { code: 'UPI', value: 0, category: 'None' },
              healthRecommendations: ['Should not appear anywhere in the output.'],
            },
          ],
          plantInfo: [
            {
              code: 'BIRCH',
              displayName: 'Birch',
              inSeason: true,
              indexInfo: { code: 'UPI', value: 3, category: 'Moderate' },
            },
            {
              code: 'OAK',
              displayName: 'Oak',
              inSeason: true,
              indexInfo: { code: 'UPI', value: 1, category: 'Very Low' },
            },
            // Out-of-season plant with no indexInfo — dropped
            { code: 'OLIVE', displayName: 'Olive' },
          ],
        },
      ],
    };

    it("groups pollen by UPI level, sorted descending (worst first)", () => {
      const result = assembleLocationForecast(
        'Pocatello,Idaho,US',
        42.87,
        -112.58,
        current,
        hourly,
        alerts,
        tz,
        now,
        undefined,
        undefined,
        todayPollen
      );

      // Pollen lives at the top level of LocationForecast, not under current_conditions.
      expect((result.current_conditions as unknown as { pollen?: unknown })?.pollen).toBeUndefined();
      expect(result.pollen).toEqual({
        date: '2026-04-28',
        universal_pollen_index: [
          {
            value: 3,
            category: 'Moderate',
            description: 'Moderately allergic people may experience symptoms.',
            pollen_types: ['Tree'],
            plants: ['Birch'],
          },
          {
            value: 1,
            category: 'Very Low',
            description: 'Sensitive people may have symptoms.',
            pollen_types: ['Grass'],
            plants: ['Oak'],
          },
        ],
      });
    });

    it('emits a level with only `pollen_types` when no plants land in that bucket (and vice versa)', () => {
      const lopsided: GooglePollenForecastResponse = {
        dailyInfo: [
          {
            date: { year: 2026, month: 4, day: 28 },
            pollenTypeInfo: [
              { code: 'GRASS', displayName: 'Grass', indexInfo: { value: 2, category: 'Low' } },
            ],
            plantInfo: [
              { code: 'BIRCH', displayName: 'Birch', indexInfo: { value: 4, category: 'High' } },
            ],
          },
        ],
      };
      const result = assembleLocationForecast(
        'Pocatello,Idaho,US',
        42.87,
        -112.58,
        current,
        hourly,
        alerts,
        tz,
        now,
        undefined,
        undefined,
        lopsided
      );
      expect(result.pollen?.universal_pollen_index).toEqual([
        { value: 4, category: 'High', description: undefined, pollen_types: undefined, plants: ['Birch'] },
        { value: 2, category: 'Low', description: undefined, pollen_types: ['Grass'], plants: undefined },
      ]);
      expect((result.pollen as unknown as { health_recommendations?: unknown })?.health_recommendations).toBeUndefined();
    });

    it("omits pollen when no dailyInfo entry matches today in the athlete's timezone", () => {
      const tomorrowOnly: GooglePollenForecastResponse = {
        dailyInfo: [
          {
            date: { year: 2026, month: 4, day: 29 },
            pollenTypeInfo: [
              { code: 'GRASS', displayName: 'Grass', indexInfo: { value: 2, category: 'Low' } },
            ],
          },
        ],
      };
      const result = assembleLocationForecast(
        'Pocatello,Idaho,US',
        42.87,
        -112.58,
        current,
        hourly,
        alerts,
        tz,
        now,
        undefined,
        undefined,
        tomorrowOnly
      );
      expect(result.pollen).toBeUndefined();
    });

    it('omits pollen when no pollen response is provided', () => {
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
      expect(result.pollen).toBeUndefined();
    });

    it('omits pollen entirely when every type and plant has value=0 or no value', () => {
      const allZeros: GooglePollenForecastResponse = {
        dailyInfo: [
          {
            date: { year: 2026, month: 4, day: 28 },
            pollenTypeInfo: [
              { code: 'GRASS', displayName: 'Grass', indexInfo: { value: 0 } },
              { code: 'TREE', displayName: 'Tree', indexInfo: { value: 0 } },
            ],
            plantInfo: [{ code: 'OLIVE', displayName: 'Olive' }],
          },
        ],
      };
      const result = assembleLocationForecast(
        'Pocatello,Idaho,US',
        42.87,
        -112.58,
        current,
        hourly,
        alerts,
        tz,
        now,
        undefined,
        undefined,
        allZeros
      );
      expect(result.pollen).toBeUndefined();
    });

    it('picks the matching day when multiple are returned', () => {
      const multi: GooglePollenForecastResponse = {
        dailyInfo: [
          {
            date: { year: 2026, month: 4, day: 27 },
            pollenTypeInfo: [
              { code: 'GRASS', displayName: 'Grass (yesterday)', indexInfo: { value: 1 } },
            ],
          },
          {
            date: { year: 2026, month: 4, day: 28 },
            pollenTypeInfo: [
              { code: 'GRASS', displayName: 'Grass (today)', indexInfo: { value: 1 } },
            ],
          },
          {
            date: { year: 2026, month: 4, day: 29 },
            pollenTypeInfo: [
              { code: 'GRASS', displayName: 'Grass (tomorrow)', indexInfo: { value: 2 } },
            ],
          },
        ],
      };
      const result = assembleLocationForecast(
        'Pocatello,Idaho,US',
        42.87,
        -112.58,
        current,
        hourly,
        alerts,
        tz,
        now,
        undefined,
        undefined,
        multi
      );
      expect(result.pollen?.date).toBe('2026-04-28');
      expect(result.pollen?.universal_pollen_index?.[0].pollen_types).toEqual(['Grass (today)']);
    });
  });

  describe('elevation integration', () => {
    it('formats elevation via formatLength when status is OK', () => {
      const elevation: GoogleElevationResponse = {
        status: 'OK',
        results: [{ elevation: 1608.6, location: { lat: 42.87, lng: -112.58 }, resolution: 4.7 }],
      };
      const result = assembleLocationForecast(
        'Pocatello,Idaho,US',
        42.87,
        -112.58,
        current,
        hourly,
        alerts,
        tz,
        now,
        undefined,
        undefined,
        undefined,
        undefined,
        elevation
      );
      expect(result.elevation).toBe('1609 m');
    });

    it('omits elevation when status is non-OK (e.g., REQUEST_DENIED)', () => {
      const elevation: GoogleElevationResponse = {
        status: 'REQUEST_DENIED',
        error_message: 'API key invalid',
        results: [],
      };
      const result = assembleLocationForecast(
        'Pocatello,Idaho,US',
        42.87,
        -112.58,
        current,
        hourly,
        alerts,
        tz,
        now,
        undefined,
        undefined,
        undefined,
        undefined,
        elevation
      );
      expect(result.elevation).toBeUndefined();
    });

    it('omits elevation when no response is provided', () => {
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
      expect(result.elevation).toBeUndefined();
    });

    it('omits elevation when status is OK but results array is empty', () => {
      const elevation: GoogleElevationResponse = { status: 'OK', results: [] };
      const result = assembleLocationForecast(
        'Pocatello,Idaho,US',
        42.87,
        -112.58,
        current,
        hourly,
        alerts,
        tz,
        now,
        undefined,
        undefined,
        undefined,
        undefined,
        elevation
      );
      expect(result.elevation).toBeUndefined();
    });
  });
});
