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

// Normalized workout from any source
export interface NormalizedWorkout {
  id: string;
  start_time: string; // ISO 8601 (YYYY-MM-DDTHH:mm:ss±HH:mm) in user's local timezone
  activity_type?: ActivityType; // Optional for unavailable workouts (e.g., Strava-only)
  name?: string;
  description?: string;
  duration?: string; // Human-readable duration, e.g., "1:30:00"
  distance?: string; // Human-readable distance, e.g., "45.2 km" or "2500 m" for swimming
  tss?: number;
  normalized_power?: number;
  average_power?: number;
  average_heart_rate?: number;
  max_heart_rate?: number;
  intensity_factor?: number;
  elevation_gain?: string; // Human-readable, e.g., "500 m"
  calories?: number;
  source: 'intervals.icu' | 'whoop' | 'trainerroad' | 'strava';

  // Activity URLs
  /** Intervals.icu activity URL (always present for Intervals.icu activities) */
  intervals_icu_url?: string;
  /** Garmin Connect activity URL (only present if source is GARMIN_CONNECT and external_id exists) */
  garmin_connect_url?: string;
  /** Zwift activity URL (only present if source is ZWIFT and external_id exists) */
  zwift_url?: string;
  /** Strava activity URL (only present if strava_id exists) */
  strava_url?: string;

  /**
   * Indicates this workout's full data is unavailable via the API.
   * When true, only basic metadata (id, date, activity_type, name) is available.
   * Most other fields will be undefined or contain placeholder values.
   *
   * Common reasons:
   * - Strava-only workouts: Data exclusively from Strava cannot be accessed via Intervals.icu API
   */
  unavailable?: boolean;
  unavailable_reason?: string; // Human-readable reason why the workout is unavailable

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

  // Sweetspot
  ss_score?: number;

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
  lthr?: number; // Lactate threshold heart rate at time of activity

  // Energy expenditure
  work_kj?: number;
  cho_used_g?: number; // Carbohydrates used
  cho_intake_g?: number; // Carbohydrates consumed

  // Athlete metrics at time of activity
  weight?: string; // Human-readable, e.g., "74.5 kg"
  resting_hr?: number; // Resting heart rate at time of activity

  // Activity context flags
  is_indoor?: boolean; // trainer/indoor workout
  is_commute?: boolean;
  is_race?: boolean;

  // Threshold pace for this activity
  threshold_pace?: string; // Human-readable, e.g., "4:00/km"

  // Zone thresholds used for this activity (normalized with names and time in zone)
  hr_zones?: HRZone[];
  power_zones?: PowerZone[];
  pace_zones?: PaceZone[];
  heat_zones?: HeatZone[];

  // Heat metrics
  max_heat_strain_index?: number; // Maximum heat strain index during the activity
  median_heat_strain_index?: number; // Median heat strain index during the activity
  heat_training_load?: number; // Heat training load (0-10 scale), measures contribution to heat adaptation

  // Ambient temperature metrics (Celsius)
  min_ambient_temperature?: number;
  max_ambient_temperature?: number;
  median_ambient_temperature?: number;
  start_ambient_temperature?: number;
  end_ambient_temperature?: number;

  // Running/pace metrics
  average_stride_m?: number; // meters per stride
  gap?: string; // Gradient adjusted pace, e.g., "4:30/km"

  // Swimming metrics
  pool_length?: number; // Pool length in meters
  lengths?: number; // Number of lengths swam

  // Altitude
  average_altitude_m?: number;
  min_altitude_m?: number;
  max_altitude_m?: number;

  // Session metrics
  session_rpe?: number; // RPE × duration
  icu_strain_score?: number; // Intervals.icu strain score (XSS-like)

