// Normalized activity types across platforms
export type ActivityType =
  | 'Cycling'
  | 'Running'
  | 'Swimming'
  | 'Skiing'
  | 'Hiking'
  | 'Rowing'
  | 'Strength'
  | 'Other';

// Training discipline for planned workouts
export type Discipline = 'Swim' | 'Bike' | 'Run';

// Normalized workout from any source
export interface NormalizedWorkout {
  id: string;
  date: string; // ISO 8601 local time
  start_date_utc?: string; // ISO 8601 UTC (with Z suffix) for cross-platform matching
  activity_type: ActivityType;
  name?: string;
  description?: string;
  duration: string; // Human-readable duration, e.g., "1:30:00"
  distance?: string; // Human-readable distance, e.g., "45.2 km" or "2500 m" for swimming
  tss?: number;
  normalized_power?: number;
  average_power?: number;
  average_heart_rate?: number;
  max_heart_rate?: number;
  intensity_factor?: number;
  elevation_gain?: string; // Human-readable, e.g., "500 m"
  calories?: number;
  source: 'intervals.icu' | 'whoop' | 'trainerroad';

  // Speed metrics
  average_speed?: string; // Human-readable speed, e.g., "32.5 km/h"
  max_speed?: string; // Human-readable max speed, e.g., "55.2 km/h"

  // Coasting metrics
  coasting_time?: string; // Human-readable, e.g., "0:05:30"
  coasting_percentage?: number;

  // Training load & subjective feel
  load?: number;
  rpe?: number; // Rate of Perceived Exertion (1-10)
  feel?: number; // How athlete felt (1-5)

  // Sweetspot & classification
  ss_score?: number;
  workout_class?: string; // Base, Tempo, Threshold, VO2max, etc.

  // HR metrics
  hrrc?: number; // Heart rate recovery
  trimp?: number; // Training Impulse

  // Power efficiency metrics
  variability_index?: number; // NP/Avg Power
  power_hr_ratio?: number; // Power to HR decoupling
  efficiency_factor?: number; // NP/Avg HR

  // Per-activity fitness snapshot
  ctl_at_activity?: number;
  atl_at_activity?: number;
  tsb_at_activity?: number;

  // Cadence
  average_cadence?: number;
  max_cadence?: number;

  // Threshold values used for activity
  ftp?: number;
  eftp?: number;
  activity_eftp?: number; // eFTP derived from this activity
  w_prime?: number; // Anaerobic work capacity
  pmax?: number; // Maximum power

  // Energy expenditure
  work_kj?: number;
  cho_used_g?: number; // Carbohydrates used
  cho_intake_g?: number; // Carbohydrates consumed

  // Intervals/laps summary
  intervals_count?: number;
  laps_count?: number;

  // Activity context flags
  is_indoor?: boolean; // trainer/indoor workout
  is_commute?: boolean;
  is_race?: boolean;

  // Zone thresholds used for this activity
  hr_zones?: number[]; // HR zone boundaries
  power_zones?: number[]; // Power zone boundaries (% of FTP)
  pace_zones?: number[]; // Pace zone boundaries

  // Time in zones (seconds)
  power_zone_times?: ZoneTime[];
  hr_zone_times?: number[]; // seconds per HR zone
  pace_zone_times?: number[]; // seconds per pace zone

  // Advanced power metrics
  joules_above_ftp?: number;
  max_wbal_depletion?: number; // W'bal depletion
  polarization_index?: number; // Training polarization (0-2)

  // Running/pace metrics
  average_stride_m?: number; // meters per stride
  gap?: string; // Gradient adjusted pace, e.g., "4:30/km"

  // Altitude
  average_altitude_m?: number;
  min_altitude_m?: number;
  max_altitude_m?: number;

  // Temperature
  average_temp_c?: number;
  min_temp_c?: number;
  max_temp_c?: number;

  // Session metrics
  session_rpe?: number; // RPE × duration
  strain_score?: number; // Intervals.icu strain score

