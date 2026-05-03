import { ApiError, type ErrorCategory, type ErrorContext } from '../errors/index.js';
import {
  buildGoogleErrorFromHttpStatus,
  buildGoogleNetworkError,
  googleErrorBuilders,
} from './google-api-error-helpers.js';
import { httpRequestJson } from './http.js';

const GOOGLE_WEATHER_API_BASE = 'https://weather.googleapis.com/v1';

export interface GoogleWeatherConfig {
  /** Google Weather API key (a generic Google Cloud API key with the Weather API enabled) */
  apiKey: string;
}

/**
 * Google Weather API value-with-unit blocks. Most numeric measurements come back
 * as `{ degrees, unit }` (temperatures), `{ value, unit }` (wind/speed), or
 * `{ distance, unit }` (visibility). The unit fields are kept loose because
 * Google may evolve them; we always request METRIC at the URL level.
 */
export interface GoogleTemperature {
  degrees?: number;
  unit?: string;
}

export interface GoogleSpeed {
  value?: number;
  unit?: string;
}

export interface GoogleVisibility {
  distance?: number;
  unit?: string;
}

export interface GoogleQpf {
  quantity?: number;
  unit?: string;
}

export interface GoogleProbability {
  percent?: number;
  type?: string;
}

export interface GooglePrecipitation {
  probability?: GoogleProbability;
  qpf?: GoogleQpf;
  snowQpf?: GoogleQpf;
}

export interface GoogleAirPressure {
  meanSeaLevelMillibars?: number;
}

export interface GoogleWindDirection {
  degrees?: number;
  /** Full enum-style cardinal name (e.g., "NORTH_NORTHWEST", "EAST"). */
  cardinal?: string;
}

export interface GoogleWind {
  direction?: GoogleWindDirection;
  speed?: GoogleSpeed;
  gust?: GoogleSpeed;
}

export interface GoogleWeatherCondition {
  iconBaseUri?: string;
  description?: {
    text?: string;
    languageCode?: string;
  };
  type?: string;
}

/**
 * Slimmed shape of `currentConditions:lookup`. The full response includes more
 * fields than we currently consume (history, etc.); the index signature lets
 * future fields pass through without a type change.
 */
export interface GoogleCurrentConditionsResponse {
  currentTime?: string;
  timeZone?: { id?: string };
  isDaytime?: boolean;
  weatherCondition?: GoogleWeatherCondition;
  temperature?: GoogleTemperature;
  feelsLikeTemperature?: GoogleTemperature;
  dewPoint?: GoogleTemperature;
  heatIndex?: GoogleTemperature;
  windChill?: GoogleTemperature;
  relativeHumidity?: number;
  uvIndex?: number;
  precipitation?: GooglePrecipitation;
  thunderstormProbability?: number;
  airPressure?: GoogleAirPressure;
  wind?: GoogleWind;
  visibility?: GoogleVisibility;
  cloudCover?: number;
  [key: string]: unknown;
}

export interface GoogleForecastHour {
  interval?: {
    startTime?: string;
    endTime?: string;
  };
  isDaytime?: boolean;
  weatherCondition?: GoogleWeatherCondition;
  temperature?: GoogleTemperature;
  feelsLikeTemperature?: GoogleTemperature;
  dewPoint?: GoogleTemperature;
  heatIndex?: GoogleTemperature;
  windChill?: GoogleTemperature;
  wetBulbTemperature?: GoogleTemperature;
  relativeHumidity?: number;
  uvIndex?: number;
  precipitation?: GooglePrecipitation;
  thunderstormProbability?: number;
  airPressure?: GoogleAirPressure;
  wind?: GoogleWind;
  visibility?: GoogleVisibility;
  cloudCover?: number;
  [key: string]: unknown;
}

export interface GoogleHourlyForecastResponse {
  forecastHours?: GoogleForecastHour[];
  timeZone?: { id?: string };
  nextPageToken?: string;
}

export interface GoogleAlertSource {
  publisher?: string;
  name?: string;
  authorityUri?: string;
}

export interface GoogleWeatherAlert {
  alertId?: string;
  alertTitle?: { text?: string; languageCode?: string };
  eventType?: string;
  areaName?: string;
  description?: string;
  severity?: string;
  certainty?: string;
  urgency?: string;
  startTime?: string;
  expirationTime?: string;
  dataSource?: GoogleAlertSource;
  [key: string]: unknown;
}

export interface GoogleWeatherAlertsResponse {
  weatherAlerts?: GoogleWeatherAlert[];
  regionCode?: string;
}

