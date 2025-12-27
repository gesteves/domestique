import { IntervalsClient } from '../clients/intervals.js';
import { WhoopClient } from '../clients/whoop.js';
import { parseDateString, getToday, parseDateStringInTimezone, getTodayInTimezone } from '../utils/date-parser.js';
import { findMatchingWhoopActivity } from '../utils/activity-matcher.js';
import { parseDurationToHours } from '../utils/format-units.js';
import type {
  RecoveryData,
  TrainingLoadTrends,
  WorkoutWithWhoop,
  StrainActivity,
  NormalizedWorkout,
  WhoopMatchedData,
  WorkoutIntervalsResponse,
  WorkoutNotesResponse,
  PowerCurvesResponse,
  PowerBest,
  PowerCurveSummary,
  PowerCurveComparison,
  ActivityPowerCurve,
  PaceCurvesResponse,
  PaceBest,
  PaceCurveSummary,
  PaceCurveComparison,
  ActivityPaceCurve,
  HRCurvesResponse,
  HRBest,
  HRCurveSummary,
  HRCurveComparison,
  ActivityHRCurve,
  WellnessTrends,
} from '../types/index.js';
import type {
  GetWorkoutHistoryInput,
  GetRecoveryTrendsInput,
} from './types.js';
import type { HeatZone } from '../types/index.js';

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
    // Use athlete's timezone for date parsing
    const timezone = await this.intervals.getAthleteTimezone();
    const startDate = parseDateStringInTimezone(params.start_date, timezone, 'start_date');
    const endDate = params.end_date
      ? parseDateStringInTimezone(params.end_date, timezone, 'end_date')
      : getTodayInTimezone(timezone);

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
      distance: match.distance,
      elevation_gain: match.elevation_gain,
      zone_durations: match.zone_durations,
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

    // Use athlete's timezone for date parsing
    const timezone = await this.intervals.getAthleteTimezone();
    const startDate = parseDateStringInTimezone(params.start_date, timezone, 'start_date');
    const endDate = params.end_date
      ? parseDateStringInTimezone(params.end_date, timezone, 'end_date')
      : getTodayInTimezone(timezone);

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
    const sleepHours = data.map((d) => parseDurationToHours(d.sleep_duration));

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
  // Wellness Trends
  // ============================================

  /**
   * Get wellness trends (weight) over a date range
   */
  async getWellnessTrends(params: {
    start_date: string;
    end_date?: string;
  }): Promise<WellnessTrends> {
    // Use athlete's timezone for date parsing
    const timezone = await this.intervals.getAthleteTimezone();
    const startDate = parseDateStringInTimezone(params.start_date, timezone, 'start_date');
    const endDate = params.end_date
      ? parseDateStringInTimezone(params.end_date, timezone, 'end_date')
      : getTodayInTimezone(timezone);

    try {
      return await this.intervals.getWellnessTrends(startDate, endDate);
    } catch (error) {
      console.error('Error fetching wellness trends:', error);
      throw error;
    }
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

  // ============================================
  // Workout Notes
  // ============================================

  /**
   * Get notes/messages for a specific workout
   */
  async getWorkoutNotes(activityId: string): Promise<WorkoutNotesResponse> {
    try {
      return await this.intervals.getActivityNotes(activityId);
    } catch (error) {
      console.error('Error fetching workout notes:', error);
      throw error;
    }
  }

  // ============================================
  // Workout Weather
  // ============================================

  /**
   * Get weather summary for a specific workout.
   * Only relevant for outdoor activities.
   */
  async getWorkoutWeather(activityId: string): Promise<{ activity_id: string; weather_description: string | null }> {
    try {
      return await this.intervals.getActivityWeather(activityId);
    } catch (error) {
      console.error('Error fetching workout weather:', error);
      throw error;
    }
  }

  // ============================================
  // Heat Zones
  // ============================================

  /**
   * Get heat zones for a specific workout.
   * Returns null if heat strain data is not available for this activity.
   */
  async getWorkoutHeatZones(activityId: string): Promise<{ activity_id: string; heat_zones: HeatZone[] | null }> {
    try {
      const heatZones = await this.intervals.getActivityHeatZones(activityId);
      return {
        activity_id: activityId,
        heat_zones: heatZones,
      };
    } catch (error) {
      console.error('Error fetching workout heat zones:', error);
      throw error;
    }
  }

  // ============================================
  // Performance Curves
  // ============================================

  // Default durations for power and HR curves (in seconds)
  private readonly DEFAULT_POWER_DURATIONS = [5, 30, 60, 300, 1200, 3600, 7200];
  private readonly DEFAULT_HR_DURATIONS = [5, 30, 60, 300, 1200, 3600, 7200];

  // Default distances for pace curves (in meters)
  private readonly DEFAULT_RUNNING_DISTANCES = [400, 1000, 1609, 5000, 10000, 21097, 42195];
  private readonly DEFAULT_SWIMMING_DISTANCES = [100, 200, 400, 800, 1500, 1900, 3800];

  /**
   * Format duration in seconds to human-readable label
   */
  private formatDurationLabel(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      return `${mins}min`;
    }
    const hours = Math.floor(seconds / 3600);
    return `${hours}hr`;
  }

  /**
   * Format distance in meters to human-readable label
   */
  private formatDistanceLabel(meters: number): string {
    // Special labels for common distances (with fuzzy matching for API variations)
    if (meters >= 1600 && meters <= 1620) return 'mile';
    if (meters >= 21000 && meters <= 21200) return 'half_marathon';
    if (meters >= 42000 && meters <= 42300) return 'marathon';
    if (meters >= 1850 && meters <= 1950) return 'half_iron_swim';
    if (meters >= 3750 && meters <= 3850) return 'iron_swim';
    // Generic formatting
    if (meters >= 1000) {
      const km = meters / 1000;
      if (Number.isInteger(km)) return `${km}km`;
      return `${km.toFixed(1)}km`;
    }
    return `${meters}m`;
  }

  /**
   * Get power curves for cycling activities with summary statistics.
   * Analyzes best power at various durations (5s, 30s, 1min, 5min, 20min, 60min).
   * Optionally compare to a previous time period.
   */
  async getPowerCurve(params: {
    start_date: string;
    end_date?: string;
    durations?: number[];
    compare_to_start?: string;
    compare_to_end?: string;
  }): Promise<PowerCurvesResponse> {
    const timezone = await this.intervals.getAthleteTimezone();
    const startDate = parseDateStringInTimezone(params.start_date, timezone, 'start_date');
    const endDate = params.end_date
      ? parseDateStringInTimezone(params.end_date, timezone, 'end_date')
      : getTodayInTimezone(timezone);

    const durations = params.durations || this.DEFAULT_POWER_DURATIONS;

    try {
      // Fetch current period data
      const { durations: apiDurations, activities } = await this.intervals.getPowerCurves(
        startDate,
        endDate,
        'Ride', // Cycling only for power curves
        durations
      );

      // Calculate summary for key durations
      const summary = this.calculatePowerSummary(activities, apiDurations);

      const response: PowerCurvesResponse = {
        period_start: startDate,
        period_end: endDate,
        sport: 'cycling',
        activity_count: activities.length,
        durations_analyzed: apiDurations.map((d) => this.formatDurationLabel(d)),
        summary,
      };

      // If comparison period provided, calculate comparison
      if (params.compare_to_start && params.compare_to_end) {
        const compareStart = parseDateStringInTimezone(params.compare_to_start, timezone, 'compare_to_start');
        const compareEnd = parseDateStringInTimezone(params.compare_to_end, timezone, 'compare_to_end');

        const { durations: compareDurations, activities: compareActivities } =
          await this.intervals.getPowerCurves(
            compareStart,
            compareEnd,
            'Ride',
            durations
          );

        const compareSummary = this.calculatePowerSummary(compareActivities, compareDurations);

        response.comparison = {
          previous_period_start: compareStart,
          previous_period_end: compareEnd,
          previous_activity_count: compareActivities.length,
          changes: this.calculatePowerComparison(summary, compareSummary, apiDurations),
        };
      }

      return response;
    } catch (error) {
      console.error('Error fetching power curves:', error);
      throw error;
    }
  }

  /**
   * Calculate power curve summary - best values at key durations
   */
  private calculatePowerSummary(
    activities: ActivityPowerCurve[],
    durations: number[]
  ): PowerCurveSummary {
    const targetDurations: { [key: string]: number } = {
      best_5s: 5,
      best_30s: 30,
      best_1min: 60,
      best_5min: 300,
      best_20min: 1200,
      best_60min: 3600,
      best_2hr: 7200,
    };

    const bests: Partial<Record<keyof PowerCurveSummary, PowerBest | null>> = {};

    for (const [key, targetSecs] of Object.entries(targetDurations)) {
      const idx = durations.indexOf(targetSecs);
      if (idx === -1) {
        bests[key as keyof PowerCurveSummary] = null;
        continue;
      }

      let best: PowerBest | null = null;
      for (const activity of activities) {
        const point = activity.curve[idx];
        if (point && point.watts > 0 && (!best || point.watts > best.watts)) {
          best = {
            watts: point.watts,
            watts_per_kg: point.watts_per_kg,
            activity_id: activity.activity_id,
            date: activity.date,
          };
        }
      }
      bests[key as keyof PowerCurveSummary] = best;
    }

    // Estimate FTP as 95% of best 20min power
    const best20min = bests.best_20min as PowerBest | null;
    const estimatedFtp = best20min ? Math.round(best20min.watts * 0.95) : null;

    return {
      best_5s: bests.best_5s ?? null,
      best_30s: bests.best_30s ?? null,
      best_1min: bests.best_1min ?? null,
      best_5min: bests.best_5min ?? null,
      best_20min: bests.best_20min ?? null,
      best_60min: bests.best_60min ?? null,
      best_2hr: bests.best_2hr ?? null,
      estimated_ftp: estimatedFtp,
    } as PowerCurveSummary;
  }

  /**
   * Calculate power comparison between current and previous periods
   */
  private calculatePowerComparison(
    current: PowerCurveSummary,
    previous: PowerCurveSummary,
    durations: number[]
  ): PowerCurveComparison[] {
    const comparisons: PowerCurveComparison[] = [];

    const keys: (keyof PowerCurveSummary)[] = [
      'best_5s',
      'best_30s',
      'best_1min',
      'best_5min',
      'best_20min',
      'best_60min',
      'best_2hr',
    ];

    for (const key of keys) {
      const currentBest = current[key] as PowerBest | null;
      const previousBest = previous[key] as PowerBest | null;

      if (!currentBest || !previousBest) continue;

      const changeWatts = currentBest.watts - previousBest.watts;
      const changePercent =
        previousBest.watts > 0
          ? Math.round((changeWatts / previousBest.watts) * 1000) / 10
          : 0;

      comparisons.push({
        duration_label: key.replace('best_', ''),
        current_watts: currentBest.watts,
        previous_watts: previousBest.watts,
        change_watts: changeWatts,
        change_percent: changePercent,
        improved: changeWatts > 0,
      });
    }

    return comparisons;
  }

  /**
   * Get pace curves for running or swimming activities with summary statistics.
   * Analyzes best times at various distances.
   * Optionally compare to a previous time period.
   */
  async getPaceCurve(params: {
    start_date: string;
    end_date?: string;
    sport: 'running' | 'swimming';
    distances?: number[];
    gap?: boolean;
    compare_to_start?: string;
    compare_to_end?: string;
  }): Promise<PaceCurvesResponse> {
    const timezone = await this.intervals.getAthleteTimezone();
    const startDate = parseDateStringInTimezone(params.start_date, timezone, 'start_date');
    const endDate = params.end_date
      ? parseDateStringInTimezone(params.end_date, timezone, 'end_date')
      : getTodayInTimezone(timezone);

    const isSwimming = params.sport === 'swimming';
    const type = isSwimming ? 'Swim' : 'Run';
    const defaultDistances = isSwimming
      ? this.DEFAULT_SWIMMING_DISTANCES
      : this.DEFAULT_RUNNING_DISTANCES;
    const distances = params.distances || defaultDistances;

    try {
      // Fetch current period data
      const { distances: apiDistances, gap_adjusted, activities } =
        await this.intervals.getPaceCurves(
          startDate,
          endDate,
          type,
          distances,
          params.gap
        );

      // Calculate summary for key distances
      const summary = this.calculatePaceSummary(activities, apiDistances, isSwimming);

      const response: PaceCurvesResponse = {
        period_start: startDate,
        period_end: endDate,
        sport: params.sport,
        gap_adjusted,
        activity_count: activities.length,
        distances_analyzed: apiDistances.map((d) => this.formatDistanceLabel(d)),
        summary,
      };

      // If comparison period provided, calculate comparison
      if (params.compare_to_start && params.compare_to_end) {
        const compareStart = parseDateStringInTimezone(params.compare_to_start, timezone, 'compare_to_start');
        const compareEnd = parseDateStringInTimezone(params.compare_to_end, timezone, 'compare_to_end');

        const { distances: compareDistances, activities: compareActivities } =
          await this.intervals.getPaceCurves(
            compareStart,
            compareEnd,
            type,
            distances,
            params.gap
          );

        const compareSummary = this.calculatePaceSummary(
          compareActivities,
          compareDistances,
          isSwimming
        );

        response.comparison = {
          previous_period_start: compareStart,
          previous_period_end: compareEnd,
          previous_activity_count: compareActivities.length,
          changes: this.calculatePaceComparison(summary, compareSummary, isSwimming),
        };
      }

      return response;
    } catch (error) {
      console.error('Error fetching pace curves:', error);
      throw error;
    }
  }

  /**
   * Calculate pace curve summary - best values at key distances
   */
  private calculatePaceSummary(
    activities: ActivityPaceCurve[],
    distances: number[],
    isSwimming: boolean
  ): PaceCurveSummary {
    // Define target distances based on sport
    const targetDistances: { [key: string]: number } = isSwimming
      ? { best_100m: 100, best_200m: 200, best_1500m: 1500, best_half_iron_swim: 1900, best_iron_swim: 3800 }
      : { best_400m: 400, best_1km: 1000, best_mile: 1609, best_5km: 5000, best_10km: 10000, best_half_marathon: 21097, best_marathon: 42195 };

    // Only initialize fields relevant to the sport
    const bests: Partial<Record<keyof PaceCurveSummary, PaceBest | null>> = isSwimming
      ? {
          best_100m: null,
          best_200m: null,
          best_1500m: null,
          best_half_iron_swim: null,
          best_iron_swim: null,
        }
      : {
          best_400m: null,
          best_1km: null,
          best_mile: null,
          best_5km: null,
          best_10km: null,
          best_half_marathon: null,
          best_marathon: null,
        };

    for (const [key, targetMeters] of Object.entries(targetDistances)) {
      // Use fuzzy matching - API may return slightly different distances (e.g., 1600 vs 1609 for mile)
      const tolerance = targetMeters * 0.02; // 2% tolerance
      const idx = distances.findIndex((d) => Math.abs(d - targetMeters) <= tolerance);
      if (idx === -1) continue;

      let best: PaceBest | null = null;
      for (const activity of activities) {
        const point = activity.curve[idx];
        // For pace, lower time is better
        if (point && point.time_seconds > 0 && (!best || point.time_seconds < best.time_seconds)) {
          best = {
            time_seconds: point.time_seconds,
            pace: point.pace,
            activity_id: activity.activity_id,
            date: activity.date,
          };
        }
      }
      bests[key as keyof PaceCurveSummary] = best;
    }

    return bests as PaceCurveSummary;
  }

  /**
   * Calculate pace comparison between current and previous periods
   */
  private calculatePaceComparison(
    current: PaceCurveSummary,
    previous: PaceCurveSummary,
    isSwimming: boolean
  ): PaceCurveComparison[] {
    const comparisons: PaceCurveComparison[] = [];

    const keys: (keyof PaceCurveSummary)[] = isSwimming
      ? ['best_100m', 'best_200m', 'best_1500m', 'best_half_iron_swim', 'best_iron_swim']
      : ['best_400m', 'best_1km', 'best_mile', 'best_5km', 'best_10km', 'best_half_marathon', 'best_marathon'];

    for (const key of keys) {
      const currentBest = current[key];
      const previousBest = previous[key];

      if (!currentBest || !previousBest) continue;

      // Negative change means faster (improvement)
      const changeSeconds = currentBest.time_seconds - previousBest.time_seconds;
      const changePercent =
        previousBest.time_seconds > 0
          ? Math.round((changeSeconds / previousBest.time_seconds) * 1000) / 10
          : 0;

      comparisons.push({
        distance_label: key.replace('best_', ''),
        current_seconds: currentBest.time_seconds,
        previous_seconds: previousBest.time_seconds,
        change_seconds: changeSeconds,
        change_percent: changePercent,
        improved: changeSeconds < 0, // Faster is better for pace
      });
    }

    return comparisons;
  }

  /**
   * Get HR curves for activities with summary statistics.
   * Analyzes max sustained HR at various durations (5s, 30s, 1min, 5min, 20min, 60min).
   * Works for all sports.
   * Optionally compare to a previous time period.
   */
  async getHRCurve(params: {
    start_date: string;
    end_date?: string;
    sport?: 'cycling' | 'running' | 'swimming';
    durations?: number[];
    compare_to_start?: string;
    compare_to_end?: string;
  }): Promise<HRCurvesResponse> {
    const timezone = await this.intervals.getAthleteTimezone();
    const startDate = parseDateStringInTimezone(params.start_date, timezone, 'start_date');
    const endDate = params.end_date
      ? parseDateStringInTimezone(params.end_date, timezone, 'end_date')
      : getTodayInTimezone(timezone);

    const durations = params.durations || this.DEFAULT_HR_DURATIONS;

    // Map sport name to Intervals.icu type
    let type: string | undefined;
    if (params.sport === 'cycling') type = 'Ride';
    else if (params.sport === 'running') type = 'Run';
    else if (params.sport === 'swimming') type = 'Swim';

    try {
      // Fetch current period data
      const { durations: apiDurations, activities } = await this.intervals.getHRCurves(
        startDate,
        endDate,
        type,
        durations
      );

      // Calculate summary for key durations
      const summary = this.calculateHRSummary(activities, apiDurations);

      const response: HRCurvesResponse = {
        period_start: startDate,
        period_end: endDate,
        sport: params.sport || null,
        activity_count: activities.length,
        durations_analyzed: apiDurations.map((d) => this.formatDurationLabel(d)),
        summary,
      };

      // If comparison period provided, calculate comparison
      if (params.compare_to_start && params.compare_to_end) {
        const compareStart = parseDateStringInTimezone(params.compare_to_start, timezone, 'compare_to_start');
        const compareEnd = parseDateStringInTimezone(params.compare_to_end, timezone, 'compare_to_end');

        const { durations: compareDurations, activities: compareActivities } =
          await this.intervals.getHRCurves(compareStart, compareEnd, type, durations);

        const compareSummary = this.calculateHRSummary(compareActivities, compareDurations);

        response.comparison = {
          previous_period_start: compareStart,
          previous_period_end: compareEnd,
          previous_activity_count: compareActivities.length,
          changes: this.calculateHRComparison(summary, compareSummary),
        };
      }

      return response;
    } catch (error) {
      console.error('Error fetching HR curves:', error);
      throw error;
    }
  }

  /**
   * Calculate HR curve summary - max values at key durations
   */
  private calculateHRSummary(
    activities: ActivityHRCurve[],
    durations: number[]
  ): HRCurveSummary {
    const targetDurations: { [key: string]: number } = {
      max_5s: 5,
      max_30s: 30,
      max_1min: 60,
      max_5min: 300,
      max_20min: 1200,
      max_60min: 3600,
      max_2hr: 7200,
    };

    const bests: Partial<Record<keyof HRCurveSummary, HRBest | null>> = {};

    for (const [key, targetSecs] of Object.entries(targetDurations)) {
      const idx = durations.indexOf(targetSecs);
      if (idx === -1) {
        bests[key as keyof HRCurveSummary] = null;
        continue;
      }

      let best: HRBest | null = null;
      for (const activity of activities) {
        const point = activity.curve[idx];
        if (point && point.bpm > 0 && (!best || point.bpm > best.bpm)) {
          best = {
            bpm: point.bpm,
            activity_id: activity.activity_id,
            date: activity.date,
          };
        }
      }
      bests[key as keyof HRCurveSummary] = best;
    }

    return {
      max_5s: bests.max_5s ?? null,
      max_30s: bests.max_30s ?? null,
      max_1min: bests.max_1min ?? null,
      max_5min: bests.max_5min ?? null,
      max_20min: bests.max_20min ?? null,
      max_60min: bests.max_60min ?? null,
      max_2hr: bests.max_2hr ?? null,
    } as HRCurveSummary;
  }

  /**
   * Calculate HR comparison between current and previous periods
   */
  private calculateHRComparison(
    current: HRCurveSummary,
    previous: HRCurveSummary
  ): HRCurveComparison[] {
    const comparisons: HRCurveComparison[] = [];

    const keys: (keyof HRCurveSummary)[] = [
      'max_5s',
      'max_30s',
      'max_1min',
      'max_5min',
      'max_20min',
      'max_60min',
      'max_2hr',
    ];

    for (const key of keys) {
      const currentBest = current[key];
      const previousBest = previous[key];

      if (!currentBest || !previousBest) continue;

      const changeBpm = currentBest.bpm - previousBest.bpm;
      const changePercent =
        previousBest.bpm > 0
          ? Math.round((changeBpm / previousBest.bpm) * 1000) / 10
          : 0;

      comparisons.push({
        duration_label: key.replace('max_', ''),
        current_bpm: currentBest.bpm,
        previous_bpm: previousBest.bpm,
        change_bpm: changeBpm,
        change_percent: changePercent,
      });
    }

    return comparisons;
  }
}
