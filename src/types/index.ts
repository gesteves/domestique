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

  // Threshold pace for this activity
  threshold_pace?: string; // Human-readable, e.g., "4:00/km"
  pace_units?: string; // "MINS_KM", "SECS_100M", etc.

  // Zone thresholds used for this activity (normalized with names and time in zone)
  hr_zones?: HRZone[];
  power_zones?: PowerZone[];
  pace_zones?: PaceZone[];

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
  // Recovery level interpretation (Whoop's official terminology)
  /** Recovery level: SUFFICIENT (≥67%), ADEQUATE (34-66%), LOW (<34%) */
  recovery_level: 'SUFFICIENT' | 'ADEQUATE' | 'LOW';
  /** Human-readable description from Whoop */
  recovery_level_description: string;
  // Sleep metrics
  sleep_performance_percentage: number;
  sleep_consistency_percentage?: number;
  sleep_efficiency_percentage?: number;
  /** Sleep performance level: OPTIMAL (≥85%), SUFFICIENT (70-85%), POOR (<70%) */
  sleep_performance_level: 'OPTIMAL' | 'SUFFICIENT' | 'POOR';
  /** Human-readable sleep performance description from Whoop */
  sleep_performance_level_description: string;
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
  /** Strain level: LIGHT (0-9), MODERATE (10-13), HIGH (14-17), ALL_OUT (18-21) */
  strain_level: 'LIGHT' | 'MODERATE' | 'HIGH' | 'ALL_OUT';
  /** Human-readable description from Whoop */
  strain_level_description: string;
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
  source: 'intervals.icu' | 'trainerroad' | 'zwift';
}

// Fitness metrics from Intervals.icu
export interface FitnessMetrics {
  date: string;
  ctl: number; // Chronic Training Load (fitness)
  atl: number; // Acute Training Load (fatigue)
  tsb: number; // Training Stress Balance (form)
  ramp_rate?: number;
  ctl_load?: number; // Weighted contribution to CTL from this day's training
  atl_load?: number; // Weighted contribution to ATL from this day's training
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

// Unit preferences for displaying data to the user
export type UnitSystem = 'metric' | 'imperial';
export type WeightUnit = 'kg' | 'lb';
export type TemperatureUnit = 'celsius' | 'fahrenheit';

/**
 * User's preferred unit system for displaying data.
 * IMPORTANT: The LLM MUST use these units when responding to the user.
 */
export interface UnitPreferences {
  /** Base unit system: "metric" or "imperial". Use metric units (km, m, kg, celsius) or imperial (mi, ft, lb, fahrenheit). */
  system: UnitSystem;
  /** Weight unit override: "kg" or "lb". May differ from system preference. */
  weight: WeightUnit;
  /** Temperature unit override: "celsius" or "fahrenheit". May differ from system preference. */
  temperature: TemperatureUnit;
}

// Heart rate zone with name and range
export interface HRZone {
  name: string;
  low_bpm: number;
  high_bpm: number | null; // null for highest zone (unbounded)
  time_in_zone?: string; // Human-readable duration, e.g., "1:49:44" (only for completed workouts)
}

// Power zone with name, percentages, and absolute values
export interface PowerZone {
  name: string;
  low_percent: number;
  high_percent: number | null; // null for highest zone (unbounded)
  low_watts: number;
  high_watts: number | null;
  time_in_zone?: string; // Human-readable duration, e.g., "1:49:44" (only for completed workouts)
}

// Pace zone with name, percentages, and human-readable format
// Note: low_percent corresponds to slow pace, high_percent to fast pace
// (higher % = faster = less time per unit distance)
export interface PaceZone {
  name: string;
  low_percent: number;
  high_percent: number | null;
  slow_pace: string | null; // e.g., "5:30/km" or null if unbounded
  fast_pace: string | null; // e.g., "4:30/km" or null if unbounded
  time_in_zone?: string; // Human-readable duration, e.g., "1:49:44" (only for completed workouts)
}

// Sport-specific settings
export interface SportSettings {
  types: string[]; // Activity types this applies to (e.g., ["Ride", "VirtualRide"])

  // Power thresholds
  ftp?: number;
  indoor_ftp?: number; // Only included if different from ftp
  sweet_spot_min?: number; // Sweet spot lower bound (% of FTP)
  sweet_spot_max?: number; // Sweet spot upper bound (% of FTP)

