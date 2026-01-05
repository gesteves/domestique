import { IntervalsClient } from '../clients/intervals.js';
import { WhoopClient } from '../clients/whoop.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { parseDateString, getToday, getTodayInTimezone, parseDateStringInTimezone, getCurrentDateTimeInTimezone } from '../utils/date-parser.js';
import { DOMESTIQUE_TAG, areWorkoutsSimilar, matchWhoopActivity } from '../utils/workout-utils.js';
import type {
  StrainData,
  FitnessMetrics,
  PlannedWorkout,
  NormalizedWorkout,
  WorkoutWithWhoop,
  StrainActivity,
  WhoopMatchedData,
  AthleteProfile,
  DailySummary,
  SportSettingsResponse,
  TodaysRecoveryResponse,
  TodaysStrainResponse,
  TodaysCompletedWorkoutsResponse,
  TodaysPlannedWorkoutsResponse,
  WhoopSleepData,
  WhoopRecoveryData,
  Race,
} from '../types/index.js';
import { filterWhoopDuplicateFields } from '../types/index.js';
import type { GetStrainHistoryInput } from './types.js';

export class CurrentTools {
  constructor(
    private intervals: IntervalsClient,
    private whoop: WhoopClient | null,
    private trainerroad: TrainerRoadClient | null
  ) {}

  /**
   * Get today's recovery data from Whoop with current date/time in user's timezone.
   * Returns separate sleep and recovery objects under a whoop parent.
   */
  async getTodaysRecovery(): Promise<TodaysRecoveryResponse> {
    // Use athlete's timezone to get current date/time
    const timezone = await this.intervals.getAthleteTimezone();
    const currentDateTime = getCurrentDateTimeInTimezone(timezone);

    if (!this.whoop) {
      return {
        current_time: currentDateTime,
        whoop: {
          sleep: null,
          recovery: null,
        },
      };
    }

    try {
      const { sleep, recovery } = await this.whoop.getTodayRecovery();
      return {
        current_time: currentDateTime,
        whoop: {
          sleep,
          recovery,
        },
      };
    } catch (error) {
      console.error('Error fetching today\'s recovery:', error);
      throw error;
    }
  }

  /**
   * Get today's strain data from Whoop with current date/time in user's timezone.
   * Uses Whoop's physiological day model - returns the most recent scored cycle.
   * Returns strain data under a whoop parent.
   */
  async getTodaysStrain(): Promise<TodaysStrainResponse> {
    // Use athlete's timezone to get current date/time
    const timezone = await this.intervals.getAthleteTimezone();
    const currentDateTime = getCurrentDateTimeInTimezone(timezone);

    if (!this.whoop) {
      return {
        current_time: currentDateTime,
        whoop: {
          strain: null,
        },
      };
    }

    try {
      const strain = await this.whoop.getTodayStrain();
      return {
        current_time: currentDateTime,
        whoop: {
          strain,
        },
      };
    } catch (error) {
      console.error('Error fetching today\'s strain:', error);
      throw error;
    }
  }