  // Device info
  device_name?: string;
  power_meter?: string;
}

// Zone time entry for power zones
export interface ZoneTime {
  zone_id: string; // e.g., "Z1", "Z2", "SS" for sweetspot
  seconds: number;
}

/**
 * Whoop activity data matched to an Intervals.icu workout.
 *
 * IMPORTANT: Whoop uses proprietary algorithms for strain and recovery scores.
 * These values are specific to Whoop's methodology and may not be directly
 * comparable to other training load metrics like TSS.
 */
export interface WhoopMatchedData {
  strain_score: number;
  average_heart_rate?: number;
  max_heart_rate?: number;
  calories?: number;
  distance?: string; // Human-readable, e.g., "45.2 km"
  elevation_gain?: string; // Human-readable, e.g., "500 m"
  zone_durations?: WhoopZoneDurations;
}

/**
 * Extended workout with optional matched Whoop data.
 * The whoop field is null when Whoop is not configured or no match found.
 */
export interface WorkoutWithWhoop extends NormalizedWorkout {
  whoop: WhoopMatchedData | null;
}

// Whoop recovery data
export interface RecoveryData {
  date: string;
  // Recovery metrics
  recovery_score: number;
  hrv_rmssd: number;
  resting_heart_rate: number;
  spo2_percentage?: number;
  skin_temp_celsius?: number;
  // Sleep metrics
  sleep_performance_percentage: number;
  sleep_consistency_percentage?: number;
  sleep_efficiency_percentage?: number;
  // Sleep durations (human-readable, e.g., "7:12:40")
  sleep_duration: string;
  sleep_quality_duration?: string; // Deep + REM sleep
  sleep_needed?: string;
  // Sleep stage breakdown (human-readable)
  light_sleep?: string;
  slow_wave_sleep?: string;
  rem_sleep?: string;
  awake_time?: string;
  in_bed_time?: string;
  // Sleep details
  sleep_cycle_count?: number;
  disturbance_count?: number;
  respiratory_rate?: number;
}

// Whoop strain data
export interface StrainData {
  date: string;
  strain_score: number;
  average_heart_rate?: number;
  max_heart_rate?: number;
  calories?: number;
  activities: StrainActivity[];
}

// Whoop HR zone durations (human-readable, e.g., "0:05:30")
export interface WhoopZoneDurations {
  zone_0: string; // Below zone 1
  zone_1: string; // 50-60% max HR
  zone_2: string; // 60-70% max HR
  zone_3: string; // 70-80% max HR
  zone_4: string; // 80-90% max HR
  zone_5: string; // 90-100% max HR
}

export interface StrainActivity {
  id: string;
  activity_type: ActivityType;
  start_time: string;
  end_time: string;
  duration: string; // Human-readable, e.g., "1:30:00"
  strain_score: number;
  average_heart_rate?: number;
  max_heart_rate?: number;
  calories?: number;
  distance?: string; // Human-readable, e.g., "45.2 km"
  elevation_gain?: string; // Human-readable, e.g., "500 m"
  zone_durations?: WhoopZoneDurations;
}

// Planned workout from calendar
export interface PlannedWorkout {
  id: string;
  date: string;
  name: string;
  description?: string;
  expected_tss?: number;
  expected_if?: number;
  expected_duration?: string; // Human-readable, e.g., "1:30:00"
  discipline?: Discipline;
  workout_type?: string;
  intervals?: string;
  source: 'intervals.icu' | 'trainerroad';
}

// Fitness metrics from Intervals.icu
export interface FitnessMetrics {
  date: string;
  ctl: number; // Chronic Training Load (fitness)
  atl: number; // Acute Training Load (fatigue)
  tsb: number; // Training Stress Balance (form)
  ramp_rate?: number;
}

// Activity matching result
export interface MatchedActivity {
  intervals_workout?: NormalizedWorkout;
  whoop_activity?: StrainActivity;
}

// API client configuration
export interface IntervalsConfig {
  apiKey: string;
  athleteId: string;
}