  // Heart rate thresholds
  lthr?: number;
  max_hr?: number;

  // HR zones (merged with names)
  hr_zones?: HRZone[];

  // Pace thresholds
  threshold_pace?: string; // e.g., "4:00/km" or "1:30/100m"
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
  /** Date of birth in ISO format (YYYY-MM-DD). Only present if set in Intervals.icu. */
  date_of_birth?: string;
  /** Current age in years. Only present if date_of_birth is set. */
  age?: number;
  /**
   * User's preferred unit system for displaying data.
   * CRITICAL: The LLM MUST use these units when responding to the user.
   */
  unit_preferences: UnitPreferences;
}

// Sport settings response for get_sports_settings tool
export interface SportSettingsResponse {
  /** The sport queried (e.g., "cycling", "running", "swimming") */
  sport: string;
  /** Activity types this sport setting applies to (e.g., ["Ride", "VirtualRide"]) */
  types: string[];
  /** The sport-specific settings */
  settings: SportSettings;
  /**
   * User's preferred unit system for displaying data.
   * CRITICAL: The LLM MUST use these units when responding to the user.
   */
  unit_preferences: UnitPreferences;
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
  ctl_load?: number; // Weighted contribution to CTL from this day's training
  atl_load?: number; // Weighted contribution to ATL from this day's training
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
// Wellness Data
// ============================================

/**
 * Daily wellness data from Intervals.icu.
 * Contains metrics like weight that are tracked over time.
 */
export interface DailyWellness {
  date: string;
  weight?: string; // Weight with unit, e.g., "74.8 kg"
}

/**
 * Current day's wellness data for daily summary.
 */
export interface WellnessData {
  weight?: string; // Weight with unit, e.g., "74.8 kg"
}

/**
 * Wellness trends over a date range.
 */
export interface WellnessTrends {
  period_days: number;
  start_date: string;
  end_date: string;
  data: DailyWellness[];
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

/**
 * Whoop data for the daily summary.
 */
export interface DailySummaryWhoop {
  /** Today's Whoop recovery data with insight fields, null if unavailable */
  recovery: RecoveryData | null;
  /** Today's Whoop strain data with insight fields, null if unavailable */
  strain: StrainData | null;
}

/**
 * Complete daily summary combining recovery, strain, and workout data.
 * Returned by get_daily_summary tool.
 *
 * Note: Whoop insight fields (recovery_level, strain_level, sleep_performance_level, etc.)
 * are included in the recovery and strain objects within the whoop property.
 */
export interface DailySummary {
  /** Date in ISO 8601 format */
  date: string;
  /** Today's Whoop recovery and strain data */
  whoop: DailySummaryWhoop;
  /** Today's fitness metrics (CTL/ATL/TSB) from Intervals.icu, null if unavailable */
  fitness: FitnessMetrics | null;
  /** Today's wellness data (weight, etc.) from Intervals.icu, null if unavailable */
  wellness: WellnessData | null;
  /** Completed workouts from Intervals.icu with matched Whoop data */
  completed_workouts: WorkoutWithWhoop[];
  /** Planned workouts from TrainerRoad and Intervals.icu */
  planned_workouts: PlannedWorkout[];
  /** Number of workouts completed today */
  workouts_completed: number;
  /** Number of workouts planned for today */
  workouts_planned: number;
  /** Total TSS from completed workouts */
  tss_completed: number;
  /** Total TSS from planned workouts */
  tss_planned: number;
}

// ============================================
// Performance Curves
// ============================================

// Power curve data point for a specific duration
export interface PowerCurvePoint {
  duration_seconds: number;
  duration_label: string; // e.g., "5s", "1min", "5min", "20min"
  watts: number;
  watts_per_kg: number;
}

// Per-activity power curve
export interface ActivityPowerCurve {
  activity_id: string;
  date: string;
  weight_kg: number;
  curve: PowerCurvePoint[];
}

// Best value at a specific duration
export interface PowerBest {
  watts: number;
  watts_per_kg: number;
  activity_id: string;
  date: string;
}

// Summary statistics for power curves - key durations
export interface PowerCurveSummary {
  best_5s: PowerBest | null;
  best_30s: PowerBest | null;
  best_1min: PowerBest | null;
  best_5min: PowerBest | null;
  best_20min: PowerBest | null;
  best_60min: PowerBest | null;
  best_2hr: PowerBest | null;
  estimated_ftp: number | null; // 95% of best 20min
}

// Comparison between two periods for power curves
export interface PowerCurveComparison {
  duration_label: string;
  current_watts: number;
  previous_watts: number;
  change_watts: number;
  change_percent: number;
  improved: boolean;
}

// Full power curves response
export interface PowerCurvesResponse {
  period_start: string;
  period_end: string;
  sport: string;
  activity_count: number;
  durations_analyzed: string[]; // Human-readable labels
  summary: PowerCurveSummary;
  // Comparison data (only present when compare_to_* params used)
  comparison?: {
    previous_period_start: string;
    previous_period_end: string;
    previous_activity_count: number;
    changes: PowerCurveComparison[];
  };
}

// Pace curve data point for a specific distance
export interface PaceCurvePoint {
  distance_meters: number;
  distance_label: string; // e.g., "400m", "1km", "5km"
  time_seconds: number;
  pace: string; // Human-readable: "4:30/km" or "1:45/100m"
}

// Per-activity pace curve
export interface ActivityPaceCurve {
  activity_id: string;
  date: string;
  weight_kg: number;
  curve: PaceCurvePoint[];
}

// Best value at a specific distance
export interface PaceBest {
  time_seconds: number;
  pace: string;
  activity_id: string;
  date: string;
}

// Summary statistics for pace curves - key distances
export interface PaceCurveSummary {
  // Running-specific
  best_400m: PaceBest | null;
  best_1km: PaceBest | null;
  best_mile: PaceBest | null;
  best_5km: PaceBest | null;
  best_10km: PaceBest | null;
  best_half_marathon: PaceBest | null;
  best_marathon: PaceBest | null;
  // Swimming-specific
  best_100m: PaceBest | null;
  best_200m: PaceBest | null;
  best_1500m: PaceBest | null;
  best_half_iron_swim: PaceBest | null;
  best_iron_swim: PaceBest | null;
}

// Comparison between two periods for pace curves
export interface PaceCurveComparison {
  distance_label: string;
  current_seconds: number;
  previous_seconds: number;
  change_seconds: number;
  change_percent: number;
  improved: boolean; // For pace, improved = faster = lower time
}

// Full pace curves response
export interface PaceCurvesResponse {
  period_start: string;
  period_end: string;
  sport: string;
  gap_adjusted: boolean;
  activity_count: number;
  distances_analyzed: string[];
  summary: PaceCurveSummary;
  // Comparison data (only present when compare_to_* params used)
  comparison?: {
    previous_period_start: string;
    previous_period_end: string;
    previous_activity_count: number;
    changes: PaceCurveComparison[];
  };
}

// HR curve data point for a specific duration
export interface HRCurvePoint {
  duration_seconds: number;
  duration_label: string;
  bpm: number;
}

// Per-activity HR curve
export interface ActivityHRCurve {
  activity_id: string;
  date: string;
  curve: HRCurvePoint[];
}

// Best value at a specific duration
export interface HRBest {
  bpm: number;
  activity_id: string;
  date: string;
}

// Summary statistics for HR curves - key durations
export interface HRCurveSummary {
  max_5s: HRBest | null;
  max_30s: HRBest | null;
  max_1min: HRBest | null;
  max_5min: HRBest | null;
  max_20min: HRBest | null;
  max_60min: HRBest | null;
  max_2hr: HRBest | null;
}

// Comparison between two periods for HR curves
export interface HRCurveComparison {
  duration_label: string;
  current_bpm: number;
  previous_bpm: number;
  change_bpm: number;
  change_percent: number;
}

// Full HR curves response
export interface HRCurvesResponse {
  period_start: string;
  period_end: string;
  sport: string | null;
  activity_count: number;
  durations_analyzed: string[];
  summary: HRCurveSummary;
  // Comparison data (only present when compare_to_* params used)
  comparison?: {
    previous_period_start: string;
    previous_period_end: string;
    previous_activity_count: number;
    changes: HRCurveComparison[];
  };
}
