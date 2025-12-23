/**
 * Field descriptions for MCP tool responses.
 * These are included in responses so the LLM knows what each field means and its units.
 */

export const WORKOUT_FIELD_DESCRIPTIONS = {
  // Core fields
  id: 'Unique activity identifier',
  date: 'Activity start time in local timezone (ISO 8601)',
  start_date_utc: 'Activity start time in UTC (ISO 8601 with Z suffix)',
  activity_type: 'Normalized type: Cycling, Running, Swimming, Skiing, Hiking, Rowing, Strength, or Other',
  name: 'Activity name/title',
  description: 'Activity description or notes',
  duration_seconds: 'Total moving time in seconds',
  distance_km: 'Total distance in kilometers',
  source: 'Data source: intervals.icu, whoop, or trainerroad',

  // Training load
  tss: 'Training Stress Score (TSS) - normalized training load (100 = 1 hour at FTP)',
  load: 'Training load (same as TSS for power-based activities)',
  intensity_factor: 'Intensity Factor (IF) - ratio of Normalized Power to FTP (as percentage, e.g., 75 = 0.75 IF)',
  trimp: 'Training Impulse - heart rate based training load',
  session_rpe: 'Session RPE = RPE × duration in minutes',
  strain_score: 'Intervals.icu strain score',

  // Power metrics
  normalized_power: 'Normalized Power (NP) in watts - accounts for variability',
  average_power: 'Average power in watts',
  ftp: 'Functional Threshold Power used for this activity in watts',
  eftp: 'Estimated FTP from Intervals.icu in watts',
  activity_eftp: 'eFTP derived from this specific activity in watts',
  w_prime: "W' (W prime) - anaerobic work capacity in joules",
  pmax: 'Maximum power capacity in watts',
  work_kj: 'Total work done in kilojoules',
  joules_above_ftp: 'Work done above FTP in joules',
  max_wbal_depletion: "Maximum W'bal depletion during activity (joules)",

  // Heart rate
  average_heart_rate: 'Average heart rate in beats per minute',
  max_heart_rate: 'Maximum heart rate in beats per minute',
  hrrc: 'Heart rate recovery - drop in HR in first minute after stopping',

  // Speed
  average_speed_kph: 'Average speed in kilometers per hour',
  max_speed_kph: 'Maximum speed in kilometers per hour',

  // Cadence
  average_cadence: 'Average cadence in RPM (cycling) or steps/min (running)',
  max_cadence: 'Maximum cadence in RPM or steps/min',

  // Efficiency
  variability_index: 'Variability Index (VI) - NP/Avg Power ratio. >1.05 indicates variable effort',
  power_hr_ratio: 'Power:HR decoupling - positive means cardiac drift occurred',
  efficiency_factor: 'Efficiency Factor (EF) - NP/Avg HR. Higher is more efficient',

  // Coasting
  coasting_time_seconds: 'Time spent coasting (not pedaling) in seconds',
  coasting_percentage: 'Percentage of ride time spent coasting',

  // Subjective
  rpe: 'Rate of Perceived Exertion (1-10 scale)',
  feel: 'How athlete felt (1-5 scale, 5 = great)',

  // Fitness snapshot
  ctl_at_activity: 'Chronic Training Load (CTL/fitness) at time of activity',
  atl_at_activity: 'Acute Training Load (ATL/fatigue) at time of activity',
  tsb_at_activity: 'Training Stress Balance (TSB/form) at time of activity. Positive = fresh, negative = fatigued',

  // Elevation
  elevation_gain_m: 'Total elevation gain in meters',
  average_altitude_m: 'Average altitude in meters',
  min_altitude_m: 'Minimum altitude in meters',
  max_altitude_m: 'Maximum altitude in meters',

  // Temperature
  average_temp_c: 'Average temperature in Celsius',
  min_temp_c: 'Minimum temperature in Celsius',
  max_temp_c: 'Maximum temperature in Celsius',

  // Energy
  calories: 'Estimated calories burned',
  cho_used_g: 'Estimated carbohydrates used in grams',
  cho_intake_g: 'Carbohydrates consumed during activity in grams',

  // Running specific
  average_stride_m: 'Average stride length in meters',
  gap: 'Gradient Adjusted Pace in seconds per kilometer - normalizes pace for hills',

  // Activity context
  is_indoor: 'Whether activity was on a trainer/treadmill/indoor',
  is_commute: 'Whether activity was marked as a commute',
  is_race: 'Whether activity was marked as a race',
  workout_class: 'Workout classification: Endurance, Tempo, Threshold, VO2max, etc.',

  // Zone thresholds
  hr_zones: 'Heart rate zone boundaries in BPM (array of 7 values)',
  power_zones: 'Power zone boundaries as percentage of FTP (array of 7 values)',
  pace_zones: 'Pace zone boundaries in seconds per km',

  // Time in zones
  power_zone_times: 'Array of {zone_id, seconds} - time spent in each power zone. Z1-Z7 plus SS (sweetspot)',
  hr_zone_times: 'Array of seconds spent in each HR zone (7 zones)',
  pace_zone_times: 'Array of seconds spent in each pace zone',

  // Polarization
  polarization_index: 'Training polarization index (0-2). Higher = more polarized (Z1 + Z5+ with little Z3-Z4)',

  // Device
  device_name: 'Recording device name (e.g., Garmin Edge, ZWIFT)',
  power_meter: 'Power meter used',

  // Counts
  intervals_count: 'Number of structured intervals in workout',
  laps_count: 'Number of laps/segments',
};

