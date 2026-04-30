import { IntervalsClient } from '../clients/intervals.js';
import { WhoopClient } from '../clients/whoop.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { GoogleWeatherClient } from '../clients/google-weather.js';
import { GoogleAirQualityClient } from '../clients/google-air-quality.js';
import { GooglePollenClient } from '../clients/google-pollen.js';
import { GoogleElevationClient } from '../clients/google-elevation.js';
import { parseDateRangeInTimezone, getTodayInTimezone } from '../utils/tz.js';
import { getCurrentTimeInTimezone } from '../utils/date-formatting.js';
import { DOMESTIQUE_TAG, enrichWorkoutsWithWhoop, fetchAndMergePlannedWorkouts } from '../utils/workout-utils.js';
import { assembleLocationForecast } from '../utils/weather.js';
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
  TodaysForecastResponse,
  LocationForecast,
  Race,
} from '../types/index.js';
import { filterWhoopDuplicateFields } from '../types/index.js';
import type { GetStrainHistoryInput } from './types.js';

export class CurrentTools {
  constructor(
    private intervals: IntervalsClient,
    private whoop: WhoopClient | null,
    private trainerroad: TrainerRoadClient | null,
    private googleWeather: GoogleWeatherClient | null = null,
    private googleAirQuality: GoogleAirQualityClient | null = null,
    private googlePollen: GooglePollenClient | null = null,
    private googleElevation: GoogleElevationClient | null = null
  ) {}

