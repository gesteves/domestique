import { IntervalsClient } from '../clients/intervals.js';
import { WhoopClient } from '../clients/whoop.js';
import { parseDateString, getToday } from '../utils/date-parser.js';
import { findMatchingWhoopActivity } from '../utils/activity-matcher.js';
import type {
  RecoveryData,
  TrainingLoadTrends,
  WorkoutWithWhoop,
  StrainActivity,
  NormalizedWorkout,
  WhoopMatchedData,
  WorkoutIntervalsResponse,
} from '../types/index.js';
import type {
  GetWorkoutHistoryInput,
  GetRecoveryTrendsInput,
} from './types.js';

export class HistoricalTools {
  constructor(
    private intervals: IntervalsClient,
    private whoop: WhoopClient | null
  ) {}

  /**
   * Get workout history with flexible date ranges, including matched Whoop data
   */
  async getWorkoutHistory(
    params: GetWorkoutHistoryInput
  ): Promise<WorkoutWithWhoop[]> {
    const startDate = parseDateString(params.start_date);
    const endDate = params.end_date ? parseDateString(params.end_date) : getToday();

    try {
      // Fetch Intervals.icu activities
      const workouts = await this.intervals.getActivities(startDate, endDate, params.sport);

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
        whoopActivities = await this.whoop.getWorkouts(startDate, endDate);
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
      console.error('Error fetching workout history:', error);
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
      distance_meters: match.distance_meters,
      altitude_gain_meters: match.altitude_gain_meters,
      zone_durations: match.zone_durations,
      match_confidence: 'high', // findMatchingWhoopActivity only returns timestamp or date+type matches
      match_method: 'timestamp',
    };
  }

  /**
   * Get recovery trends over time
   */
  async getRecoveryTrends(
    params: GetRecoveryTrendsInput
  ): Promise<{
    data: RecoveryData[];
    summary: {
      avg_recovery: number;
      avg_hrv: number;
      avg_sleep_hours: number;
      min_recovery: number;
      max_recovery: number;
    };
  }> {
    if (!this.whoop) {
      return {
        data: [],
        summary: {
          avg_recovery: 0,
          avg_hrv: 0,
          avg_sleep_hours: 0,
          min_recovery: 0,
          max_recovery: 0,
        },
      };
    }

    const startDate = parseDateString(params.start_date);
    const endDate = params.end_date ? parseDateString(params.end_date) : getToday();

    try {
      const data = await this.whoop.getRecoveries(startDate, endDate);

      // Calculate summary statistics
      const summary = this.calculateRecoverySummary(data);

      return { data, summary };
    } catch (error) {
      console.error('Error fetching recovery trends:', error);
      throw error;
    }
  }

  private calculateRecoverySummary(data: RecoveryData[]): {
    avg_recovery: number;
    avg_hrv: number;
    avg_sleep_hours: number;
    min_recovery: number;
    max_recovery: number;
  } {
    if (data.length === 0) {
      return {
        avg_recovery: 0,
        avg_hrv: 0,
        avg_sleep_hours: 0,
        min_recovery: 0,
        max_recovery: 0,
      };
    }

    const recoveryScores = data.map((d) => d.recovery_score);
    const hrvValues = data.map((d) => d.hrv_rmssd);
    const sleepHours = data.map((d) => d.sleep_duration_hours);

    return {
      avg_recovery: this.average(recoveryScores),
      avg_hrv: this.average(hrvValues),
      avg_sleep_hours: this.average(sleepHours),
      min_recovery: Math.min(...recoveryScores),
      max_recovery: Math.max(...recoveryScores),
    };
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  }

  // ============================================
  // Training Load Trends
  // ============================================

  /**
   * Get training load trends (CTL/ATL/TSB) with ACWR analysis
   */
  async getTrainingLoadTrends(days: number = 42): Promise<TrainingLoadTrends> {
    try {
      return await this.intervals.getTrainingLoadTrends(days);
    } catch (error) {
      console.error('Error fetching training load trends:', error);
      throw error;
    }
  }

  // ============================================
  // Workout Intervals
  // ============================================

  /**
   * Get detailed intervals for a specific workout
   */
  async getWorkoutIntervals(activityId: string): Promise<WorkoutIntervalsResponse> {
    try {
      return await this.intervals.getActivityIntervals(activityId);
    } catch (error) {
      console.error('Error fetching workout intervals:', error);
      throw error;
    }
  }
}