export interface WhoopConfig {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

export interface TrainerRoadConfig {
  calendarUrl: string;
}

// Date range for queries
export interface DateRange {
  start: string; // ISO date
  end: string; // ISO date
}

// ============================================
// Athlete Profile
// ============================================

// Heart rate zone with name and range
export interface HRZone {
  name: string;
  low_bpm: number;
  high_bpm: number | null; // null for highest zone (unbounded)
}

// Power zone with name, percentages, and absolute values
export interface PowerZone {
  name: string;
  low_percent: number;
  high_percent: number | null; // null for highest zone (unbounded)
  low_watts: number;
  high_watts: number | null;
}

// Pace zone with name, percentages, values, and human-readable format
// Note: low_percent corresponds to slow pace, high_percent to fast pace
// (higher % = faster = less time per unit distance)
export interface PaceZone {
  name: string;
  low_percent: number;
  high_percent: number | null;
  slow_pace: number | null; // slower boundary (more time) - null if unbounded slow
  fast_pace: number | null; // faster boundary (less time) - null if unbounded fast
  slow_pace_human: string | null; // e.g., "5:30/km" or null if unbounded
  fast_pace_human: string | null; // e.g., "4:30/km" or null if unbounded
}

// Sport-specific settings
export interface SportSettings {
  types: string[]; // Activity types this applies to (e.g., ["Ride", "VirtualRide"])

  // Power thresholds
  ftp?: number;
  indoor_ftp?: number; // Only included if different from ftp

  // Heart rate thresholds
  lthr?: number;
  max_hr?: number;

  // HR zones (merged with names)
  hr_zones?: HRZone[];

  // Pace thresholds
  threshold_pace?: number;
  threshold_pace_human?: string; // e.g., "4:00/km" or "1:30/100m"
  pace_units?: string;

  // Power zones (merged with names and values)
  power_zones?: PowerZone[];
  indoor_power_zones?: PowerZone[]; // Only if indoor_ftp differs

  // Pace zones
  pace_zones?: PaceZone[];
}

// Complete athlete profile
export interface AthleteProfile {
  id: string;
  name?: string;
  city?: string;
  state?: string;
  country?: string;
  timezone?: string;
  sex?: string;
  sports: SportSettings[];
}

// ============================================
// Training Load Trends
// ============================================

export interface DailyTrainingLoad {
  date: string;
  ctl: number; // Chronic Training Load (fitness)
  atl: number; // Acute Training Load (fatigue)
  tsb: number; // Training Stress Balance (form)
  ramp_rate?: number; // Weekly CTL change rate
  daily_tss?: number; // That day's training stress
}

export type CTLTrend = 'increasing' | 'stable' | 'decreasing';
export type ACWRStatus = 'low_risk' | 'optimal' | 'caution' | 'high_risk';

export interface TrainingLoadSummary {
  current_ctl: number;
  current_atl: number;
  current_tsb: number;
  ctl_trend: CTLTrend;
  avg_ramp_rate: number;
  peak_ctl: number;
  peak_ctl_date: string;
  // Acute:Chronic Workload Ratio for injury risk (ideally 0.8-1.3)
  acwr: number;
  acwr_status: ACWRStatus;
}

export interface TrainingLoadTrends {
  period_days: number;
  sport: string;
  data: DailyTrainingLoad[];
  summary: TrainingLoadSummary;
}

// ============================================
// Workout Intervals
// ============================================

export interface WorkoutInterval {
  type: 'WORK' | 'RECOVERY';
  label?: string;
  group_id?: string;
  start_seconds: number; // Position marker - kept as number
  duration: string; // Human-readable, e.g., "0:00:56"
  distance?: string; // Human-readable, e.g., "1.2 km"

  // Power metrics
  average_watts?: number;
  max_watts?: number;
  normalized_power?: number;
  watts_per_kg?: number;
  power_zone?: number;
  intensity_factor?: number;
  interval_tss?: number;

  // Heart rate
  average_hr?: number;
  max_hr?: number;
  hr_decoupling?: number;

