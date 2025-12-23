import { IntervalsClient } from '../clients/intervals.js';
import { WhoopClient } from '../clients/whoop.js';
import { TrainerRoadClient } from '../clients/trainerroad.js';
import { getDaysBackRange, getToday } from '../utils/date-parser.js';
import { findMatchingWhoopActivity } from '../utils/activity-matcher.js';
import type {
  NormalizedWorkout,
  WorkoutWithWhoop,
  WhoopMatchedData,
  RecoveryData,
  StrainData,
  StrainActivity,
  PlannedWorkout,
  AthleteProfile,
} from '../types/index.js';
import type { GetRecentWorkoutsInput, GetRecentStrainInput } from './types.js';

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
   * Get recent completed workouts from Intervals.icu with optional Whoop data
   */
  async getRecentWorkouts(
    params: GetRecentWorkoutsInput
  ): Promise<WorkoutWithWhoop[]> {
    const { days, sport } = params;
    const range = getDaysBackRange(days);

    try {
      // Fetch Intervals.icu activities
      const workouts = await this.intervals.getActivities(
        range.start,
        range.end,
        sport
      );

      // If no Whoop client, return workouts without Whoop data
      if (!this.whoop) {
        return workouts.map((workout) => ({
          ...workout,
          whoop: null,
        }));
      }

      // Fetch Whoop activities for the same date range
      let whoopActivities: StrainActivity[] = [];
      try {
        whoopActivities = await this.whoop.getWorkouts(range.start, range.end);
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
      console.error('Error fetching recent workouts:', error);
      throw error;
    }
  }

  /**
   * Find matching Whoop activity for an Intervals.icu workout.
   * Uses UTC timestamps (start_date_utc) when available for accurate matching.
   */
  private findAndMatchWhoopActivity(
    workout: NormalizedWorkout,
    whoopActivities: StrainActivity[]
  ): WhoopMatchedData | null {
    const matchResult = findMatchingWhoopActivity(workout, whoopActivities);

    if (!matchResult) {
      return null;
    }

    // Determine match confidence using UTC timestamps
    // Prefer start_date_utc (UTC) over date (local) for accurate comparison
    const workoutTimestamp = workout.start_date_utc ?? workout.date;
    const workoutStart = new Date(workoutTimestamp);
    const activityStart = new Date(matchResult.start_time);
    const timeDiffMinutes = Math.abs(
      (workoutStart.getTime() - activityStart.getTime()) / (1000 * 60)
    );

    let confidence: 'high' | 'medium' | 'low';
    let method: 'timestamp' | 'date_and_type' | 'date_only';

    if (timeDiffMinutes <= 5) {
      confidence = 'high';
      method = 'timestamp';
    } else if (workout.activity_type === matchResult.activity_type) {
      confidence = 'medium';
      method = 'date_and_type';
    } else {
      confidence = 'low';
      method = 'date_only';
    }

    return {
      strain_score: matchResult.strain_score,
      average_heart_rate: matchResult.average_heart_rate,
      max_heart_rate: matchResult.max_heart_rate,
      calories: matchResult.calories,
      distance_meters: matchResult.distance_meters,
      altitude_gain_meters: matchResult.altitude_gain_meters,
      zone_durations: matchResult.zone_durations,
      match_confidence: confidence,
      match_method: method,
    };
  }

  /**
   * Get athlete profile including zones and thresholds
   */
  async getAthleteProfile(): Promise<AthleteProfile> {
    try {
      return await this.intervals.getAthleteProfile();
    } catch (error) {
      console.error('Error fetching athlete profile:', error);
      throw error;
    }
  }

  /**
   * Get recent strain data from Whoop
   */
  async getRecentStrain(params: GetRecentStrainInput): Promise<StrainData[]> {
    if (!this.whoop) {
      return [];
    }

    const { days } = params;
    const range = getDaysBackRange(days);

    try {
      return await this.whoop.getStrainData(range.start, range.end);
    } catch (error) {
      console.error('Error fetching recent strain:', error);
      throw error;
    }
  }

  /**
   * Get today's planned workouts from both TrainerRoad and Intervals.icu
   */
  async getTodaysPlannedWorkouts(): Promise<{
    trainerroad: PlannedWorkout[];
    intervals: PlannedWorkout[];
    merged: PlannedWorkout[];
  }> {
    const today = getToday();
    const results: {
      trainerroad: PlannedWorkout[];
      intervals: PlannedWorkout[];
      merged: PlannedWorkout[];
    } = {
      trainerroad: [],
      intervals: [],
      merged: [],
    };

    // Fetch from both sources in parallel
    const [trainerroadWorkouts, intervalsWorkouts] = await Promise.all([
      this.trainerroad?.getTodayWorkouts().catch((e) => {
        console.error('Error fetching TrainerRoad workouts:', e);
        return [];
      }) ?? Promise.resolve([]),
      this.intervals.getPlannedEvents(today, today).catch((e) => {
        console.error('Error fetching Intervals.icu events:', e);
        return [];
      }),
    ]);

    results.trainerroad = trainerroadWorkouts;
    results.intervals = intervalsWorkouts;

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

    results.merged = merged;
    return results;
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
}