  // Notes
  notes?: WorkoutNote[]; // Notes/messages left by the athlete for this activity
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

// ============================================
// Whoop Data Types
// ============================================

/**
 * Body measurements from Whoop API.
 * All values in metric units as returned by Whoop.
 */
export interface WhoopBodyMeasurements {
  /** Height in meters, rounded to 2 decimals */
  height_meter: number;
  /** Weight in kilograms, rounded to 2 decimals */
  weight_kilogram: number;
  /** Maximum heart rate in BPM */
  max_heart_rate: number;
}

/**
 * Sleep summary data (renamed from Whoop's stage_summary).
 * All durations are humanized (e.g., "8:24:32").
 */
export interface WhoopSleepSummary {
  /** Total time in bed, humanized (e.g., "8:24:32") */
  total_in_bed_time: string;
  /** Total awake time during sleep, humanized */
  total_awake_time: string;
  /** Total time with no data, humanized */
  total_no_data_time: string;
  /** Total light sleep time, humanized */
  total_light_sleep_time: string;
  /** Total slow wave (deep) sleep time, humanized */
  total_slow_wave_sleep_time: string;
  /** Total REM sleep time, humanized */
  total_rem_sleep_time: string;
  /** Total restorative sleep (slow wave + REM), humanized */
  total_restorative_sleep: string;
  /** Number of sleep cycles completed */
  sleep_cycle_count: number;
  /** Number of disturbances during sleep */
  disturbance_count: number;
}

/**
 * Sleep need breakdown from Whoop.
 * All durations are humanized (e.g., "7:36:35").
 */
export interface WhoopSleepNeeded {
  /** Total sleep needed (computed sum), humanized */
  total_sleep_needed: string;
  /** Baseline sleep need, humanized */
  baseline: string;
  /** Additional need from accumulated sleep debt, humanized */
  need_from_sleep_debt: string;
  /** Additional need from recent strain, humanized */
  need_from_recent_strain: string;
  /** Reduction in need from recent naps (can be negative), humanized */
  need_from_recent_nap: string;
}

/**
 * Whoop sleep data (separated from recovery).
 */
export interface WhoopSleepData {
  /** Sleep summary with stage breakdown */
  sleep_summary: WhoopSleepSummary;
  /** Sleep need breakdown */
  sleep_needed: WhoopSleepNeeded;
  /** Respiratory rate in breaths per minute, rounded to 2 decimals */
  respiratory_rate?: number;
  /** Sleep performance vs. sleep need (0-100%), rounded to 2 decimals */
  sleep_performance_percentage: number;
  /** Sleep consistency score (0-100%), rounded to 2 decimals */
  sleep_consistency_percentage?: number;
  /** Sleep efficiency percentage (0-100%), rounded to 2 decimals */
  sleep_efficiency_percentage?: number;
  /** Sleep performance level: OPTIMAL (≥85%), SUFFICIENT (70-85%), POOR (<70%) */
  sleep_performance_level: 'OPTIMAL' | 'SUFFICIENT' | 'POOR';
  /** Human-readable sleep performance description from Whoop */
  sleep_performance_level_description: string;
  /** The approximate time the user fell asleep, in the user's local timezone */
  sleep_start?: string;
  /** The approximate time the user woke up, in the user's local timezone */
  sleep_end?: string;
}

/**
 * Whoop recovery data (separated from sleep).
 */
export interface WhoopRecoveryData {
  /** Recovery score (0-100%) */
  recovery_score: number;
  /** Recovery level: SUFFICIENT (≥67%), ADEQUATE (34-66%), LOW (<34%) */
  recovery_level: 'SUFFICIENT' | 'ADEQUATE' | 'LOW';
  /** Human-readable description from Whoop */
  recovery_level_description: string;
  /** Heart Rate Variability in milliseconds (RMSSD), rounded to 2 decimals */
  hrv_rmssd: number;
  /** Resting heart rate in BPM */
  resting_heart_rate: number;
  /** Blood oxygen saturation (0-100%), rounded to 2 decimals */
  spo2_percentage?: number;
  /** Skin temperature in Celsius, rounded to 2 decimals */
  skin_temp_celsius?: number;
}

/**
 * Combined sleep and recovery entry for a single day.
 * Used in recovery trends.
 */
export interface WhoopRecoveryTrendEntry {
  date: string;
  sleep: WhoopSleepData;
  recovery: WhoopRecoveryData;
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
  start_time: string; // ISO 8601 (YYYY-MM-DDTHH:mm:ss±HH:mm) in user's local timezone
  end_time: string; // ISO 8601 (YYYY-MM-DDTHH:mm:ss±HH:mm) in user's local timezone
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
  sport?: ActivityType;
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

// Heat zone with name and heat strain index range
export interface HeatZone {
  name: string;
  low_heat_strain_index: number;
  high_heat_strain_index: number | null; // null for highest zone (unbounded)
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
 * Base wellness fields shared between daily summary and trends.
 */
interface WellnessFields {
  weight?: string; // Weight with unit, e.g., "74.8 kg"

