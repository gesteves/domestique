import { IntervalsClient } from '../clients/intervals.js';
import { WhoopClient } from '../clients/whoop.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { GoogleWeatherClient } from '../clients/google-weather.js';
import { GoogleAirQualityClient } from '../clients/google-air-quality.js';
import { GooglePollenClient } from '../clients/google-pollen.js';
import { GoogleElevationClient } from '../clients/google-elevation.js';
import { GoogleGeocodingClient } from '../clients/google-geocoding.js';
import { GoogleTimezoneClient } from '../clients/google-timezone.js';
import { fromZonedTime } from 'date-fns-tz';
import { parseDateRangeInTimezone, getTodayInTimezone, parseDateStringInTimezone, addDaysToYMD } from '../utils/tz.js';
import { getCurrentTimeInTimezone } from '../utils/date-formatting.js';
import { DOMESTIQUE_TAG, enrichWorkoutsWithWhoop, fetchAndMergePlannedWorkouts } from '../utils/workout-utils.js';
import { mergeAnnotations } from '../utils/annotation-utils.js';
import { assembleLocationForecast, assembleFutureLocationForecast } from '../utils/weather.js';
import type {
  StrainData,
  AthleteProfile,
  DailySummary,
  SportSettingsResponse,
  TodaysRecoveryResponse,
  TodaysStrainResponse,
  TodaysCompletedWorkoutsResponse,
  TodaysPlannedWorkoutsResponse,
  TodaysWorkoutsResponse,
  ForecastResponse,
  LocationForecast,
  Race,
  Annotation,
  TrainingPhase,
} from '../types/index.js';
import type { GetStrainHistoryInput } from './types.js';

/** Maximum forecast horizon supported by Google Weather (days). */
const MAX_FORECAST_DAYS = 10;
/** Maximum days the Pollen API forecast covers. */
const MAX_POLLEN_FORECAST_DAYS = 5;
/** Maximum hours the Air Quality hourly forecast covers. */
const MAX_AIR_QUALITY_FORECAST_HOURS = 96;
/** Maximum hours the Weather hourly forecast covers (also the API's pageSize cap). */
const MAX_WEATHER_HOURLY_FORECAST_HOURS = 240;

/** Days between two YYYY-MM-DD strings (UTC arithmetic; result independent of runtime tz). */
function daysBetweenYMD(start: string, end: string): number {
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  return Math.round((Date.UTC(ye, me - 1, de) - Date.UTC(ys, ms - 1, ds)) / 86400000);
}

/**
 * Number of hourly forecast entries to request from "now" so that the response
 * covers the entire target local date in the given timezone. `targetDate` is
 * YYYY-MM-DD interpreted in `timezone`; we need hours from `now` up to (but
 * not including) the start of the next local day in `timezone`. Capped at the
 * Weather API's 240-hour limit.
 */
function hoursNeededToCoverDate(now: Date, targetDate: string, timezone: string): number {
  const endOfDayUtc = fromZonedTime(`${addDaysToYMD(targetDate, 1)}T00:00:00`, timezone);
  const ms = endOfDayUtc.getTime() - now.getTime();
  if (ms <= 0) return 1;
  const hours = Math.ceil(ms / 3_600_000);
  return Math.min(hours, MAX_WEATHER_HOURLY_FORECAST_HOURS);
}

export class CurrentTools {
  constructor(
    private intervals: IntervalsClient,
    private whoop: WhoopClient | null,
    private trainerroad: TrainerRoadClient | null,
    private googleWeather: GoogleWeatherClient | null = null,
    private googleAirQuality: GoogleAirQualityClient | null = null,
    private googlePollen: GooglePollenClient | null = null,
    private googleElevation: GoogleElevationClient | null = null,
    private googleGeocoding: GoogleGeocodingClient | null = null,
    private googleTimezone: GoogleTimezoneClient | null = null
  ) {}