export interface GoogleSunEvents {
  sunriseTime?: string;
  sunsetTime?: string;
}

/**
 * Lunar events for a daily forecast entry. `moonriseTimes` and `moonsetTimes`
 * are arrays — usually one entry, but may be empty (the moon doesn't rise/set
 * during the local day) or contain multiples in polar regions.
 */
export interface GoogleMoonEvents {
  moonPhase?: string;
  moonriseTimes?: string[];
  moonsetTimes?: string[];
}

/**
 * Sub-period of a daily forecast (`daytimeForecast` or `nighttimeForecast`).
 * Shape mirrors {@link GoogleForecastHour} minus per-hour fields the daily
 * endpoint doesn't compute (visibility, temperature, dew point, etc.).
 */
export interface GoogleForecastDayPeriod {
  interval?: {
    startTime?: string;
    endTime?: string;
  };
  weatherCondition?: GoogleWeatherCondition;
  relativeHumidity?: number;
  uvIndex?: number;
  precipitation?: GooglePrecipitation;
  thunderstormProbability?: number;
  wind?: GoogleWind;
  cloudCover?: number;
  [key: string]: unknown;
}

export interface GoogleForecastDay {
  interval?: {
    startTime?: string;
    endTime?: string;
  };
  displayDate?: {
    year?: number;
    month?: number;
    day?: number;
  };
  sunEvents?: GoogleSunEvents;
  moonEvents?: GoogleMoonEvents;
  daytimeForecast?: GoogleForecastDayPeriod;
  nighttimeForecast?: GoogleForecastDayPeriod;
  maxTemperature?: GoogleTemperature;
  minTemperature?: GoogleTemperature;
  feelsLikeMaxTemperature?: GoogleTemperature;
  feelsLikeMinTemperature?: GoogleTemperature;
  maxHeatIndex?: GoogleTemperature;
  [key: string]: unknown;
}

export interface GoogleDailyForecastResponse {
  forecastDays?: GoogleForecastDay[];
  timeZone?: { id?: string };
  nextPageToken?: string;
}

/**
 * Error thrown when Google Weather API calls fail.
 */
export class GoogleWeatherApiError extends ApiError {
  public override readonly name = 'GoogleWeatherApiError';

  constructor(
    message: string,
    category: ErrorCategory,
    isRetryable: boolean,
    context: ErrorContext,
    statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message, category, isRetryable, context, 'google-weather', statusCode);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GoogleWeatherApiError);
    }
  }

  static fromHttpStatus(
    statusCode: number,
    context: ErrorContext,
    responseBody?: string
  ): GoogleWeatherApiError {
    return buildGoogleErrorFromHttpStatus(GoogleWeatherApiError, 'Weather', statusCode, context, responseBody);
  }

  static networkError(context: ErrorContext, originalError?: Error): GoogleWeatherApiError {
    return buildGoogleNetworkError(GoogleWeatherApiError, 'Weather', context, originalError);
  }
}

const googleWeatherHttpErrorBuilders = googleErrorBuilders(GoogleWeatherApiError);

/**
 * Client for Google's Weather API.
 *
 * Auth is a single API key passed as the `key` query parameter. We always
 * request `unitsSystem=METRIC` so the response shape is predictable
 * (temperatures in Celsius, distances in km, precipitation in mm, etc.) and
 * the formatting helpers in src/utils/format-units.ts can apply uniformly.
 *
 * @see https://developers.google.com/maps/documentation/weather
 */
export class GoogleWeatherClient {
  constructor(private config: GoogleWeatherConfig) {}

  /**
   * Build a Google Weather API URL with the common query params (api key,
   * location). The numeric endpoints (current conditions, hourly forecast)
   * accept `unitsSystem=METRIC`; the alerts endpoint rejects it as an unknown
   * field, so opt in per call.
   */
  private buildUrl(
    path: string,
    latitude: number,
    longitude: number,
    options: { units?: boolean } = {}
  ): URL {
    const url = new URL(`${GOOGLE_WEATHER_API_BASE}${path}`);
    url.searchParams.set('key', this.config.apiKey);
    url.searchParams.set('location.latitude', String(latitude));
    url.searchParams.set('location.longitude', String(longitude));
    if (options.units) {
      url.searchParams.set('unitsSystem', 'METRIC');
    }
    return url;
  }