  // Heart rate and HRV
  resting_hr?: number;
  hrv?: number; // rMSSD in milliseconds
  hrv_sdnn?: number; // SDNN in milliseconds

  // Menstrual cycle
  menstrual_phase?: string;
  menstrual_phase_predicted?: string;

  // Nutrition
  kcal_consumed?: number;

  // Sleep
  sleep_duration?: string; // Human-readable, e.g., "8h 10m"
  sleep_score?: number;
  sleep_quality?: number; // 1=GREAT, 2=GOOD, 3=AVG, 4=POOR
  avg_sleeping_hr?: number;

  // Subjective metrics (1-4 scale)
  soreness?: number; // 1=LOW, 2=AVG, 3=HIGH, 4=EXTREME
  fatigue?: number; // 1=LOW, 2=AVG, 3=HIGH, 4=EXTREME
  stress?: number; // 1=LOW, 2=AVG, 3=HIGH, 4=EXTREME
  mood?: number; // 1=GREAT, 2=GOOD, 3=OK, 4=GRUMPY
  motivation?: number; // 1=EXTREME, 2=HIGH, 3=AVG, 4=LOW
  injury?: number; // 1=NONE, 2=NIGGLE, 3=POOR, 4=INJURED
  hydration?: number; // 1=GOOD, 2=OK, 3=POOR, 4=BAD

  // Vitals
  spo2?: number;
  blood_pressure?: { systolic: number; diastolic: number };
  hydration_volume?: number;
  respiration?: number;

  // Readiness and body composition
  readiness?: number;
  baevsky_si?: number;
  blood_glucose?: number;
  lactate?: number;
  body_fat?: number;
  abdomen?: number;
  vo2max?: number;