  // Cadence/stride
  average_cadence?: number;
  stride_length_m?: number;

  // Speed
  average_speed?: string; // Human-readable, e.g., "32.5 km/h"

  // Elevation
  elevation_gain?: string; // Human-readable, e.g., "45 m"
  average_gradient_pct?: number;

  // W'bal (anaerobic capacity)
  wbal_start_j?: number;
  wbal_end_j?: number;
  joules_above_ftp?: number;
}

export interface IntervalGroup {
  id: string; // e.g., "56s@314w91rpm" - human-readable summary
  count: number;
  average_watts?: number;
  average_hr?: number;
  average_cadence?: number;
  average_speed?: string; // Human-readable, e.g., "32.5 km/h"
  distance?: string; // Human-readable, e.g., "1.2 km"
  duration?: string; // Human-readable, e.g., "0:00:56"
  elevation_gain?: string; // Human-readable, e.g., "45 m"
}

export interface WorkoutIntervalsResponse {
  activity_id: string;
  intervals: WorkoutInterval[];
  groups: IntervalGroup[];
}

// Workout note/message from the athlete
export interface WorkoutNote {
  id: number;
  athlete_id: string;
  name: string;
  created: string;
  type: string;
  content: string;
  attachment_url?: string;
  attachment_mime_type?: string;
}

export interface WorkoutNotesResponse {
  activity_id: string;
  notes: WorkoutNote[];
}

// ============================================
// Daily Summary
// ============================================

// Re-export insight types from whoop-insights for convenience
export type {
  RecoveryLevel,
  StrainLevel,
  SleepPerformanceLevel,
  RecoveryInsights,
  StrainInsights,
} from '../utils/whoop-insights.js';

/**
 * Daily insights with pre-computed Whoop interpretations.
 * Uses Whoop's official terminology for recovery and strain levels.
 */
export interface DailyInsights {
  // Whoop-specific interpretations (using Whoop's official terminology)
  /** Recovery level: SUFFICIENT (≥67%), ADEQUATE (34-66%), LOW (<34%) */
  recovery_level: 'SUFFICIENT' | 'ADEQUATE' | 'LOW' | null;
  /** Human-readable description from Whoop */
  recovery_level_description: string | null;
  /** Strain level: LIGHT (0-9), MODERATE (10-13), HIGH (14-17), ALL_OUT (18-21) */
  strain_level: 'LIGHT' | 'MODERATE' | 'HIGH' | 'ALL_OUT' | null;
  /** Human-readable description from Whoop */
  strain_level_description: string | null;
  /** Sleep performance level: OPTIMAL (≥85%), SUFFICIENT (70-85%), POOR (<70%) */
  sleep_performance_level: 'OPTIMAL' | 'SUFFICIENT' | 'POOR' | null;
  /** Human-readable sleep performance description from Whoop */
  sleep_performance_level_description: string | null;
  /** Sleep duration, e.g., "7:12:40" */
  sleep_duration: string | null;

  // Summary stats
  /** Number of workouts completed today */
  workouts_completed: number;
  /** Number of planned workouts remaining */
  workouts_remaining: number;
  /** Total TSS from completed workouts */
  tss_completed: number;
  /** Total TSS from planned workouts */
  tss_planned: number;
}

/**
 * Complete daily summary combining recovery, strain, and workout data.
 * Returned by get_daily_summary tool.
 */
export interface DailySummary {
  /** Date in ISO 8601 format */
  date: string;
  /** Today's Whoop recovery data, null if unavailable */
  recovery: RecoveryData | null;
  /** Today's Whoop strain data, null if unavailable */
  strain: StrainData | null;
  /** Completed workouts from Intervals.icu with matched Whoop data */
  completed_workouts: WorkoutWithWhoop[];
  /** Planned workouts from TrainerRoad and Intervals.icu */
  planned_workouts: PlannedWorkout[];
  /** Pre-computed insights for LLM consumption */
  insights: DailyInsights;
}
