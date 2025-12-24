/**
 * Field descriptions for MCP tool responses.
 * These are included in responses so the LLM knows what each field means and its units.
 */

export const WORKOUT_FIELD_DESCRIPTIONS = {
  // Core fields
  id: 'Unique identifier of the completed activity in Intervals.icu',
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
  feel: 'How athlete felt (1-5 scale, 1 = strong, 2 = good, 3 = normal, 4 = poor, 5 = weak)',

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
  // Data array (sorted oldest to newest)
  data: 'Array of daily training load metrics, sorted oldest to newest (first item = oldest day)',
  date: 'Date of fitness metrics (ISO 8601 YYYY-MM-DD)',
  ctl: 'Chronic Training Load (fitness) - 42-day exponentially weighted average of daily TSS',
  atl: 'Acute Training Load (fatigue) - 7-day exponentially weighted average of daily TSS',
  tsb: 'Training Stress Balance (form) = CTL - ATL. Positive = fresh, negative = fatigued. -10 to +25 typical for optimal performance',
  ramp_rate: 'Rate of CTL change per week. Safe: 3-7 pts/week. Aggressive: 7+ pts/week. Injury risk increases above 10 pts/week',
  daily_tss: 'Training Stress Score for that specific day',

  // Summary fields
  current_ctl: 'Most recent CTL value (current fitness level)',
  current_atl: 'Most recent ATL value (current fatigue level)',
  current_tsb: 'Most recent TSB value (current form)',
  ctl_trend: 'CTL trend direction: increasing, stable, or decreasing',
  avg_ramp_rate: 'Average weekly CTL change rate over the period',
  peak_ctl: 'Highest CTL reached during the period',
  peak_ctl_date: 'Date when peak CTL was reached',
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
  // Athlete info
  id: 'Unique identifier of the athlete in Intervals.icu',
  name: 'Athlete name',
  city: 'City of residence',
  state: 'State/province of residence',
  country: 'Country of residence',
  timezone: 'Athlete timezone (e.g., "America/New_York")',
  sex: 'Athlete sex (M or F)',

  // Sport settings
  sports: 'Array of sport-specific settings for each activity type the athlete trains',
  types: 'Activity types this sport setting applies to (e.g., ["Ride", "VirtualRide", "GravelRide"])',

  // Power thresholds
  ftp: 'Functional Threshold Power in watts',
  indoor_ftp: 'Indoor-specific FTP in watts (only shown if different from outdoor FTP)',

  // Heart rate thresholds
  lthr: 'Lactate Threshold Heart Rate in BPM - HR at threshold effort',
  max_hr: 'Maximum heart rate in BPM',

  // HR zones
  hr_zones: 'Heart rate zones as array of {name, low_bpm, high_bpm}. Sorted low to high (Zone 1 first). Note that these may be different than the Whoop HR zones.',

  // Pace thresholds
  threshold_pace: 'Threshold pace in the units specified by pace_units (e.g., 4.17 for MINS_KM = 4:10/km, or 120 for SECS_100M = 2:00/100m)',
  threshold_pace_human: 'Human-readable threshold pace (e.g., "4:10/km" or "2:00/100m")',
  pace_units: 'Units for all pace values: MINS_KM (minutes per kilometer, running) or SECS_100M (seconds per 100 meters, swimming)',

  // Power zones
  power_zones: 'Power zones as array of {name, low_percent, high_percent, low_watts, high_watts}. Percentages are % of FTP. high values are null for highest zone.',
  indoor_power_zones: 'Indoor-specific power zones (only present if indoor_ftp differs from ftp)',

  // Pace zones
  pace_zones: 'Pace zones sorted from slowest (Zone 1) to fastest. Each has: name, low_percent, high_percent (% of threshold - higher = faster), slow_pace (slowest boundary in pace_units), fast_pace (fastest boundary in pace_units), slow_pace_human, fast_pace_human. null means unbounded.',
};

export const INTERVALS_FIELD_DESCRIPTIONS = {
  // Response structure
  activity_id: 'Unique identifier of the activity in Intervals.icu',
  intervals: 'Array of individual intervals in chronological order',
  groups: 'Summary of repeated interval sets (e.g., "5 x 56s @ 314w")',

  // Interval core fields
  type: 'Interval type: WORK (hard effort) or RECOVERY (easy/rest)',
  label: 'Custom label if assigned',
  group_id: 'ID linking similar intervals (e.g., "56s@314w91rpm")',
  start_seconds: 'Start time in seconds from activity start',
  duration_seconds: 'Interval duration in seconds',
  distance_km: 'Distance covered in kilometers',

  // Power
  average_watts: 'Average power in watts',
  max_watts: 'Maximum power in watts',
  normalized_power: 'Normalized Power (NP) in watts - accounts for variability',
  watts_per_kg: 'Power-to-weight ratio in watts per kilogram',
  power_zone: 'Power zone number (1-7)',
  intensity_factor: 'Intensity Factor (IF) - ratio of NP to FTP (e.g., 1.05 = 105% of FTP)',
  interval_tss: 'Training Stress Score for this interval',

  // Heart rate
  average_hr: 'Average heart rate in BPM',
  max_hr: 'Maximum heart rate in BPM',
  hr_decoupling: 'Power:HR decoupling percentage - positive indicates cardiac drift',

  // Cadence/stride
  average_cadence: 'Average cadence in RPM (cycling) or steps/min (running)',
  stride_length_m: 'Average stride length in meters (running)',

  // Speed
  average_speed_kph: 'Average speed in kilometers per hour',

  // Elevation
  elevation_gain_m: 'Elevation gain in meters',
  average_gradient_pct: 'Average gradient as percentage',

  // W\'bal (anaerobic capacity)
  wbal_start_j: 'W\'bal at interval start in joules - remaining anaerobic capacity',
  wbal_end_j: 'W\'bal at interval end in joules',
  joules_above_ftp: 'Work done above FTP in joules - anaerobic contribution',

  // Group fields
  count: 'Number of repetitions in this interval set',
};

export const NOTES_FIELD_DESCRIPTIONS = {
  activity_id: 'Unique identifier of the activity in Intervals.icu',
  notes: 'Array of notes/messages left by the athlete for this activity',
  id: 'Unique identifier of the note',
  athlete_id: 'Intervals.icu athlete ID who wrote the note',
  name: 'Name of the athlete who wrote the note',
  created: 'Timestamp when the note was created (ISO 8601)',
  type: 'Note type (typically TEXT)',
  content: 'The actual note content written by the athlete',
  attachment_url: 'URL to an attached file (if any)',
  attachment_mime_type: 'MIME type of the attachment (e.g., image/jpeg)',
};

export const WEATHER_FIELD_DESCRIPTIONS = {
  activity_id: 'Unique identifier of the activity in Intervals.icu',
  weather_description: 'Human-readable weather summary including wind direction/speed, headwind/tailwind percentages, precipitation, temperature, feels-like temperature, and cloud cover. Null if weather data is unavailable (e.g., indoor activities).',
};

type FieldCategory =
  | 'workout'
  | 'whoop'
  | 'recovery'
  | 'fitness'
  | 'planned'
  | 'athlete_profile'
  | 'intervals'
  | 'notes'
  | 'weather';

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
    case 'intervals':
      return INTERVALS_FIELD_DESCRIPTIONS;
    case 'notes':
      return NOTES_FIELD_DESCRIPTIONS;
    case 'weather':
      return WEATHER_FIELD_DESCRIPTIONS;
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

