import { IntervalsClient } from '../clients/intervals.js';
import { WhoopClient } from '../clients/whoop.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { parseDateString, getToday, getTodayInTimezone, parseDateStringInTimezone } from '../utils/date-parser.js';
import { findMatchingWhoopActivity } from '../utils/activity-matcher.js';
import type {
  RecoveryData,
  StrainData,
  PlannedWorkout,
  NormalizedWorkout,
  WorkoutWithWhoop,
  StrainActivity,
  WhoopMatchedData,
  AthleteProfile,
  DailySummary,
  SportSettingsResponse,
} from '../types/index.js';
import type { GetStrainHistoryInput } from './types.js';

export class CurrentTools {
  constructor(
    private intervals: IntervalsClient,
    private whoop: WhoopClient | null,
    private trainerroad: TrainerRoadClient | null
  ) {}

  /**
   * Get today's recovery data from Whoop
   */
  async getTodaysRecovery(): Promise<RecoveryData | null> {
    if (!this.whoop) {
      return null;
    }

    try {
      return await this.whoop.getTodayRecovery();
    } catch (error) {
      console.error('Error fetching today\'s recovery:', error);
      throw error;
    }
  }

  /**
   * Get today's strain data from Whoop.
   * Uses Whoop's physiological day model - returns the most recent scored cycle.
   */
  async getTodaysStrain(): Promise<StrainData | null> {
    if (!this.whoop) {
      return null;
    }

    try {
      return await this.whoop.getTodayStrain();
    } catch (error) {
      console.error('Error fetching today\'s strain:', error);
      throw error;
    }
  }

  /**
   * Get today's completed workouts from Intervals.icu with matched Whoop data
   */
  async getTodaysCompletedWorkouts(): Promise<WorkoutWithWhoop[]> {
    // Use athlete's timezone to determine "today"
    const timezone = await this.intervals.getAthleteTimezone();
    const today = getTodayInTimezone(timezone);

    try {
      // Fetch Intervals.icu activities
      const workouts = await this.intervals.getActivities(today, today);

      // If no Whoop client, return workouts without Whoop data
      if (!this.whoop) {
        return workouts.map((workout) => ({
          ...workout,
          whoop: null,
        }));
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
      return workouts.map((workout) => ({
        ...workout,
        whoop: this.findAndMatchWhoopActivity(workout, whoopActivities),
      }));
    } catch (error) {
      console.error('Error fetching today\'s completed workouts:', error);
      throw error;
    }
  }

  /**
   * Find and match a Whoop activity to an Intervals.icu workout
   */
  private findAndMatchWhoopActivity(
    workout: NormalizedWorkout,
    whoopActivities: StrainActivity[]
  ): WhoopMatchedData | null {
    const match = findMatchingWhoopActivity(workout, whoopActivities);
    if (!match) return null;

    return {
      strain_score: match.strain_score,
      average_heart_rate: match.average_heart_rate,
      max_heart_rate: match.max_heart_rate,
      calories: match.calories,
      distance: match.distance,
      elevation_gain: match.elevation_gain,
      zone_durations: match.zone_durations,
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
    const startDate = parseDateStringInTimezone(params.start_date, timezone);
    const endDate = params.end_date
      ? parseDateStringInTimezone(params.end_date, timezone)
      : getTodayInTimezone(timezone);

    try {
      return await this.whoop.getStrainData(startDate, endDate);
    } catch (error) {
      console.error('Error fetching strain history:', error);
      throw error;
    }
  }

  /**
   * Get today's planned workouts from both TrainerRoad and Intervals.icu.
   * Returns a single merged array, preferring TrainerRoad for duplicates (has more detail).
   */
  async getTodaysPlannedWorkouts(): Promise<PlannedWorkout[]> {
    // Use athlete's timezone to determine "today"
    const timezone = await this.intervals.getAthleteTimezone();
    const today = getTodayInTimezone(timezone);

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
        this.areWorkoutsSimilar(tr, intervalsWorkout)
      );
      if (!isDuplicate) {
        merged.push(intervalsWorkout);
      }
    }

    return merged;
  }

  /**
   * Check if two workouts are likely the same (for deduplication)
   */
  private areWorkoutsSimilar(a: PlannedWorkout, b: PlannedWorkout): boolean {
    // Same day check
    const dateA = a.date.split('T')[0];
    const dateB = b.date.split('T')[0];
    if (dateA !== dateB) return false;

    // Similar name check (fuzzy)
    const nameA = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nameB = b.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (nameA.includes(nameB) || nameB.includes(nameA)) return true;

    // Similar TSS check
    if (a.expected_tss && b.expected_tss) {
      const tssDiff = Math.abs(a.expected_tss - b.expected_tss);
      if (tssDiff < 5) return true;
    }

    return false;
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
    const [recovery, strain, completedWorkouts, plannedWorkouts] = await Promise.all([
      this.getTodaysRecovery().catch((e) => {
        console.error('Error fetching recovery for daily summary:', e);
        return null;
      }),
      this.getTodaysStrain().catch((e) => {
        console.error('Error fetching strain for daily summary:', e);
        return null;
      }),
      this.getTodaysCompletedWorkouts().catch((e) => {
        console.error('Error fetching completed workouts for daily summary:', e);
        return [];
      }),
      this.getTodaysPlannedWorkouts().catch((e) => {
        console.error('Error fetching planned workouts for daily summary:', e);
        return [];
      }),
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

    return {
      date: today,
      recovery,
      strain,
      completed_workouts: completedWorkouts,
      planned_workouts: plannedWorkouts,
      workouts_completed: completedWorkouts.length,
      workouts_planned: plannedWorkouts.length,
      tss_completed: Math.round(tssCompleted),
      tss_planned: Math.round(tssPlanned),
    };
  }
}