  /**
   * Get today's completed workouts from Intervals.icu with matched Whoop data
   * and current date/time in user's timezone
   */
  async getTodaysCompletedWorkouts(): Promise<TodaysCompletedWorkoutsResponse> {
    // Use athlete's timezone to determine "today" and get current date/time
    const timezone = await this.intervals.getAthleteTimezone();
    const today = getTodayInTimezone(timezone);
    const currentDateTime = getCurrentDateTimeInTimezone(timezone);

    try {
      // Fetch Intervals.icu activities
      const workouts = await this.intervals.getActivities(today, today);

      // If no Whoop client, return workouts without Whoop data
      if (!this.whoop) {
        return {
          current_time: currentDateTime,
          workouts: workouts.map((workout) => ({
            ...workout,
            whoop: null,
          })),
        };
      }

      // Fetch Whoop activities for today
      let whoopActivities: StrainActivity[] = [];
      try {
        whoopActivities = await this.whoop.getWorkouts(today, today);
      } catch (error) {
        console.error('Error fetching Whoop activities for matching:', error);
        // Continue without Whoop data rather than failing entirely
      }

      // Match and merge
      return {
        current_time: currentDateTime,
        workouts: workouts.map((workout) => ({
          ...workout,
          whoop: matchWhoopActivity(workout, whoopActivities),
        })),
      };
    } catch (error) {
      console.error('Error fetching today\'s completed workouts:', error);
      throw error;
    }
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
    const startDate = parseDateStringInTimezone(params.oldest, timezone, 'oldest');
    const endDate = params.newest
      ? parseDateStringInTimezone(params.newest, timezone, 'newest')
      : getTodayInTimezone(timezone);

    try {
      return await this.whoop.getStrainData(startDate, endDate);
    } catch (error) {
      console.error('Error fetching strain history:', error);
      throw error;
    }
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
    const currentDateTime = getCurrentDateTimeInTimezone(timezone);

    // Fetch from both sources in parallel
    const [trainerroadWorkouts, intervalsWorkouts] = await Promise.all([
      this.trainerroad?.getTodayWorkouts(timezone).catch((e) => {
        console.error('Error fetching TrainerRoad workouts:', e);
        return [];
      }) ?? Promise.resolve([]),
      this.intervals.getPlannedEvents(today, today).catch((e) => {
        console.error('Error fetching Intervals.icu events:', e);
        return [];
      }),
    ]);

    // Merge workouts, preferring TrainerRoad for duplicates (has more detail)
    const merged = [...trainerroadWorkouts];

    // Add Intervals.icu workouts that don't seem to be duplicates
    for (const intervalsWorkout of intervalsWorkouts) {
      const isDuplicate = trainerroadWorkouts.some((tr) =>
        areWorkoutsSimilar(tr, intervalsWorkout)
      );
      if (!isDuplicate) {
        merged.push(intervalsWorkout);
      }
    }

    return {
      current_time: currentDateTime,
      workouts: merged,
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
   * Get a complete daily summary including recovery, strain, and workouts.
   * Consolidates 4 tool calls into 1 for efficiency.
   *
   * Note: Whoop insight fields (recovery_level, strain_level, sleep_performance_level, etc.)
   * are included directly in the recovery and strain objects.
   */
  async getDailySummary(): Promise<DailySummary> {
    // Use athlete's timezone to determine "today"
    const timezone = await this.intervals.getAthleteTimezone();
    const today = getTodayInTimezone(timezone);

    // Fetch all data in parallel for efficiency
    const [recoveryResponse, strainResponse, bodyMeasurements, fitness, wellness, completedWorkoutsResponse, plannedWorkoutsResponse, todaysRace] = await Promise.all([
      this.getTodaysRecovery().catch((e) => {
        console.error('Error fetching recovery for daily summary:', e);
        return { current_time: getCurrentDateTimeInTimezone(timezone), whoop: { sleep: null, recovery: null } };
      }),
      this.getTodaysStrain().catch((e) => {
        console.error('Error fetching strain for daily summary:', e);
        return { current_time: getCurrentDateTimeInTimezone(timezone), whoop: { strain: null } };
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
        return { current_time: getCurrentDateTimeInTimezone(timezone), workouts: [] };
      }),
      this.getTodaysPlannedWorkouts().catch((e) => {
        console.error('Error fetching planned workouts for daily summary:', e);
        return { current_time: getCurrentDateTimeInTimezone(timezone), workouts: [] };
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
    const currentDateTime = getCurrentDateTimeInTimezone(timezone);

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
      workouts_planned: plannedWorkouts.length,
      workouts_completed: completedWorkouts.length,
      tss_planned: Math.round(tssPlanned),
      tss_completed: Math.round(tssCompleted),
    };
  }
}