  // Activity and notes
  steps?: number;
  comments?: string;
}

/**
 * Daily wellness data from Intervals.icu.
 * Contains metrics like weight that are tracked over time.
 */
export interface DailyWellness extends WellnessFields {
  date: string;
}

/**
 * Current day's wellness data for daily summary.
 */
export interface WellnessData extends WellnessFields {}

/**
 * Wellness trends over a date range.
 */
export interface WellnessTrends {
  period_days: number;
  start_date: string;
  end_date: string;
  data: DailyWellness[];
}

/**
 * Fields that duplicate Whoop metrics and should be excluded when Whoop is connected.
 * Whoop provides more detailed versions of these metrics.
 */
const WHOOP_DUPLICATE_FIELDS: (keyof WellnessFields)[] = [
  'resting_hr',
  'hrv',
  'hrv_sdnn',
  'sleep_duration',
  'sleep_score',
  'sleep_quality',
  'avg_sleeping_hr',
  'readiness',
  'respiration',
  'spo2',
];

/**
 * Filter out wellness fields that duplicate Whoop metrics.
 * Used when Whoop is connected since Whoop provides more detailed data.
 */
export function filterWhoopDuplicateFields<T extends WellnessFields>(
  wellness: T | null
): T | null {
  if (!wellness) return null;

  const filtered = { ...wellness };
  for (const field of WHOOP_DUPLICATE_FIELDS) {
    delete filtered[field];
  }

  // Check if any fields remain (excluding 'date' for DailyWellness)
  const remainingKeys = Object.keys(filtered).filter((k) => k !== 'date');
  if (remainingKeys.length === 0) {
    return null;
  }

  return filtered;
}

/**
 * Filter Whoop-duplicate fields from wellness trends data.
 */
export function filterWhoopDuplicateFieldsFromTrends(
  trends: WellnessTrends
): WellnessTrends {
  const filteredData = trends.data
    .map((entry) => filterWhoopDuplicateFields(entry))
    .filter((entry): entry is DailyWellness => entry !== null);

  return {
    ...trends,
    data: filteredData,
  };
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
  average_gradient?: string; // Human-readable, e.g., "1.9%"

  // W'bal (anaerobic capacity)
  wbal_start_j?: number;
  wbal_end_j?: number;
  joules_above_ftp?: number;

  // Heat metrics (only present if heat strain data available)
  min_heat_strain_index?: number;
  max_heat_strain_index?: number;
  median_heat_strain_index?: number;
  start_heat_strain_index?: number;
  end_heat_strain_index?: number;

  // Ambient temperature metrics (Celsius)
  min_ambient_temperature?: number;
  max_ambient_temperature?: number;
  median_ambient_temperature?: number;
  start_ambient_temperature?: number;
  end_ambient_temperature?: number;
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
  author: string;
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
 * All Whoop data is nested under this object for clarity.
 */
export interface DailySummaryWhoop {
  /** Body measurements from Whoop, null if unavailable */
  body_measurements: WhoopBodyMeasurements | null;
  /** Today's Whoop strain data with insight fields, null if unavailable */
  strain: StrainData | null;
  /** Today's Whoop sleep data, null if unavailable */
  sleep: WhoopSleepData | null;
  /** Today's Whoop recovery data, null if unavailable */
  recovery: WhoopRecoveryData | null;
}

/**
 * Complete daily summary combining recovery, strain, and workout data.
 * Returned by get_daily_summary tool.
 *
 * Note: Whoop insight fields (recovery_level, strain_level, sleep_performance_level, etc.)
 * are included in the recovery and strain objects within the whoop property.
 */
export interface DailySummary {
  /** Current time in ISO 8601 format (YYYY-MM-DDTHH:mm:ss±HH:mm) in the user's local timezone */
  current_time: string;
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
// Today's Data with Timezone Context
// ============================================

/**
 * Whoop data for today's recovery response.
 */
export interface TodaysRecoveryWhoop {
  /** Today's Whoop sleep data, null if unavailable */
  sleep: WhoopSleepData | null;
  /** Today's Whoop recovery data, null if unavailable */
  recovery: WhoopRecoveryData | null;
}

/**
 * Today's recovery data with current time in user's timezone.
 * Returned by get_todays_recovery tool.
 */
export interface TodaysRecoveryResponse {
  /** Current time in ISO 8601 format (YYYY-MM-DDTHH:mm:ss±HH:mm) in the user's local timezone */
  current_time: string;
  /** Today's Whoop sleep and recovery data */
  whoop: TodaysRecoveryWhoop;
}

/**
 * Whoop data for today's strain response.
 */
export interface TodaysStrainWhoop {
  /** Today's Whoop strain data, null if unavailable */
  strain: StrainData | null;
}

/**
 * Today's strain data with current time in user's timezone.
 * Returned by get_todays_strain tool.
 */
export interface TodaysStrainResponse {
  /** Current time in ISO 8601 format (YYYY-MM-DDTHH:mm:ss±HH:mm) in the user's local timezone */
  current_time: string;
  /** Today's Whoop strain data */
  whoop: TodaysStrainWhoop;
}

/**
 * Today's completed workouts with current time in user's timezone.
 * Returned by get_todays_completed_workouts tool.
 */
export interface TodaysCompletedWorkoutsResponse {
  /** Current time in ISO 8601 format (YYYY-MM-DDTHH:mm:ss±HH:mm) in the user's local timezone */
  current_time: string;
  /** Completed workouts from Intervals.icu with matched Whoop data */
  workouts: WorkoutWithWhoop[];
}

/**
 * Today's planned workouts with current time in user's timezone.
 * Returned by get_todays_planned_workouts tool.
 */
export interface TodaysPlannedWorkoutsResponse {
  /** Current time in ISO 8601 format (YYYY-MM-DDTHH:mm:ss±HH:mm) in the user's local timezone */
  current_time: string;
  /** Planned workouts from TrainerRoad and Intervals.icu */
  workouts: PlannedWorkout[];
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