  /**
   * GET /v1/currentConditions:lookup
   * @see https://developers.google.com/maps/documentation/weather/current-conditions
   */
  async getCurrentConditions(
    latitude: number,
    longitude: number
  ): Promise<GoogleCurrentConditionsResponse> {
    const url = this.buildUrl('/currentConditions:lookup', latitude, longitude, { units: true });
    console.log(`[GoogleWeather] Making API call to /currentConditions:lookup for ${latitude},${longitude}`);

    return httpRequestJson<GoogleCurrentConditionsResponse>({
      url: url.toString(),
      headers: { Accept: 'application/json' },
      context: {
        operation: 'fetch current conditions',
        resource: `${latitude},${longitude}`,
      },
      ...googleWeatherHttpErrorBuilders,
    });
  }

  /**
   * GET /v1/forecast/hours:lookup
   *
   * Returns hourly forecast entries starting from "now" forward. The API:
   * - `hours` = the total window to return (1–240, also the API's max
   *   forecast horizon).
   * - `pageSize` = max records per page (max 24, default 24).
   * - `pageToken` = follow-up cursor.
   *
   * For windows above 24 hours we walk `pageToken` until we've collected the
   * requested `hours` worth of entries (or the API runs out). Returns a
   * single concatenated response so callers can ignore pagination.
   *
   * Defaults to 24 hours — one page, enough for the "rest of today" window
   * the today's-forecast path consumes. The future-date path passes a larger
   * value to cover the whole target local day.
   *
   * @see https://developers.google.com/maps/documentation/weather/reference/rest/v1/forecast.hours/lookup
   */
  async getHourlyForecast(
    latitude: number,
    longitude: number,
    hours: number = 24
  ): Promise<GoogleHourlyForecastResponse> {
    const totalHours = Math.min(Math.max(hours, 1), 240);
    const pageSize = Math.min(totalHours, 24);

    const all: GoogleForecastHour[] = [];
    let timeZone: { id?: string } | undefined;
    let pageToken: string | undefined;
    let pageNumber = 0;

    do {
      const url = this.buildUrl('/forecast/hours:lookup', latitude, longitude, { units: true });
      url.searchParams.set('hours', String(totalHours));
      url.searchParams.set('pageSize', String(pageSize));
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      pageNumber += 1;
      console.log(
        `[GoogleWeather] Making API call to /forecast/hours:lookup for ${latitude},${longitude} (hours=${totalHours}, pageSize=${pageSize}, page=${pageNumber})`
      );

      const page = await httpRequestJson<GoogleHourlyForecastResponse>({
        url: url.toString(),
        headers: { Accept: 'application/json' },
        context: {
          operation: 'fetch hourly forecast',
          resource: `${latitude},${longitude}`,
          parameters: { hours: totalHours, pageSize, page: pageNumber },
        },
        ...googleWeatherHttpErrorBuilders,
      });

      if (page.forecastHours?.length) all.push(...page.forecastHours);
      if (page.timeZone) timeZone = page.timeZone;
      pageToken = page.nextPageToken;
    } while (pageToken && all.length < totalHours);

    return { forecastHours: all, timeZone };
  }

  /**
   * GET /v1/forecast/days:lookup — daily forecast. We only consume sun-event
   * times today, so the default page size (which covers ≥10 days) is more
   * than enough.
   * @see https://developers.google.com/maps/documentation/weather/daily-forecast
   */
  async getDailyForecast(
    latitude: number,
    longitude: number
  ): Promise<GoogleDailyForecastResponse> {
    const url = this.buildUrl('/forecast/days:lookup', latitude, longitude, { units: true });
    console.log(`[GoogleWeather] Making API call to /forecast/days:lookup for ${latitude},${longitude}`);

    return httpRequestJson<GoogleDailyForecastResponse>({
      url: url.toString(),
      headers: { Accept: 'application/json' },
      context: {
        operation: 'fetch daily forecast',
        resource: `${latitude},${longitude}`,
      },
      ...googleWeatherHttpErrorBuilders,
    });
  }

  /**
   * GET /v1/publicAlerts:lookup
   * @see https://developers.google.com/maps/documentation/weather/public-alerts
   */
  async getWeatherAlerts(
    latitude: number,
    longitude: number
  ): Promise<GoogleWeatherAlertsResponse> {
    const url = this.buildUrl('/publicAlerts:lookup', latitude, longitude);
    console.log(`[GoogleWeather] Making API call to /publicAlerts:lookup for ${latitude},${longitude}`);

    return httpRequestJson<GoogleWeatherAlertsResponse>({
      url: url.toString(),
      headers: { Accept: 'application/json' },
      context: {
        operation: 'fetch weather alerts',
        resource: `${latitude},${longitude}`,
      },
      ...googleWeatherHttpErrorBuilders,
    });
  }
}
