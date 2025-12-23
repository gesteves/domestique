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
  duration_seconds: number;
  distance_km?: number;
  tss?: number;
  normalized_power?: number;
  average_power?: number;
  average_heart_rate?: number;
  max_heart_rate?: number;
  intensity_factor?: number;
  elevation_gain_m?: number;
  calories?: number;
  source: 'intervals.icu' | 'whoop' | 'trainerroad';

  // Speed metrics
  average_speed_kph?: number;
  max_speed_kph?: number;

  // Coasting metrics
  coasting_time_seconds?: number;
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
  gap?: number; // Gradient adjusted pace (sec/km)

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
  distance_meters?: number;
  altitude_gain_meters?: number;
  zone_durations?: WhoopZoneDurations;
  match_confidence: 'high' | 'medium' | 'low';
  match_method: 'timestamp' | 'date_and_type' | 'date_only';
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
  sleep_duration_hours: number;
  sleep_quality_duration_hours?: number;
  sleep_needed_hours?: number;
  // Sleep details
  light_sleep_hours?: number;
  slow_wave_sleep_hours?: number;
  rem_sleep_hours?: number;
  awake_hours?: number;
  in_bed_hours?: number;
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

// Whoop HR zone durations in minutes
export interface WhoopZoneDurations {
  zone_0_minutes: number; // Below zone 1
  zone_1_minutes: number; // 50-60% max HR
  zone_2_minutes: number; // 60-70% max HR
  zone_3_minutes: number; // 70-80% max HR
  zone_4_minutes: number; // 80-90% max HR
  zone_5_minutes: number; // 90-100% max HR
}

export interface StrainActivity {
  id: string;
  activity_type: ActivityType;
  start_time: string;
  end_time: string;
  strain_score: number;
  average_heart_rate?: number;
  max_heart_rate?: number;
  calories?: number;
  distance_meters?: number;
  altitude_gain_meters?: number;
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
  expected_duration_minutes?: number;
  duration_human?: string;
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
  match_confidence: 'high' | 'medium' | 'low';
  match_method: 'timestamp' | 'date_and_type' | 'date_only';
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