  /**
   * Build today's per-location weather forecast for every enabled location in
   * the athlete's Intervals.icu weather config. Returns [] when Google Weather
   * is not configured or there are no enabled locations. Per-location failures
   * are logged and skipped — one bad location doesn't suppress the others.
   *
   * For each location we issue the Google Weather calls (current conditions,
   * hourly forecast, public alerts, daily forecast for sun events) plus
   * Google Air Quality calls (current AQI, hourly AQI), the Google Pollen
   * call (today's pollen forecast), and the Google Elevation call in parallel
   * and let any one of them fail independently — a missing alerts feed, AQI,
   * sun events, pollen, or elevation shouldn't suppress the forecast itself.
   */
  private async buildForecasts(timezone: string, now: Date): Promise<LocationForecast[]> {
    if (!this.googleWeather) return [];

    let locations: Awaited<ReturnType<IntervalsClient['getEnabledWeatherLocations']>>;
    try {
      locations = await this.intervals.getEnabledWeatherLocations();
    } catch (e) {
      console.error('Error fetching weather config from Intervals.icu:', e);
      return [];
    }

    const gw = this.googleWeather;
    const aq = this.googleAirQuality;
    const pollen = this.googlePollen;
    const elev = this.googleElevation;
    // 24h covers the "rest of today" hourly window the weather forecast
    // surfaces; the AQ API computes the window from its own "now."
    const aqHours = 24;

    const results = await Promise.all(
      locations.map(async (loc) => {
        try {
          const [current, hourly, alerts, daily, currentAq, hourlyAq, pollenForecast, elevation] = await Promise.all([
            gw.getCurrentConditions(loc.latitude, loc.longitude).catch((e) => {
              console.error(`Error fetching current conditions for "${loc.label}":`, e);
              return undefined;
            }),
            gw.getHourlyForecast(loc.latitude, loc.longitude).catch((e) => {
              console.error(`Error fetching hourly forecast for "${loc.label}":`, e);
              return undefined;
            }),
            gw.getWeatherAlerts(loc.latitude, loc.longitude).catch((e) => {
              console.error(`Error fetching weather alerts for "${loc.label}":`, e);
              return undefined;
            }),
            gw.getDailyForecast(loc.latitude, loc.longitude).catch((e) => {
              console.error(`Error fetching daily forecast for "${loc.label}":`, e);
              return undefined;
            }),
            aq
              ? aq.getCurrentAirQuality(loc.latitude, loc.longitude).catch((e) => {
                  console.error(`Error fetching current air quality for "${loc.label}":`, e);
                  return undefined;
                })
              : Promise.resolve(undefined),
            aq
              ? aq
                  .getHourlyAirQualityForecast(loc.latitude, loc.longitude, aqHours)
                  .catch((e) => {
                    console.error(`Error fetching hourly air quality for "${loc.label}":`, e);
                    return undefined;
                  })
              : Promise.resolve(undefined),
            pollen
              ? pollen.getPollenForecast(loc.latitude, loc.longitude, 1).catch((e) => {
                  console.error(`Error fetching pollen forecast for "${loc.label}":`, e);
                  return undefined;
                })
              : Promise.resolve(undefined),
            elev
              ? elev.getElevation(loc.latitude, loc.longitude).catch((e) => {
                  console.error(`Error fetching elevation for "${loc.label}":`, e);
                  return undefined;
                })
              : Promise.resolve(undefined),
          ]);
          return assembleLocationForecast(
            loc.label,
            loc.latitude,
            loc.longitude,
            current,
            hourly,
            alerts,
            timezone,
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
      })
    );
    return results.filter((r): r is LocationForecast => r !== null);
  }

  /**
   * Get today's weather forecast for each enabled location in the athlete's
   * Intervals.icu weather config. Returns an empty `forecasts` array if
   * Google Weather is not configured.
   */
  async getTodaysForecast(): Promise<TodaysForecastResponse> {
    const timezone = await this.intervals.getAthleteTimezone();
    const currentDateTime = getCurrentTimeInTimezone(timezone);
    const forecasts = await this.buildForecasts(timezone, new Date());
    return {
      current_time: currentDateTime,
      forecasts,
    };
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
   * and current date/time in user's timezone
   */
  async getTodaysCompletedWorkouts(): Promise<TodaysCompletedWorkoutsResponse> {
    // Use athlete's timezone to determine "today" and get current date/time
    const timezone = await this.intervals.getAthleteTimezone();
    const today = getTodayInTimezone(timezone);
    const currentDateTime = getCurrentTimeInTimezone(timezone);

    // Fetch Intervals.icu activities
    const workouts = await this.intervals.getActivities(today, today);

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
    const currentDateTime = getCurrentTimeInTimezone(timezone);

    const [completedResponse, plannedResponse] = await Promise.all([
      this.getTodaysCompletedWorkouts().catch((e) => {
        console.error('Error fetching completed workouts for todays workouts:', e);
        return { current_time: currentDateTime, workouts: [] } as TodaysCompletedWorkoutsResponse;
      }),
      this.getTodaysPlannedWorkouts().catch((e) => {
        console.error('Error fetching planned workouts for todays workouts:', e);
        return { current_time: currentDateTime, workouts: [] } as TodaysPlannedWorkoutsResponse;
      }),
    ]);

    const completed = completedResponse.workouts;
    const planned = plannedResponse.workouts;

    const tssCompleted = completed.reduce((sum, w) => sum + (w.tss || 0), 0);
    const tssPlanned = planned.reduce((sum, w) => sum + (w.expected_tss || 0), 0);

    return {
      current_time: currentDateTime,
      completed_workouts: completed,
      planned_workouts: planned,
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
   * Get sport-specific settings (FTP, zones, etc.) for a specific sport.
   * @param sport - "cycling", "running", or "swimming"
   */
  async getSportSettings(sport: 'cycling' | 'running' | 'swimming'): Promise<SportSettingsResponse | null> {
    return await this.intervals.getSportSettingsForSport(sport);
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
    const [recoveryResponse, strainResponse, bodyMeasurements, fitness, wellness, completedWorkoutsResponse, plannedWorkoutsResponse, todaysRace, forecast] = await Promise.all([
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
      this.getTodaysCompletedWorkouts().catch((e) => {
        console.error('Error fetching completed workouts for daily summary:', e);
        return { current_time: getCurrentTimeInTimezone(timezone), workouts: [] };
      }),
      this.getTodaysPlannedWorkouts().catch((e) => {
        console.error('Error fetching planned workouts for daily summary:', e);
        return { current_time: getCurrentTimeInTimezone(timezone), workouts: [] };
      }),
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

    // Filter out Whoop-duplicate fields from wellness when Whoop is connected
    // Whoop provides more detailed sleep/HRV metrics
    const filteredWellness = this.whoop
      ? filterWhoopDuplicateFields(wellness)
      : wellness;

    return {
      current_time: currentDateTime,
      whoop: {
        body_measurements: bodyMeasurements,
        strain,
        sleep,
        recovery,
      },
      fitness,
      wellness: filteredWellness,
      planned_workouts: plannedWorkouts,
      completed_workouts: completedWorkouts,
      scheduled_race: todaysRace,
      forecast,
      workouts_planned: plannedWorkouts.length,
      workouts_completed: completedWorkouts.length,
      tss_planned: Math.round(tssPlanned),
      tss_completed: Math.round(tssCompleted),
    };
  }
}