export const WHOOP_FIELD_DESCRIPTIONS = {
  // Strain activity
  strain_score: 'Whoop strain score (0-21 scale, logarithmic). 10-14 = moderate, 14-18 = high, 18+ = very high',
  average_heart_rate: 'Average heart rate in BPM',
  max_heart_rate: 'Maximum heart rate in BPM',
  calories: 'Estimated calories burned',
  distance_meters: 'Distance in meters',
  altitude_gain_meters: 'Elevation gain in meters',
  zone_durations: 'Object with zone_0_minutes through zone_5_minutes - time in each Whoop HR zone',
  match_confidence: 'How confidently this Whoop activity matched the Intervals workout: high (timestamp match), medium (date+type match), low (date only)',
  match_method: 'How the match was determined: timestamp, date_and_type, or date_only',
};

export const RECOVERY_FIELD_DESCRIPTIONS = {
  date: 'Date of recovery data (ISO 8601)',
  recovery_score: 'Whoop recovery score (0-100%). >67% green, 34-66% yellow, <34% red',
  resting_heart_rate: 'Resting heart rate in BPM',
  hrv_ms: 'Heart Rate Variability in milliseconds (RMSSD). Higher generally indicates better recovery',
  spo2_percentage: 'Blood oxygen saturation percentage',
  skin_temp_celsius: 'Skin temperature in Celsius',

  // Sleep metrics
  sleep_performance_percentage: 'Sleep performance vs. sleep need (0-100%)',
  sleep_duration_hours: 'Total sleep duration in hours',
  sleep_consistency_percentage: 'Sleep consistency score (0-100%)',
  sleep_efficiency_percentage: 'Sleep efficiency - time asleep / time in bed (0-100%)',
  respiratory_rate: 'Breaths per minute during sleep',
  light_sleep_hours: 'Time in light sleep in hours',
  slow_wave_sleep_hours: 'Time in deep/slow wave sleep in hours (most restorative)',
  rem_sleep_hours: 'Time in REM sleep in hours',
  awake_hours: 'Time awake during sleep period in hours',
  in_bed_hours: 'Total time in bed in hours',
  sleep_cycle_count: 'Number of complete sleep cycles',
  disturbance_count: 'Number of sleep disturbances',
};

export const FITNESS_FIELD_DESCRIPTIONS = {
  date: 'Date of fitness metrics (ISO 8601)',
  ctl: 'Chronic Training Load (fitness) - 42-day exponentially weighted average of daily TSS',
  atl: 'Acute Training Load (fatigue) - 7-day exponentially weighted average of daily TSS',
  tsb: 'Training Stress Balance (form) = CTL - ATL. Positive = fresh, negative = fatigued. -10 to +25 typical for optimal performance',
  ramp_rate: 'Rate of CTL change per week. Safe: 3-7 pts/week. Aggressive: 7+ pts/week. Injury risk increases above 10 pts/week',
  acwr: 'Acute:Chronic Workload Ratio = ATL/CTL. Optimal: 0.8-1.3. Caution: 1.3-1.5. High injury risk: >1.5',
  acwr_status: 'ACWR risk assessment: optimal, low_risk, caution, or high_risk',
};

export const PLANNED_WORKOUT_FIELD_DESCRIPTIONS = {
  id: 'Unique workout identifier',
  date: 'Scheduled date/time (ISO 8601)',
  name: 'Workout name',
  description: 'Workout description including structure',
  expected_tss: 'Expected Training Stress Score',
  expected_if: 'Expected Intensity Factor (as percentage)',
  expected_duration_minutes: 'Expected duration in minutes',
  duration_human: 'Human-readable duration (e.g., "1:30:00")',
  workout_type: 'Type of workout (Ride, Run, Swim, etc.)',
  source: 'Calendar source: intervals.icu or trainerroad',
};