  /**
   * Resolve a base location list (label/lat/lng) into a list with each
   * location's IANA timezone attached. Falls back to `fallbackTimezone` when
   * the Time Zone client is missing or a per-location lookup fails — better
   * to surface a forecast in the wrong tz than to fail the whole request.
   */
  private async resolveLocationTimezones(
    locations: { label: string; latitude: number; longitude: number }[],
    fallbackTimezone: string
  ): Promise<{ label: string; latitude: number; longitude: number; timezone: string }[]> {
    const tzClient = this.googleTimezone;
    if (!tzClient) {
      return locations.map((loc) => ({ ...loc, timezone: fallbackTimezone }));
    }
    return Promise.all(
      locations.map(async (loc) => {
        try {
          const timezone = await tzClient.getTimezone(loc.latitude, loc.longitude);
          return { ...loc, timezone };
        } catch (e) {
          console.error(`Error resolving timezone for "${loc.label}":`, e);
          return { ...loc, timezone: fallbackTimezone };
        }
      })
    );
  }

  /**
   * Run an async fetch and swallow any error, returning `undefined` and logging.
   * Used to fan out the per-API forecast fetches so a single API failure (AQ
   * 4xx, weather alert outage, etc.) doesn't take down the whole forecast.
   */
  private async safeFetch<T>(
    label: string,
    what: string,
    fn: () => Promise<T>
  ): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      console.error(`Error fetching ${what} for "${label}":`, e);
      return undefined;
    }
  }

  /**
   * Build today's per-location weather forecast for every enabled Intervals.icu
   * weather location. Returns [] when Google Weather is not configured or there
   * are no enabled locations. Used by `getTodaysSummary`'s embedded forecast.
   */
  private async buildForecasts(
    fallbackTimezone: string,
    now: Date
  ): Promise<LocationForecast[]> {
    if (!this.googleWeather) return [];

    let enabled: Awaited<ReturnType<IntervalsClient['getEnabledWeatherLocations']>>;
    try {
      enabled = await this.intervals.getEnabledWeatherLocations();
    } catch (e) {
      console.error('Error fetching weather config from Intervals.icu:', e);
      return [];
    }

    const withTz = await this.resolveLocationTimezones(
      enabled.map((loc) => ({
        label: loc.label,
        latitude: loc.latitude,
        longitude: loc.longitude,
      })),
      fallbackTimezone
    );

    const results = await Promise.all(
      withTz.map((loc) => this.buildOneTodayForecast(loc, now))
    );
    return results.filter((r): r is LocationForecast => r !== null);
  }

  /**
   * Fetch all data for a single location and assemble today's forecast for it,
   * using the location's local timezone for date filtering and per-location
   * datetime formatting. Per-API failures are isolated and logged.
   */
  private async buildOneTodayForecast(
    loc: { label: string; latitude: number; longitude: number; timezone: string },
    now: Date
  ): Promise<LocationForecast | null> {
    if (!this.googleWeather) return null;
    const gw = this.googleWeather;
    const aq = this.googleAirQuality;
    const pollen = this.googlePollen;
    const elev = this.googleElevation;
    // 24h covers the "rest of today" hourly window the weather forecast
    // surfaces; the AQ API computes the window from its own "now."
    const aqHours = 24;

    try {
      const [current, hourly, alerts, daily, currentAq, hourlyAq, pollenForecast, elevation] = await Promise.all([
        this.safeFetch(loc.label, 'current conditions', () => gw.getCurrentConditions(loc.latitude, loc.longitude)),
        this.safeFetch(loc.label, 'hourly forecast', () => gw.getHourlyForecast(loc.latitude, loc.longitude)),
        this.safeFetch(loc.label, 'weather alerts', () => gw.getWeatherAlerts(loc.latitude, loc.longitude)),
        this.safeFetch(loc.label, 'daily forecast', () => gw.getDailyForecast(loc.latitude, loc.longitude)),
        aq
          ? this.safeFetch(loc.label, 'current air quality', () => aq.getCurrentAirQuality(loc.latitude, loc.longitude))
          : Promise.resolve(undefined),
        aq
          ? this.safeFetch(loc.label, 'hourly air quality', () =>
              aq.getHourlyAirQualityForecast(loc.latitude, loc.longitude, aqHours)
            )
          : Promise.resolve(undefined),
        pollen
          ? this.safeFetch(loc.label, 'pollen forecast', () => pollen.getPollenForecast(loc.latitude, loc.longitude, 1))
          : Promise.resolve(undefined),
        elev
          ? this.safeFetch(loc.label, 'elevation', () => elev.getElevation(loc.latitude, loc.longitude))
          : Promise.resolve(undefined),
      ]);
      return assembleLocationForecast(
        loc.label,
        loc.latitude,
        loc.longitude,
        current,
        hourly,
        alerts,
        loc.timezone,
        now,
        currentAq,
        hourlyAq,
        pollenForecast,
        daily,
        elevation
      );
    } catch (e) {
      console.error(`Error fetching forecast for "${loc.label}":`, e);
      return null;
    }
  }

  /**
   * Fetch all data for a single location and assemble a future-date forecast
   * for it. The Pollen and Air Quality calls are gated on their respective
   * forecast windows. Per-API failures are isolated and logged.
   */
  private async buildOneFutureForecast(
    loc: { label: string; latitude: number; longitude: number; timezone: string },
    today: string,
    targetDate: string
  ): Promise<LocationForecast | null> {
    if (!this.googleWeather) return null;
    const dayOffset = daysBetweenYMD(today, targetDate);
    const fetchPollen = this.googlePollen && dayOffset >= 0 && dayOffset < MAX_POLLEN_FORECAST_DAYS;
    // The AQ hourly endpoint returns the next N hours from "now" (max 96).
    // To cover all hours of the target date, the date must be no further than
    // (96h / 24h) - 1 = 3 days out: at the latest "now" the 96h window still
    // reaches the end of today+3.
    const fetchAirQuality = this.googleAirQuality && dayOffset >= 0 && dayOffset <= 3;

    const gw = this.googleWeather;
    const aq = this.googleAirQuality;
    const pollen = this.googlePollen;
    const elev = this.googleElevation;

    // The Weather and Air Quality hourly endpoints both return entries from
    // "now" forward. Default Weather pageSize is 24 and AQ caps at 96h — both
    // would truncate or reject when the target date is well in the future.
    // Compute the smallest window that covers the target local day for each.
    const now = new Date();
    const hoursToCoverDate = hoursNeededToCoverDate(now, targetDate, loc.timezone);
    const aqHoursNeeded = Math.min(hoursToCoverDate, MAX_AIR_QUALITY_FORECAST_HOURS);

    try {
      const [hourly, daily, alerts, hourlyAq, pollenForecast, elevation] = await Promise.all([
        this.safeFetch(loc.label, 'hourly forecast', () =>
          gw.getHourlyForecast(loc.latitude, loc.longitude, hoursToCoverDate)
        ),
        this.safeFetch(loc.label, 'daily forecast', () => gw.getDailyForecast(loc.latitude, loc.longitude)),
        this.safeFetch(loc.label, 'weather alerts', () => gw.getWeatherAlerts(loc.latitude, loc.longitude)),
        fetchAirQuality && aq
          ? this.safeFetch(loc.label, 'hourly air quality', () =>
              aq.getHourlyAirQualityForecast(loc.latitude, loc.longitude, aqHoursNeeded)
            )
          : Promise.resolve(undefined),
        fetchPollen && pollen
          ? this.safeFetch(loc.label, 'pollen forecast', () =>
              pollen.getPollenForecast(loc.latitude, loc.longitude, dayOffset + 1)
            )
          : Promise.resolve(undefined),
        elev
          ? this.safeFetch(loc.label, 'elevation', () => elev.getElevation(loc.latitude, loc.longitude))
          : Promise.resolve(undefined),
      ]);
      return assembleFutureLocationForecast(
        loc.label,
        loc.latitude,
        loc.longitude,
        targetDate,
        hourly,
        daily,
        loc.timezone,
        hourlyAq,
        pollenForecast,
        elevation,
        alerts
      );
    } catch (e) {
      console.error(`Error fetching forecast for "${loc.label}":`, e);
      return null;
    }
  }

  /**
   * Get the weather forecast for a date and (optionally) a location. Defaults
   * to today and the user's configured weather locations.
   *
   * Each location is forecast in **its own** timezone — so "today" and
   * "tomorrow" mean the location's day, hourly entries are filtered to the
   * location's local date, and per-location datetime fields are formatted in
   * the location's tz. The top-level `current_time` stays in the athlete's
   * timezone.
   *
   * Date input accepts ISO YYYY-MM-DD or natural-language strings (e.g.,
   * "tomorrow", "in 3 days"). The resolved date must be within today through
   * today+10 in each location's tz.
   */
  async getWeatherForecast(args: { date?: string; location?: string } = {}): Promise<ForecastResponse> {
    const athleteTimezone = await this.intervals.getAthleteTimezone();
    const currentDateTime = getCurrentTimeInTimezone(athleteTimezone);

    if (!this.googleWeather) {
      return { current_time: currentDateTime, forecasts: [] };
    }

    // Upfront sanity check on `args.date` using the athlete's tz, so a clearly
    // out-of-range date fails fast before we incur location/geocoding/timezone
    // calls. Per-location validation runs again later in each location's tz.
    if (args.date) {
      const todayInAthleteTz = getTodayInTimezone(athleteTimezone);
      const targetInAthleteTz = parseDateStringInTimezone(args.date, athleteTimezone, 'date');
      const offset = daysBetweenYMD(todayInAthleteTz, targetInAthleteTz);
      if (offset < 0 || offset > MAX_FORECAST_DAYS) {
        const maxDate = addDaysToYMD(todayInAthleteTz, MAX_FORECAST_DAYS);
        throw new Error(
          `Forecast date ${targetInAthleteTz} is outside the supported window (${todayInAthleteTz} through ${maxDate}). The forecast covers up to ${MAX_FORECAST_DAYS} days from today.`
        );
      }
    }

    let baseLocations: { label: string; latitude: number; longitude: number }[];
    if (args.location) {
      if (!this.googleGeocoding) {
        throw new Error(
          "Free-text location lookup is not available. Omit the `location` argument to use the user's configured weather locations."
        );
      }
      const resolved = await this.googleGeocoding.geocode(args.location);
      baseLocations = [
        {
          label: resolved.formattedAddress,
          latitude: resolved.latitude,
          longitude: resolved.longitude,
        },
      ];
    } else {
      try {
        const enabled = await this.intervals.getEnabledWeatherLocations();
        baseLocations = enabled.map((loc) => ({
          label: loc.label,
          latitude: loc.latitude,
          longitude: loc.longitude,
        }));
      } catch (e) {
        console.error('Error fetching weather config from Intervals.icu:', e);
        return { current_time: currentDateTime, forecasts: [] };
      }
    }

    if (baseLocations.length === 0) {
      return { current_time: currentDateTime, forecasts: [] };
    }

    const locations = await this.resolveLocationTimezones(baseLocations, athleteTimezone);
    const now = new Date();

    // Per-location: parse `args.date` (or default "today") in the location's
    // own tz, validate against the location's [today, today+10] window, and
    // dispatch to the today or future builder.
    const results = await Promise.all(
      locations.map(async (loc) => {
        const todayInLoc = getTodayInTimezone(loc.timezone);
        const targetDate = args.date
          ? parseDateStringInTimezone(args.date, loc.timezone, 'date')
          : todayInLoc;
        const dayOffset = daysBetweenYMD(todayInLoc, targetDate);
        if (dayOffset < 0 || dayOffset > MAX_FORECAST_DAYS) {
          const maxDate = addDaysToYMD(todayInLoc, MAX_FORECAST_DAYS);
          throw new Error(
            `Forecast date ${targetDate} is outside the supported window (${todayInLoc} through ${maxDate}) for "${loc.label}". The forecast covers up to ${MAX_FORECAST_DAYS} days from today.`
          );
        }
        return dayOffset === 0
          ? this.buildOneTodayForecast(loc, now)
          : this.buildOneFutureForecast(loc, todayInLoc, targetDate);
      })
    );

    const forecasts = results.filter((r): r is LocationForecast => r !== null);
    return { current_time: currentDateTime, forecasts };
  }

  /**
   * Get today's recovery data from Whoop with current date/time in user's timezone.
   * Returns separate sleep and recovery objects under a whoop parent.
   */
  async getTodaysRecovery(): Promise<TodaysRecoveryResponse> {
    // Use athlete's timezone to get current date/time
    const timezone = await this.intervals.getAthleteTimezone();
    const currentDateTime = getCurrentTimeInTimezone(timezone);

    if (!this.whoop) {
      return {
        current_time: currentDateTime,
        whoop: {
          sleep: null,
          recovery: null,
        },
      };
    }

    const { sleep, recovery } = await this.whoop.getTodayRecovery();
    return {
      current_time: currentDateTime,
      whoop: {
        sleep,
        recovery,
      },
    };
  }

  /**
   * Get today's strain data from Whoop with current date/time in user's timezone.
   * Uses Whoop's physiological day model - returns the most recent scored cycle.
   * Returns strain data under a whoop parent.
   */
  async getTodaysStrain(): Promise<TodaysStrainResponse> {
    // Use athlete's timezone to get current date/time
    const timezone = await this.intervals.getAthleteTimezone();
    const currentDateTime = getCurrentTimeInTimezone(timezone);

    if (!this.whoop) {
      return {
        current_time: currentDateTime,
        whoop: {
          strain: null,
        },
      };
    }

    const strain = await this.whoop.getTodayStrain();
    return {
      current_time: currentDateTime,
      whoop: {
        strain,
      },
    };
  }

  /**
   * Get today's completed workouts from Intervals.icu with matched Whoop data
   * and current date/time in user's timezone.
   *
   * Pass `skipExpensiveCalls: true` to get summary-shape workouts only — the
   * caller (e.g., get_todays_summary) doesn't want the per-activity API calls
   * for intervals, notes, weather, music, etc.
   */
  async getTodaysCompletedWorkouts(opts?: { skipExpensiveCalls?: boolean }): Promise<TodaysCompletedWorkoutsResponse> {
    // Use athlete's timezone to determine "today" and get current date/time
    const timezone = await this.intervals.getAthleteTimezone();
    const today = getTodayInTimezone(timezone);
    const currentDateTime = getCurrentTimeInTimezone(timezone);

    // Fetch Intervals.icu activities
    const workouts = await this.intervals.getActivities(
      today,
      today,
      undefined,
      opts?.skipExpensiveCalls ? { skipExpensiveCalls: true } : undefined
    );

    // Enrich with matched Whoop data
    const enrichedWorkouts = await enrichWorkoutsWithWhoop(workouts, this.whoop, today, today);

    return {
      current_time: currentDateTime,
      workouts: enrichedWorkouts,
    };
  }

  /**
   * Get strain history from Whoop for a date range
   */
  async getStrainHistory(params: GetStrainHistoryInput): Promise<StrainData[]> {
    if (!this.whoop) {
      return [];
    }

    // Use athlete's timezone for date parsing
    const timezone = await this.intervals.getAthleteTimezone();
    const { startDate, endDate } = parseDateRangeInTimezone(params.oldest, params.newest, timezone);

    return await this.whoop.getStrainData(startDate, endDate);
  }

  /**
   * Get today's planned workouts from both TrainerRoad and Intervals.icu
   * with current date/time in user's timezone.
   * Returns a single merged array, preferring TrainerRoad for duplicates (has more detail).
   */
  async getTodaysPlannedWorkouts(): Promise<TodaysPlannedWorkoutsResponse> {
    // Use athlete's timezone to determine "today" and get current date/time
    const timezone = await this.intervals.getAthleteTimezone();
    const today = getTodayInTimezone(timezone);
    const currentDateTime = getCurrentTimeInTimezone(timezone);

    // Fetch, merge, and deduplicate from both sources
    const merged = await fetchAndMergePlannedWorkouts(
      this.intervals,
      this.trainerroad,
      today,
      today,
      timezone
    );

    return {
      current_time: currentDateTime,
      workouts: merged,
    };
  }

  /**
   * Get today's workouts — both completed (with full per-activity details) and planned.
   * A leaner alternative to getTodaysSummary that only returns workout data.
   */
  async getTodaysWorkouts(): Promise<TodaysWorkoutsResponse> {
    const timezone = await this.intervals.getAthleteTimezone();
    const today = getTodayInTimezone(timezone);
    const currentDateTime = getCurrentTimeInTimezone(timezone);

    const [completedResponse, plannedResponse, intervalsAnnotations, trainerroadAnnotations, trainerroadPhaseStarts, trainingPhase] = await Promise.all([
      this.getTodaysCompletedWorkouts().catch((e) => {
        console.error('Error fetching completed workouts for todays workouts:', e);
        return { current_time: currentDateTime, workouts: [] } as TodaysCompletedWorkoutsResponse;
      }),
      this.getTodaysPlannedWorkouts().catch((e) => {
        console.error('Error fetching planned workouts for todays workouts:', e);
        return { current_time: currentDateTime, workouts: [] } as TodaysPlannedWorkoutsResponse;
      }),
      this.intervals.getAnnotations(today, today).catch((e) => {
        console.error('Error fetching Intervals.icu annotations for todays workouts:', e);
        return [] as Annotation[];
      }),
      this.trainerroad
        ? this.trainerroad.getAnnotations(today, today, timezone).catch((e) => {
            console.error('Error fetching TrainerRoad annotations for todays workouts:', e);
            return [] as Annotation[];
          })
        : Promise.resolve([] as Annotation[]),
      this.trainerroad
        ? this.trainerroad.getTrainingPhaseStarts(today, today).catch((e) => {
            console.error('Error fetching TrainerRoad phase starts for todays workouts:', e);
            return [] as Annotation[];
          })
        : Promise.resolve([] as Annotation[]),
      this.trainerroad
        ? this.trainerroad.getCurrentTrainingPhase(today).catch((e) => {
            console.error('Error fetching current training phase for todays workouts:', e);
            return null as TrainingPhase | null;
          })
        : Promise.resolve(null as TrainingPhase | null),
    ]);

    const annotations = mergeAnnotations(intervalsAnnotations, [
      ...trainerroadAnnotations,
      ...trainerroadPhaseStarts,
    ]);

    const completed = completedResponse.workouts;
    const planned = plannedResponse.workouts;

    const tssCompleted = completed.reduce((sum, w) => sum + (w.tss || 0), 0);
    const tssPlanned = planned.reduce((sum, w) => sum + (w.expected_tss || 0), 0);

    return {
      current_time: currentDateTime,
      completed_workouts: completed,
      planned_workouts: planned,
      annotations,
      training_phase: trainingPhase,
      workouts_completed: completed.length,
      workouts_planned: planned.length,
      tss_completed: Math.round(tssCompleted),
      tss_planned: Math.round(tssPlanned),
    };
  }

  /**
   * Get athlete profile including unit preferences, age, and location.
   * Note: Sport-specific settings are now retrieved via getSportSettings().
   */
  async getAthleteProfile(): Promise<AthleteProfile> {
    return await this.intervals.getAthleteProfile();
  }

  /**
   * Get sport-specific settings (FTP, zones, etc.) for one or more sports.
   * Returns an object keyed by sport name. Each requested sport is present
   * (null when the athlete has no settings for that sport); unrequested
   * sports are absent. Omit `sports` to fetch all three.
   */
  async getSportSettings(
    sports?: ('cycling' | 'running' | 'swimming')[]
  ): Promise<Partial<Record<'cycling' | 'running' | 'swimming', { types: string[]; settings: unknown } | null>>> {
    const requested = sports ?? ['cycling', 'running', 'swimming'];
    const results = await Promise.all(
      requested.map((sport) => this.intervals.getSportSettingsForSport(sport))
    );
    const out: Partial<Record<'cycling' | 'running' | 'swimming', { types: string[]; settings: unknown } | null>> = {};
    requested.forEach((sport, i) => {
      const r = results[i];
      out[sport] = r ? { types: r.types, settings: r.settings } : null;
    });
    return out;
  }

  /**
   * Get a complete summary of today's data including recovery, strain, and workouts.
   * This is the single tool for all "today's" data - recovery, sleep, strain,
   * completed workouts, and planned workouts.
   *
   * Note: Whoop insight fields (recovery_level, strain_level, sleep_performance_level, etc.)
   * are included directly in the recovery and strain objects.
   */
  async getTodaysSummary(): Promise<DailySummary> {
    // Use athlete's timezone to determine "today"
    const timezone = await this.intervals.getAthleteTimezone();
    const today = getTodayInTimezone(timezone);

    // Fetch all data in parallel for efficiency
    const [recoveryResponse, strainResponse, bodyMeasurements, fitness, wellness, completedWorkoutsResponse, plannedWorkoutsResponse, intervalsAnnotations, trainerroadAnnotations, trainerroadPhaseStarts, trainingPhase, todaysRace, forecast] = await Promise.all([
      this.getTodaysRecovery().catch((e) => {
        console.error('Error fetching recovery for daily summary:', e);
        return { current_time: getCurrentTimeInTimezone(timezone), whoop: { sleep: null, recovery: null } };
      }),
      this.getTodaysStrain().catch((e) => {
        console.error('Error fetching strain for daily summary:', e);
        return { current_time: getCurrentTimeInTimezone(timezone), whoop: { strain: null } };
      }),
      this.whoop?.getBodyMeasurements().catch((e) => {
        console.error('Error fetching body measurements for daily summary:', e);
        return null;
      }) ?? Promise.resolve(null),
      this.intervals.getTodayFitness().catch((e) => {
        console.error('Error fetching fitness for daily summary:', e);
        return null;
      }),
      this.intervals.getTodayWellness().catch((e) => {
        console.error('Error fetching wellness for daily summary:', e);
        return null;
      }),
      this.getTodaysCompletedWorkouts({ skipExpensiveCalls: true }).catch((e) => {
        console.error('Error fetching completed workouts for daily summary:', e);
        return { current_time: getCurrentTimeInTimezone(timezone), workouts: [] };
      }),
      this.getTodaysPlannedWorkouts().catch((e) => {
        console.error('Error fetching planned workouts for daily summary:', e);
        return { current_time: getCurrentTimeInTimezone(timezone), workouts: [] };
      }),
      this.intervals.getAnnotations(today, today).catch((e) => {
        console.error('Error fetching Intervals.icu annotations for daily summary:', e);
        return [] as Annotation[];
      }),
      this.trainerroad
        ? this.trainerroad.getAnnotations(today, today, timezone).catch((e) => {
            console.error('Error fetching TrainerRoad annotations for daily summary:', e);
            return [] as Annotation[];
          })
        : Promise.resolve([] as Annotation[]),
      this.trainerroad
        ? this.trainerroad.getTrainingPhaseStarts(today, today).catch((e) => {
            console.error('Error fetching TrainerRoad phase starts for daily summary:', e);
            return [] as Annotation[];
          })
        : Promise.resolve([] as Annotation[]),
      this.trainerroad
        ? this.trainerroad.getCurrentTrainingPhase(today).catch((e) => {
            console.error('Error fetching current training phase for daily summary:', e);
            return null as TrainingPhase | null;
          })
        : Promise.resolve(null as TrainingPhase | null),
      this.trainerroad
        ? this.trainerroad.getUpcomingRaces(timezone).then((races) => {
            // Filter for today's race only
            const todaysRace = races.find((race) => race.scheduled_for.startsWith(today));
            return todaysRace ?? null;
          }).catch((e) => {
            console.error('Error fetching races for daily summary:', e);
            return null as Race | null;
          })
        : Promise.resolve(null as Race | null),
      this.buildForecasts(timezone, new Date()).catch((e) => {
        console.error('Error building forecast for daily summary:', e);
        return [] as LocationForecast[];
      }),
    ]);

    // Extract data from response objects
    const { sleep, recovery } = recoveryResponse.whoop;
    const { strain } = strainResponse.whoop;
    const completedWorkouts = completedWorkoutsResponse.workouts;
    const plannedWorkouts = plannedWorkoutsResponse.workouts;
    const annotations = mergeAnnotations(intervalsAnnotations, [
      ...trainerroadAnnotations,
      ...trainerroadPhaseStarts,
    ]);

    // Calculate TSS totals
    const tssCompleted = completedWorkouts.reduce(
      (sum, w) => sum + (w.tss || 0),
      0
    );
    const tssPlanned = plannedWorkouts.reduce(
      (sum, w) => sum + (w.expected_tss || 0),
      0
    );

    // Get current datetime in user's timezone for context
    const currentDateTime = getCurrentTimeInTimezone(timezone);

    return {
      current_time: currentDateTime,
      whoop: {
        body_measurements: bodyMeasurements,
        strain,
        sleep,
        recovery,
      },
      fitness,
      wellness,
      planned_workouts: plannedWorkouts,
      completed_workouts: completedWorkouts,
      annotations,
      training_phase: trainingPhase,
      scheduled_race: todaysRace,
      forecast,
      workouts_planned: plannedWorkouts.length,
      workouts_completed: completedWorkouts.length,
      tss_planned: Math.round(tssPlanned),
      tss_completed: Math.round(tssCompleted),
    };
  }
}