export const ATHLETE_PROFILE_FIELD_DESCRIPTIONS = {
  athlete_id: 'Unique athlete identifier',
  name: 'Athlete name',
  weight_kg: 'Athlete weight in kilograms',
  primary_ftp: 'Primary FTP (Functional Threshold Power) in watts',
  primary_lthr: 'Primary LTHR (Lactate Threshold Heart Rate) in BPM',
  primary_max_hr: 'Primary maximum heart rate in BPM',

  // Sport settings
  sport_type: 'Sport type (Ride, Run, Swim, etc.)',
  ftp: 'Functional Threshold Power in watts',
  indoor_ftp: 'Indoor-specific FTP in watts (often higher than outdoor)',
  eftp: 'Estimated FTP from recent activities in watts',
  lthr: 'Lactate Threshold Heart Rate in BPM',
  max_hr: 'Maximum heart rate in BPM',
  resting_hr: 'Resting heart rate in BPM',
  threshold_pace: 'Threshold pace in seconds per km (running)',
  w_prime: "W' (W prime) anaerobic work capacity in joules",
  pmax: 'Maximum power capacity in watts',

  // Zones
  power_zones: 'Power zones as {zone_number, name, min_value, max_value} - values are watts',
  heart_rate_zones: 'HR zones as {zone_number, name, min_value, max_value} - values are BPM',
  pace_zones: 'Pace zones as {zone_number, name, min_value, max_value} - values are seconds/km',
};

export const POWER_CURVE_FIELD_DESCRIPTIONS = {
  sport: 'Sport type for this curve',
  period: 'Time period covered (42d, 90d, 1y, all)',
  athlete_ftp: 'Current FTP for context in watts',
  athlete_weight_kg: 'Athlete weight for W/kg calculations',

  // Curve data
  curve: 'Array of {duration_seconds, watts, watts_per_kg, date} points',
  duration_seconds: 'Duration of max effort in seconds',
  watts: 'Best power output at this duration in watts',
  watts_per_kg: 'Power-to-weight ratio in W/kg',

  // Key durations
  peak_5s: 'Best 5-second power in watts (neuromuscular)',
  peak_1min: 'Best 1-minute power in watts (anaerobic capacity)',
  peak_5min: 'Best 5-minute power in watts (VO2max)',
  peak_20min: 'Best 20-minute power in watts (threshold indicator)',
  peak_60min: 'Best 60-minute power in watts (true FTP)',
};

export const PACE_CURVE_FIELD_DESCRIPTIONS = {
  period: 'Time period covered (42d, 90d, 1y, all)',
  gradient_adjusted: 'Whether pace is gradient-adjusted (GAP)',

  // Curve data
  curve: 'Array of {duration_seconds, pace_per_km, speed_kph, date} points',
  duration_seconds: 'Duration of max effort in seconds',
  pace_per_km: 'Best pace at this duration in seconds per kilometer',
  speed_kph: 'Speed at this pace in km/h',

  // Key paces
  peak_400m_pace: 'Best ~1min effort pace in sec/km',
  peak_1km_pace: 'Best ~3min effort pace in sec/km',
  peak_5km_pace: 'Best ~20min effort pace in sec/km (threshold indicator)',
  peak_10km_pace: 'Best ~40min effort pace in sec/km',
  peak_half_marathon_pace: 'Best ~90min effort pace in sec/km',
};

type FieldCategory =
  | 'workout'
  | 'whoop'
  | 'recovery'
  | 'fitness'
  | 'planned'
  | 'athlete_profile'
  | 'power_curve'
  | 'pace_curve';

/**
 * Get descriptions for a specific category
 */
export function getFieldDescriptions(category: FieldCategory): Record<string, string> {
  switch (category) {
    case 'workout':
      return WORKOUT_FIELD_DESCRIPTIONS;
    case 'whoop':
      return WHOOP_FIELD_DESCRIPTIONS;
    case 'recovery':
      return RECOVERY_FIELD_DESCRIPTIONS;
    case 'fitness':
      return FITNESS_FIELD_DESCRIPTIONS;
    case 'planned':
      return PLANNED_WORKOUT_FIELD_DESCRIPTIONS;
    case 'athlete_profile':
      return ATHLETE_PROFILE_FIELD_DESCRIPTIONS;
    case 'power_curve':
      return POWER_CURVE_FIELD_DESCRIPTIONS;
    case 'pace_curve':
      return PACE_CURVE_FIELD_DESCRIPTIONS;
  }
}

/**
 * Combine field descriptions for a response that includes multiple types
 */
export function combineFieldDescriptions(
  ...categories: FieldCategory[]
): Record<string, string> {
  return categories.reduce(
    (acc, category) => ({ ...acc, ...getFieldDescriptions(category) }),
    {}
  );
}

